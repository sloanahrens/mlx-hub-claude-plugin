/**
 * Daemon Client - Node.js client for connecting to the Python Unix socket daemon.
 * Handles auto-starting the daemon if not running.
 */

import * as net from 'net';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getSocketPath, getPidPath, getDaemonDir } from './socket-utils.js';
import { getPythonPath } from './env-setup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_SCRIPT = join(__dirname, '..', 'python', 'mlx_daemon.py');

// Timeout constants
const CONNECT_TIMEOUT_MS = 5000;
const DAEMON_START_TIMEOUT_MS = 10000;
const PING_TIMEOUT_MS = 5000;
const INFER_TIMEOUT_MS = 300000; // 5 minutes for inference requests

/**
 * JSON-RPC 2.0 request structure
 */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

/**
 * JSON-RPC 2.0 response structure
 */
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string;
  result?: {
    type: string;
    content?: string;
    tokens_generated?: number;
    tokens_per_sec?: number;
    elapsed_sec?: number;
    timestamp?: number;
    model_id?: string;
    loaded_path?: string;
    is_ready?: boolean;
    uptime_seconds?: number;
    message?: string;
  };
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Parameters for inference requests
 */
export interface InferParams {
  prompt?: string;
  messages?: Array<{ role: string; content: string }>;
  system_prompt?: string;
  max_tokens?: number;
  temperature?: number;
}

/**
 * Result from an inference request
 */
export interface InferResult {
  success: boolean;
  output?: string;
  tokens_generated?: number;
  tokens_per_sec?: number;
  elapsed_sec?: number;
  error?: string;
}

/**
 * Callback for streaming tokens
 */
export type TokenCallback = (token: string) => void;

/**
 * Client for connecting to the MLX daemon over Unix sockets.
 * Each client instance is tied to a specific model.
 */
export class DaemonClient {
  private modelId: string;
  private socket: net.Socket | null = null;
  private buffer: string = '';
  private pendingRequests: Map<
    string,
    {
      resolve: (response: JsonRpcResponse) => void;
      reject: (error: Error) => void;
      onToken?: TokenCallback;
    }
  > = new Map();

  /**
   * Create a new daemon client for a specific model.
   * @param modelId - The model ID (e.g., 'mlx-community/Llama-3.2-1B-Instruct-4bit')
   */
  constructor(modelId: string) {
    this.modelId = modelId;
  }

  /**
   * Clean up all pending requests by rejecting them with the given error.
   * Called when the socket disconnects unexpectedly.
   */
  private cleanupPendingRequests(error: Error): void {
    for (const [requestId, pending] of this.pendingRequests) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  /**
   * Get the Unix socket path for this client's model.
   */
  getSocketPath(): string {
    return getSocketPath(this.modelId);
  }

  /**
   * Get the PID file path for this client's model daemon.
   */
  getPidPath(): string {
    return getPidPath(this.modelId);
  }

  /**
   * Generate a unique request ID.
   */
  generateRequestId(): string {
    return crypto.randomUUID();
  }

  /**
   * Check if the daemon is running.
   * Verifies both the socket file exists and the PID process is alive.
   */
  isDaemonRunning(): boolean {
    const socketPath = this.getSocketPath();
    const pidPath = this.getPidPath();

    // Check if socket file exists
    if (!fs.existsSync(socketPath)) {
      return false;
    }

    // Check if PID file exists
    if (!fs.existsSync(pidPath)) {
      return false;
    }

    // Check if process is alive
    try {
      const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
      if (isNaN(pid)) {
        return false;
      }
      // Send signal 0 to check if process exists
      process.kill(pid, 0);
      return true;
    } catch {
      // Process doesn't exist or we don't have permission
      return false;
    }
  }

  /**
   * Start the daemon process for this model.
   * The daemon runs detached and persists after this process exits.
   */
  async startDaemon(): Promise<void> {
    const socketPath = this.getSocketPath();
    const daemonDir = getDaemonDir();

    // Ensure daemon directory exists
    if (!fs.existsSync(daemonDir)) {
      fs.mkdirSync(daemonDir, { recursive: true });
    }

    // Get Python path from managed venv
    const pythonPath = await getPythonPath();

    // Spawn detached daemon process
    const daemon = spawn(
      pythonPath,
      [DAEMON_SCRIPT, '--model', this.modelId, '--socket', socketPath],
      {
        detached: true,
        stdio: 'ignore',
      }
    );

    // Unref to allow parent to exit independently
    daemon.unref();

    // Wait for socket to appear (indicates daemon is ready)
    const startTime = Date.now();
    while (Date.now() - startTime < DAEMON_START_TIMEOUT_MS) {
      if (fs.existsSync(socketPath)) {
        // Socket exists, give it a moment to be ready
        await this.sleep(100);
        return;
      }
      await this.sleep(100);
    }

    throw new Error(
      `Daemon failed to start within ${DAEMON_START_TIMEOUT_MS}ms`
    );
  }

  /**
   * Connect to the daemon socket.
   * Auto-starts the daemon if not running.
   */
  async connect(): Promise<void> {
    // Check if already connected
    if (this.socket && !this.socket.destroyed) {
      return;
    }

    // Auto-start daemon if needed
    if (!this.isDaemonRunning()) {
      await this.startDaemon();
    }

    const socketPath = this.getSocketPath();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket?.destroy();
        reject(new Error(`Connection timeout after ${CONNECT_TIMEOUT_MS}ms`));
      }, CONNECT_TIMEOUT_MS);

      this.socket = net.createConnection(socketPath, () => {
        clearTimeout(timeout);
        resolve();
      });

      this.socket.on('data', (data) => {
        this.handleData(data);
      });

      this.socket.on('error', (error) => {
        clearTimeout(timeout);
        this.cleanupPendingRequests(error);
        this.socket = null;
        reject(error);
      });

      this.socket.on('close', () => {
        this.cleanupPendingRequests(new Error('Socket closed'));
        this.socket = null;
      });
    });
  }

  /**
   * Handle incoming data from the socket.
   * Parses JSON-RPC responses and routes them to pending requests.
   */
  private handleData(data: Buffer): void {
    this.buffer += data.toString();

    // Process complete lines
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const response = JSON.parse(line) as JsonRpcResponse;
        const requestId = response.id;

        const pending = this.pendingRequests.get(requestId);
        if (!pending) continue;

        // Handle streaming tokens
        if (response.result?.type === 'token' && pending.onToken) {
          if (response.result.content) {
            pending.onToken(response.result.content);
          }
          // Don't resolve yet, more tokens may come
          continue;
        }

        // Handle final response (done, error, pong, etc.)
        this.pendingRequests.delete(requestId);
        pending.resolve(response);
      } catch (error) {
        // Log malformed JSON for debugging
        console.error('Failed to parse JSON-RPC response:', error);
      }
    }
  }

  /**
   * Send a JSON-RPC request and wait for response.
   */
  private async sendRequest(
    method: string,
    params: Record<string, unknown>,
    onToken?: TokenCallback,
    timeoutMs?: number
  ): Promise<JsonRpcResponse> {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('Not connected to daemon');
    }

    const requestId = this.generateRequestId();
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = timeoutMs
        ? setTimeout(() => {
            this.pendingRequests.delete(requestId);
            reject(new Error(`Request timeout after ${timeoutMs}ms`));
          }, timeoutMs)
        : null;

      this.pendingRequests.set(requestId, {
        resolve: (response) => {
          if (timeout) clearTimeout(timeout);
          resolve(response);
        },
        reject: (error) => {
          if (timeout) clearTimeout(timeout);
          reject(error);
        },
        onToken,
      });

      this.socket!.write(JSON.stringify(request) + '\n');
    });
  }

  /**
   * Send a ping to check if daemon is responsive.
   * @returns true if daemon responds with pong, false otherwise
   */
  async ping(): Promise<boolean> {
    try {
      await this.connect();
      const response = await this.sendRequest(
        'ping',
        {},
        undefined,
        PING_TIMEOUT_MS
      );
      return response.result?.type === 'pong';
    } catch {
      return false;
    }
  }

  /**
   * Run inference on the model.
   * @param params - Inference parameters (prompt or messages, max_tokens, temperature)
   * @param onToken - Optional callback for streaming tokens
   * @returns Inference result with output text and statistics
   */
  async infer(params: InferParams, onToken?: TokenCallback): Promise<InferResult> {
    await this.connect();

    // Determine method based on params
    const method = params.messages ? 'infer_messages' : 'infer';

    // Build request params
    const requestParams: Record<string, unknown> = {
      max_tokens: params.max_tokens ?? 256,
      temperature: params.temperature ?? 0.7,
    };

    if (params.messages) {
      requestParams.messages = params.messages;
    } else {
      requestParams.prompt = params.prompt;
      if (params.system_prompt) {
        requestParams.system_prompt = params.system_prompt;
      }
    }

    let output = '';
    const wrappedOnToken: TokenCallback | undefined = onToken
      ? (token) => {
          output += token;
          onToken(token);
        }
      : (token) => {
          output += token;
        };

    try {
      const response = await this.sendRequest(method, requestParams, wrappedOnToken, INFER_TIMEOUT_MS);

      if (response.error) {
        return {
          success: false,
          error: response.error.message,
        };
      }

      if (response.result?.type === 'done') {
        return {
          success: true,
          output,
          tokens_generated: response.result.tokens_generated,
          tokens_per_sec: response.result.tokens_per_sec,
          elapsed_sec: response.result.elapsed_sec,
        };
      }

      // Unexpected response type
      return {
        success: false,
        error: `Unexpected response type: ${response.result?.type}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Close the socket connection.
   */
  async close(): Promise<void> {
    if (this.socket && !this.socket.destroyed) {
      return new Promise((resolve) => {
        this.socket!.once('close', () => {
          this.socket = null;
          resolve();
        });
        this.socket!.end();
      });
    }
    this.socket = null;
  }

  /**
   * Helper to sleep for a given number of milliseconds.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
