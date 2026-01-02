/**
 * Daemon Runner - manages a long-running Python daemon for fast inference.
 * Keeps models loaded in memory between calls.
 */

import { spawn, ChildProcess } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_SCRIPT = join(__dirname, '..', 'python', 'mlx_daemon.py');

export interface DaemonResponse {
  type: 'ready' | 'status' | 'status_report' | 'token' | 'done' | 'error' | 'unloaded' | 'pong' | 'shutdown' | 'fatal';
  message?: string;
  error?: string;
  content?: string;
  tokens_generated?: number;
  tokens_per_sec?: number;
  elapsed_sec?: number;
  loaded_model?: string | null;
  loaded_path?: string | null;
  is_ready?: boolean;
  model_id?: string | null;
  timestamp?: number;
}

export interface InferRequest {
  model_id: string;
  prompt: string;
  system_prompt?: string;
  max_tokens?: number;
  temperature?: number;
}

export interface InferMessagesRequest {
  model_id: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  temperature?: number;
}

export interface InferResult {
  success: boolean;
  output?: string;
  tokens_generated?: number;
  tokens_per_sec?: number;
  error?: string;
}

/**
 * Singleton daemon manager for MLX inference.
 */
class MLXDaemonManager extends EventEmitter {
  private daemon: ChildProcess | null = null;
  private buffer: string = '';
  private isReady: boolean = false;
  private pendingCallbacks: Map<number, {
    onResponse: (response: DaemonResponse) => void;
    onComplete: (result: InferResult) => void;
  }> = new Map();
  private callCounter: number = 0;
  private startPromise: Promise<void> | null = null;

  /**
   * Start the daemon if not already running.
   */
  async start(): Promise<void> {
    if (this.daemon && this.isReady) {
      return;
    }

    // Avoid concurrent starts
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this._doStart();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async _doStart(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.daemon = spawn('python3', [DAEMON_SCRIPT], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.buffer = '';
      this.isReady = false;

      const timeout = setTimeout(() => {
        reject(new Error('Daemon startup timeout'));
      }, 30000);

      this.daemon.stdout?.on('data', (data) => {
        this.buffer += data.toString();
        this.processBuffer();
      });

      this.daemon.stderr?.on('data', (data) => {
        // Log stderr but don't fail - MLX logs to stderr
        const msg = data.toString().trim();
        if (msg) {
          this.emit('stderr', msg);
        }
      });

      this.daemon.on('close', (code) => {
        this.isReady = false;
        this.daemon = null;
        this.emit('close', code);
      });

      this.daemon.on('error', (error) => {
        this.isReady = false;
        this.daemon = null;
        this.emit('error', error);
        reject(error);
      });

      // Wait for ready message
      const readyHandler = (response: DaemonResponse) => {
        if (response.type === 'ready') {
          clearTimeout(timeout);
          this.isReady = true;
          this.off('response', readyHandler);
          resolve();
        }
      };
      this.on('response', readyHandler);
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response = JSON.parse(line) as DaemonResponse;
        this.emit('response', response);
      } catch {
        // Ignore malformed JSON
      }
    }
  }

  private sendCommand(command: object): void {
    if (!this.daemon?.stdin) {
      throw new Error('Daemon not running');
    }
    this.daemon.stdin.write(JSON.stringify(command) + '\n');
  }

  /**
   * Check if daemon is running and ready.
   */
  isRunning(): boolean {
    return this.daemon !== null && this.isReady;
  }

  /**
   * Get daemon status including loaded model info.
   */
  async getStatus(): Promise<DaemonResponse> {
    await this.start();

    return new Promise((resolve) => {
      const handler = (response: DaemonResponse) => {
        if (response.type === 'status_report') {
          this.off('response', handler);
          resolve(response);
        }
      };
      this.on('response', handler);
      this.sendCommand({ command: 'status' });
    });
  }

  /**
   * Run inference with streaming token callback.
   */
  async infer(
    request: InferRequest,
    onToken?: (token: string) => void
  ): Promise<InferResult> {
    await this.start();

    return new Promise((resolve) => {
      let output = '';
      let resolved = false;

      const handler = (response: DaemonResponse) => {
        switch (response.type) {
          case 'token':
            if (response.content) {
              output += response.content;
              onToken?.(response.content);
            }
            break;
          case 'done':
            this.off('response', handler);
            if (!resolved) {
              resolved = true;
              resolve({
                success: true,
                output,
                tokens_generated: response.tokens_generated,
                tokens_per_sec: response.tokens_per_sec,
              });
            }
            break;
          case 'error':
            this.off('response', handler);
            if (!resolved) {
              resolved = true;
              resolve({
                success: false,
                error: response.error || 'Unknown error',
              });
            }
            break;
          case 'status':
            // Progress updates - ignore for now
            break;
        }
      };

      this.on('response', handler);
      this.sendCommand({
        command: 'infer',
        model_id: request.model_id,
        prompt: request.prompt,
        system_prompt: request.system_prompt,
        max_tokens: request.max_tokens ?? 256,
        temperature: request.temperature ?? 0.7,
      });
    });
  }

  /**
   * Run inference with a messages array (multi-turn chat).
   */
  async inferMessages(
    request: InferMessagesRequest,
    onToken?: (token: string) => void
  ): Promise<InferResult> {
    await this.start();

    return new Promise((resolve) => {
      let output = '';
      let resolved = false;

      const handler = (response: DaemonResponse) => {
        switch (response.type) {
          case 'token':
            if (response.content) {
              output += response.content;
              onToken?.(response.content);
            }
            break;
          case 'done':
            this.off('response', handler);
            if (!resolved) {
              resolved = true;
              resolve({
                success: true,
                output,
                tokens_generated: response.tokens_generated,
                tokens_per_sec: response.tokens_per_sec,
              });
            }
            break;
          case 'error':
            this.off('response', handler);
            if (!resolved) {
              resolved = true;
              resolve({
                success: false,
                error: response.error || 'Unknown error',
              });
            }
            break;
        }
      };

      this.on('response', handler);
      this.sendCommand({
        command: 'infer_messages',
        model_id: request.model_id,
        messages: request.messages,
        max_tokens: request.max_tokens ?? 256,
        temperature: request.temperature ?? 0.7,
      });
    });
  }

  /**
   * Ping the daemon to check if it's alive.
   */
  async ping(): Promise<boolean> {
    if (!this.isRunning()) {
      return false;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.off('response', handler);
        resolve(false);
      }, 5000);

      const handler = (response: DaemonResponse) => {
        if (response.type === 'pong') {
          clearTimeout(timeout);
          this.off('response', handler);
          resolve(true);
        }
      };

      this.on('response', handler);
      this.sendCommand({ command: 'ping' });
    });
  }

  /**
   * Unload the current model to free memory.
   */
  async unload(): Promise<void> {
    if (!this.isRunning()) {
      return;
    }

    return new Promise((resolve) => {
      const handler = (response: DaemonResponse) => {
        if (response.type === 'unloaded') {
          this.off('response', handler);
          resolve();
        }
      };
      this.on('response', handler);
      this.sendCommand({ command: 'unload' });
    });
  }

  /**
   * Gracefully shutdown the daemon.
   */
  async shutdown(): Promise<void> {
    if (!this.daemon) {
      return;
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if graceful shutdown fails
        this.daemon?.kill('SIGKILL');
        resolve();
      }, 5000);

      this.daemon?.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });

      try {
        this.sendCommand({ command: 'shutdown' });
      } catch {
        this.daemon?.kill('SIGTERM');
      }
    });
  }
}

// Singleton instance
const daemonManager = new MLXDaemonManager();

// Clean shutdown on process exit
process.on('exit', () => {
  daemonManager.shutdown().catch(() => {});
});

process.on('SIGINT', () => {
  daemonManager.shutdown().then(() => process.exit(0)).catch(() => process.exit(1));
});

process.on('SIGTERM', () => {
  daemonManager.shutdown().then(() => process.exit(0)).catch(() => process.exit(1));
});

export { daemonManager };
