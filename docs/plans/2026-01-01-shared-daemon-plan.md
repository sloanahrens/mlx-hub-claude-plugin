# Shared Daemon Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert mlx-hub from per-session child process to shared Unix socket daemons for cross-session model sharing.

**Architecture:** Multiple persistent Python daemons (one per model) listen on Unix sockets at `~/.mlx-hub/daemons/<model>.sock`. Node.js clients connect to these sockets, auto-starting daemons as needed. JSON-RPC 2.0 protocol with request IDs enables multi-client support.

**Tech Stack:** Python 3 (socket, threading, queue), Node.js (net module), JSON-RPC 2.0

---

## Task 1: Socket Path Utilities

**Files:**
- Create: `src/socket-utils.ts`
- Create: `python/socket_utils.py`
- Test: `src/__tests__/socket-utils.test.ts`

### Step 1: Write failing test for modelIdToSocketName

```typescript
// src/__tests__/socket-utils.test.ts
import { describe, it, expect } from 'vitest';
import { modelIdToSocketName, getSocketPath, getPidPath } from '../socket-utils.js';

describe('socket-utils', () => {
  describe('modelIdToSocketName', () => {
    it('converts model ID to safe socket name', () => {
      expect(modelIdToSocketName('mlx-community/DeepSeek-Coder-V2-Lite-Instruct-4bit'))
        .toBe('deepseek-coder-v2-lite-instruct-4bit');
    });

    it('handles model ID without org prefix', () => {
      expect(modelIdToSocketName('Llama-3.3-70B-Instruct-8bit'))
        .toBe('llama-3.3-70b-instruct-8bit');
    });
  });

  describe('getSocketPath', () => {
    it('returns path in ~/.mlx-hub/daemons/', () => {
      const path = getSocketPath('mlx-community/DeepSeek-Coder-V2-Lite-Instruct-4bit');
      expect(path).toMatch(/\.mlx-hub\/daemons\/deepseek-coder-v2-lite-instruct-4bit\.sock$/);
    });
  });

  describe('getPidPath', () => {
    it('returns .pid path alongside socket', () => {
      const path = getPidPath('mlx-community/DeepSeek-Coder-V2-Lite-Instruct-4bit');
      expect(path).toMatch(/\.mlx-hub\/daemons\/deepseek-coder-v2-lite-instruct-4bit\.pid$/);
    });
  });
});
```

### Step 2: Run test to verify it fails

```bash
npm test -- src/__tests__/socket-utils.test.ts
```

Expected: FAIL with "Cannot find module '../socket-utils.js'"

### Step 3: Implement socket-utils.ts

```typescript
// src/socket-utils.ts
import { homedir } from 'os';
import { join } from 'path';

const DAEMON_DIR = join(homedir(), '.mlx-hub', 'daemons');

/**
 * Convert model ID to safe socket filename.
 * "mlx-community/DeepSeek-Coder-V2-Lite-Instruct-4bit" → "deepseek-coder-v2-lite-instruct-4bit"
 */
export function modelIdToSocketName(modelId: string): string {
  return modelId
    .replace(/^mlx-community\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function getSocketPath(modelId: string): string {
  return join(DAEMON_DIR, `${modelIdToSocketName(modelId)}.sock`);
}

export function getPidPath(modelId: string): string {
  return join(DAEMON_DIR, `${modelIdToSocketName(modelId)}.pid`);
}

export function getDaemonDir(): string {
  return DAEMON_DIR;
}
```

### Step 4: Run test to verify it passes

```bash
npm test -- src/__tests__/socket-utils.test.ts
```

Expected: PASS

### Step 5: Create Python equivalent

```python
# python/socket_utils.py
"""Socket path utilities shared between daemon and manager."""

import os
import re
from pathlib import Path

DAEMON_DIR = Path.home() / '.mlx-hub' / 'daemons'


def model_id_to_socket_name(model_id: str) -> str:
    """Convert model ID to safe socket filename."""
    name = model_id.replace('mlx-community/', '')
    name = name.lower()
    name = re.sub(r'[^a-z0-9-]', '-', name)
    name = re.sub(r'-+', '-', name)
    name = name.strip('-')
    return name


def get_socket_path(model_id: str) -> Path:
    """Get Unix socket path for a model."""
    return DAEMON_DIR / f'{model_id_to_socket_name(model_id)}.sock'


def get_pid_path(model_id: str) -> Path:
    """Get PID file path for a model."""
    return DAEMON_DIR / f'{model_id_to_socket_name(model_id)}.pid'


def ensure_daemon_dir() -> None:
    """Create daemon directory if it doesn't exist."""
    DAEMON_DIR.mkdir(parents=True, exist_ok=True)
```

### Step 6: Commit

```bash
git add src/socket-utils.ts src/__tests__/socket-utils.test.ts python/socket_utils.py
git commit -m "feat: add socket path utilities for shared daemon"
```

---

## Task 2: Python Socket Server Foundation

**Files:**
- Modify: `python/mlx_daemon.py`
- Test: `python/test_daemon_socket.py`

### Step 1: Write failing test for socket server

```python
# python/test_daemon_socket.py
"""Tests for socket-based daemon."""

import json
import os
import socket
import tempfile
import threading
import time
import unittest
from pathlib import Path


class TestDaemonSocket(unittest.TestCase):
    """Test daemon socket communication."""

    def test_ping_pong(self):
        """Daemon responds to ping with pong."""
        from mlx_daemon import MLXDaemon

        with tempfile.TemporaryDirectory() as tmpdir:
            socket_path = Path(tmpdir) / 'test.sock'
            daemon = MLXDaemon(
                model_id='test-model',
                socket_path=str(socket_path),
                idle_timeout=300
            )

            # Start daemon in background thread
            server_thread = threading.Thread(target=daemon.start, daemon=True)
            server_thread.start()

            # Wait for socket to appear
            for _ in range(50):
                if socket_path.exists():
                    break
                time.sleep(0.1)
            self.assertTrue(socket_path.exists(), "Socket not created")

            # Connect and send ping
            client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            client.connect(str(socket_path))

            request = {"jsonrpc": "2.0", "id": "test-1", "method": "ping", "params": {}}
            client.sendall((json.dumps(request) + '\n').encode())

            # Read response
            response_line = b''
            while not response_line.endswith(b'\n'):
                response_line += client.recv(1024)

            response = json.loads(response_line.decode())
            self.assertEqual(response['id'], 'test-1')
            self.assertEqual(response['result']['type'], 'pong')

            client.close()
            daemon.stop()


if __name__ == '__main__':
    unittest.main()
```

### Step 2: Run test to verify it fails

```bash
python3 -m unittest python/test_daemon_socket.py -v
```

Expected: FAIL with "MLXDaemon() takes 1 positional argument"

### Step 3: Implement socket-based MLXDaemon

Replace the `__init__` and `run` methods in `python/mlx_daemon.py`:

```python
#!/usr/bin/env python3
"""
MLX Daemon - Unix socket server for single-model inference.
One daemon instance per model. Supports multiple concurrent clients.
"""

import argparse
import json
import os
import queue
import signal
import socket
import sys
import threading
import time
from pathlib import Path
from typing import Optional, Tuple, Any

from socket_utils import get_socket_path, get_pid_path, ensure_daemon_dir


class MLXDaemon:
    """Socket-based daemon for MLX inference."""

    def __init__(self, model_id: str, socket_path: str, idle_timeout: int = 1800):
        self.model_id = model_id
        self.socket_path = Path(socket_path)
        self.pid_path = Path(str(socket_path).replace('.sock', '.pid'))
        self.idle_timeout = idle_timeout

        self.loaded_model: Optional[Any] = None
        self.loaded_tokenizer: Optional[Any] = None
        self.model_path: Optional[str] = None

        self.last_request_time = time.time()
        self.request_queue: queue.Queue = queue.Queue()
        self.running = False
        self.server_socket: Optional[socket.socket] = None

    def _send(self, conn: socket.socket, request_id: str, data: dict) -> None:
        """Send JSON-RPC response."""
        response = {"jsonrpc": "2.0", "id": request_id, "result": data}
        conn.sendall((json.dumps(response) + '\n').encode())

    def _send_error(self, conn: socket.socket, request_id: str, code: int, message: str) -> None:
        """Send JSON-RPC error."""
        response = {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}
        conn.sendall((json.dumps(response) + '\n').encode())

    def _handle_client(self, conn: socket.socket, addr) -> None:
        """Handle a single client connection."""
        buffer = ''
        try:
            while self.running:
                data = conn.recv(4096)
                if not data:
                    break

                buffer += data.decode()
                while '\n' in buffer:
                    line, buffer = buffer.split('\n', 1)
                    if not line.strip():
                        continue

                    try:
                        request = json.loads(line)
                        self._process_request(conn, request)
                    except json.JSONDecodeError as e:
                        self._send_error(conn, None, -32700, f"Parse error: {e}")
        except Exception as e:
            pass  # Client disconnected
        finally:
            conn.close()

    def _process_request(self, conn: socket.socket, request: dict) -> None:
        """Process a single JSON-RPC request."""
        request_id = request.get('id', 'unknown')
        method = request.get('method', '')
        params = request.get('params', {})

        self.last_request_time = time.time()

        if method == 'ping':
            self._send(conn, request_id, {"type": "pong", "timestamp": time.time()})
        elif method == 'status':
            self._send(conn, request_id, {
                "type": "status_report",
                "model_id": self.model_id,
                "model_loaded": self.loaded_model is not None,
                "model_path": self.model_path,
            })
        elif method == 'unload':
            self._unload_model()
            self._send(conn, request_id, {"type": "unloaded"})
        elif method == 'shutdown':
            self._send(conn, request_id, {"type": "shutdown"})
            self.stop()
        elif method == 'infer':
            self._handle_infer(conn, request_id, params)
        elif method == 'infer_messages':
            self._handle_infer_messages(conn, request_id, params)
        else:
            self._send_error(conn, request_id, -32601, f"Method not found: {method}")

    def _unload_model(self) -> None:
        """Unload model to free memory."""
        self.loaded_model = None
        self.loaded_tokenizer = None

    def start(self) -> None:
        """Start the daemon server."""
        self.running = True

        # Write PID file
        self.pid_path.parent.mkdir(parents=True, exist_ok=True)
        self.pid_path.write_text(str(os.getpid()))

        # Clean stale socket
        if self.socket_path.exists():
            self.socket_path.unlink()

        # Start idle monitor
        idle_thread = threading.Thread(target=self._idle_monitor, daemon=True)
        idle_thread.start()

        # Create and bind socket
        self.server_socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.server_socket.bind(str(self.socket_path))
        self.server_socket.listen(5)
        self.server_socket.settimeout(1.0)  # Allow periodic check of self.running

        try:
            while self.running:
                try:
                    conn, addr = self.server_socket.accept()
                    client_thread = threading.Thread(
                        target=self._handle_client,
                        args=(conn, addr),
                        daemon=True
                    )
                    client_thread.start()
                except socket.timeout:
                    continue
        finally:
            self._cleanup()

    def stop(self) -> None:
        """Stop the daemon."""
        self.running = False

    def _cleanup(self) -> None:
        """Clean up resources."""
        if self.server_socket:
            self.server_socket.close()
        if self.socket_path.exists():
            self.socket_path.unlink()
        if self.pid_path.exists():
            self.pid_path.unlink()

    def _idle_monitor(self) -> None:
        """Unload model after idle timeout."""
        while self.running:
            time.sleep(60)
            if self.loaded_model and (time.time() - self.last_request_time > self.idle_timeout):
                self._unload_model()
                print(f"Model unloaded after {self.idle_timeout}s idle", file=sys.stderr)

    # Keep existing _find_model_path, _ensure_model_loaded, _handle_infer, _handle_infer_messages
    # ... (copy from current implementation, adapting _send calls)
```

### Step 4: Run test to verify it passes

```bash
python3 -m unittest python/test_daemon_socket.py -v
```

Expected: PASS

### Step 5: Commit

```bash
git add python/mlx_daemon.py python/test_daemon_socket.py
git commit -m "feat: convert daemon to Unix socket server"
```

---

## Task 3: Python Inference Methods (Socket Version)

**Files:**
- Modify: `python/mlx_daemon.py`
- Test: `python/test_daemon_socket.py`

### Step 1: Add test for infer method

```python
# Add to python/test_daemon_socket.py

def test_infer_without_model_returns_error(self):
    """Infer without downloaded model returns error."""
    from mlx_daemon import MLXDaemon

    with tempfile.TemporaryDirectory() as tmpdir:
        socket_path = Path(tmpdir) / 'test.sock'
        daemon = MLXDaemon(
            model_id='nonexistent/model',
            socket_path=str(socket_path),
            idle_timeout=300
        )

        server_thread = threading.Thread(target=daemon.start, daemon=True)
        server_thread.start()
        time.sleep(0.5)

        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        client.connect(str(socket_path))

        request = {
            "jsonrpc": "2.0",
            "id": "test-2",
            "method": "infer",
            "params": {"prompt": "Hello", "max_tokens": 10}
        }
        client.sendall((json.dumps(request) + '\n').encode())

        response_line = b''
        while not response_line.endswith(b'\n'):
            response_line += client.recv(1024)

        response = json.loads(response_line.decode())
        self.assertEqual(response['id'], 'test-2')
        self.assertIn('error', response)

        client.close()
        daemon.stop()
```

### Step 2: Implement _handle_infer for socket protocol

Add to `python/mlx_daemon.py`:

```python
def _handle_infer(self, conn: socket.socket, request_id: str, params: dict) -> None:
    """Handle infer request."""
    prompt = params.get('prompt')
    system_prompt = params.get('system_prompt')
    max_tokens = params.get('max_tokens', 256)
    temperature = params.get('temperature', 0.7)

    if not prompt:
        self._send_error(conn, request_id, -32602, "prompt is required")
        return

    success, error = self._ensure_model_loaded()
    if not success:
        self._send_error(conn, request_id, -32000, error)
        return

    try:
        from mlx_lm import stream_generate
        from mlx_lm.sample_utils import make_sampler

        # Format prompt
        if hasattr(self.loaded_tokenizer, "apply_chat_template"):
            messages = []
            if system_prompt:
                messages.append({"role": "system", "content": system_prompt})
            messages.append({"role": "user", "content": prompt})
            formatted_prompt = self.loaded_tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
        else:
            formatted_prompt = f"{system_prompt}\n\n{prompt}" if system_prompt else prompt

        sampler = make_sampler(temp=temperature)
        self._send(conn, request_id, {"type": "status", "message": "Generating..."})

        tokens_generated = 0
        start_time = time.time()

        for response in stream_generate(
            self.loaded_model,
            self.loaded_tokenizer,
            prompt=formatted_prompt,
            max_tokens=max_tokens,
            sampler=sampler,
        ):
            tokens_generated += 1
            token_text = response.text if hasattr(response, 'text') else str(response)
            self._send(conn, request_id, {"type": "token", "content": token_text})

        elapsed = time.time() - start_time
        tokens_per_sec = tokens_generated / elapsed if elapsed > 0 else 0

        self._send(conn, request_id, {
            "type": "done",
            "tokens_generated": tokens_generated,
            "tokens_per_sec": round(tokens_per_sec, 1),
            "elapsed_sec": round(elapsed, 2),
        })

    except Exception as e:
        self._send_error(conn, request_id, -32000, str(e))
```

### Step 3: Run tests

```bash
python3 -m unittest python/test_daemon_socket.py -v
```

### Step 4: Commit

```bash
git add python/mlx_daemon.py python/test_daemon_socket.py
git commit -m "feat: add socket-based inference handling"
```

---

## Task 4: Node.js Socket Client

**Files:**
- Create: `src/daemon-client.ts`
- Test: `src/__tests__/daemon-client.test.ts`

### Step 1: Write failing test

```typescript
// src/__tests__/daemon-client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DaemonClient } from '../daemon-client.js';

describe('DaemonClient', () => {
  describe('getSocketPath', () => {
    it('returns correct socket path for model ID', () => {
      const client = new DaemonClient('mlx-community/DeepSeek-Coder-V2-Lite-Instruct-4bit');
      const path = client.getSocketPath();
      expect(path).toMatch(/\.mlx-hub\/daemons\/deepseek-coder-v2-lite-instruct-4bit\.sock$/);
    });
  });

  describe('generateRequestId', () => {
    it('generates unique IDs', () => {
      const client = new DaemonClient('test-model');
      const id1 = client.generateRequestId();
      const id2 = client.generateRequestId();
      expect(id1).not.toBe(id2);
    });
  });
});
```

### Step 2: Run test to verify it fails

```bash
npm test -- src/__tests__/daemon-client.test.ts
```

### Step 3: Implement DaemonClient

```typescript
// src/daemon-client.ts
/**
 * Daemon Client - connects to shared MLX daemon via Unix socket.
 */

import * as net from 'net';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getSocketPath, getPidPath, getDaemonDir } from './socket-utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_SCRIPT = join(__dirname, '..', 'python', 'mlx_daemon.py');

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

export interface InferParams {
  prompt: string;
  system_prompt?: string;
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

export class DaemonClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private buffer: string = '';
  private modelId: string;
  private pendingRequests: Map<string, {
    resolve: (response: JsonRpcResponse) => void;
    onToken?: (token: string) => void;
  }> = new Map();

  constructor(modelId: string) {
    super();
    this.modelId = modelId;
  }

  getSocketPath(): string {
    return getSocketPath(this.modelId);
  }

  getPidPath(): string {
    return getPidPath(this.modelId);
  }

  generateRequestId(): string {
    return crypto.randomUUID();
  }

  async connect(): Promise<void> {
    const socketPath = this.getSocketPath();

    // Check if daemon is running
    if (!this.isDaemonRunning()) {
      await this.startDaemon();
    }

    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(socketPath);

      this.socket.on('connect', () => resolve());
      this.socket.on('error', reject);
      this.socket.on('data', (data) => this.handleData(data));
      this.socket.on('close', () => {
        this.socket = null;
        this.emit('close');
      });
    });
  }

  private isDaemonRunning(): boolean {
    const pidPath = this.getPidPath();
    const socketPath = this.getSocketPath();

    if (!fs.existsSync(socketPath) || !fs.existsSync(pidPath)) {
      return false;
    }

    try {
      const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim());
      process.kill(pid, 0);  // Check if process exists
      return true;
    } catch {
      // Stale PID file - clean up
      try { fs.unlinkSync(socketPath); } catch {}
      try { fs.unlinkSync(pidPath); } catch {}
      return false;
    }
  }

  private async startDaemon(): Promise<void> {
    // Ensure daemon directory exists
    const daemonDir = getDaemonDir();
    fs.mkdirSync(daemonDir, { recursive: true });

    const socketPath = this.getSocketPath();

    return new Promise((resolve, reject) => {
      const daemon = spawn('python3', [
        DAEMON_SCRIPT,
        '--model', this.modelId,
        '--socket', socketPath,
      ], {
        detached: true,
        stdio: 'ignore',
      });

      daemon.unref();

      // Wait for socket to appear
      const timeout = setTimeout(() => {
        reject(new Error('Daemon startup timeout'));
      }, 10000);

      const checkSocket = setInterval(() => {
        if (fs.existsSync(socketPath)) {
          clearInterval(checkSocket);
          clearTimeout(timeout);
          resolve();
        }
      }, 100);
    });
  }

  private handleData(data: Buffer): void {
    this.buffer += data.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response = JSON.parse(line) as JsonRpcResponse;
        this.handleResponse(response);
      } catch {
        // Ignore malformed JSON
      }
    }
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;

    if (response.result?.type === 'token' && pending.onToken) {
      pending.onToken(response.result.content as string);
    } else if (response.result?.type === 'done' || response.error) {
      this.pendingRequests.delete(response.id);
      pending.resolve(response);
    }
  }

  private send(request: JsonRpcRequest): void {
    if (!this.socket) {
      throw new Error('Not connected');
    }
    this.socket.write(JSON.stringify(request) + '\n');
  }

  async ping(): Promise<boolean> {
    const id = this.generateRequestId();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        resolve(false);
      }, 5000);

      this.pendingRequests.set(id, {
        resolve: (response) => {
          clearTimeout(timeout);
          resolve(!response.error);
        }
      });

      this.send({ jsonrpc: '2.0', id, method: 'ping', params: {} });
    });
  }

  async infer(params: InferParams, onToken?: (token: string) => void): Promise<InferResult> {
    const id = this.generateRequestId();

    return new Promise((resolve) => {
      let output = '';

      this.pendingRequests.set(id, {
        resolve: (response) => {
          if (response.error) {
            resolve({ success: false, error: response.error.message });
          } else {
            resolve({
              success: true,
              output,
              tokens_generated: response.result?.tokens_generated as number,
              tokens_per_sec: response.result?.tokens_per_sec as number,
            });
          }
        },
        onToken: (token) => {
          output += token;
          onToken?.(token);
        }
      });

      this.send({ jsonrpc: '2.0', id, method: 'infer', params });
    });
  }

  async close(): Promise<void> {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
  }
}
```

### Step 4: Run tests

```bash
npm test -- src/__tests__/daemon-client.test.ts
```

### Step 5: Commit

```bash
git add src/daemon-client.ts src/__tests__/daemon-client.test.ts
git commit -m "feat: add Unix socket daemon client"
```

---

## Task 5: Python CLI Entry Point

**Files:**
- Modify: `python/mlx_daemon.py`

### Step 1: Add CLI argument parsing

Add at bottom of `python/mlx_daemon.py`:

```python
def main():
    parser = argparse.ArgumentParser(description='MLX Daemon - Socket server for model inference')
    parser.add_argument('--model', required=True, help='Model ID to serve')
    parser.add_argument('--socket', required=True, help='Unix socket path')
    parser.add_argument('--idle-timeout', type=int, default=1800, help='Idle timeout in seconds (default: 1800)')
    args = parser.parse_args()

    daemon = MLXDaemon(
        model_id=args.model,
        socket_path=args.socket,
        idle_timeout=args.idle_timeout,
    )

    def signal_handler(signum, frame):
        daemon.stop()

    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    try:
        daemon.start()
    except Exception as e:
        print(json.dumps({"type": "fatal", "error": str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
```

### Step 2: Test manually

```bash
python3 python/mlx_daemon.py --model test-model --socket /tmp/test.sock &
# Then connect with: nc -U /tmp/test.sock
```

### Step 3: Commit

```bash
git add python/mlx_daemon.py
git commit -m "feat: add CLI entry point for daemon"
```

---

## Task 6: Update MCP Server Integration

**Files:**
- Modify: `src/mcp-server.ts`
- Test: `src/__tests__/mcp-server.test.ts`

### Step 1: Update mlx_infer to use DaemonClient

Modify the `mlx_infer` handler in `src/mcp-server.ts`:

```typescript
import { DaemonClient } from './daemon-client.js';

// In the mlx_infer handler:
async function handleInfer(params: InferParams): Promise<InferResult> {
  const client = new DaemonClient(params.model_id);

  try {
    await client.connect();
    const result = await client.infer({
      prompt: params.prompt,
      system_prompt: params.system_prompt,
      max_tokens: params.max_tokens,
      temperature: params.temperature,
    }, (token) => {
      // Stream tokens back via MCP
    });
    return result;
  } catch (error) {
    // Fall back to subprocess mode
    return runInferenceSubprocess(params);
  } finally {
    await client.close();
  }
}
```

### Step 2: Run existing tests

```bash
npm test
```

### Step 3: Commit

```bash
git add src/mcp-server.ts
git commit -m "feat: integrate DaemonClient into MCP server"
```

---

## Task 7: Daemon Management Commands

**Files:**
- Create: `commands/daemon.md`

### Step 1: Create /mlx daemon command

```markdown
# commands/daemon.md
---
name: daemon
description: Manage MLX daemons (status, stop, preload)
---

Manage shared MLX model daemons.

## Usage

\`\`\`
/mlx daemon status          # List running daemons
/mlx daemon stop <model>    # Stop a specific daemon
/mlx daemon stop-all        # Stop all daemons
/mlx daemon preload <model> # Start daemon and load model
\`\`\`

## Implementation

Based on the argument, perform the appropriate action using the daemon management tools.
```

### Step 2: Commit

```bash
git add commands/daemon.md
git commit -m "feat: add /mlx daemon management command"
```

---

## Task 8: Integration Testing

**Files:**
- Create: `src/__tests__/integration.test.ts`

### Step 1: Write integration test

```typescript
// src/__tests__/integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DaemonClient } from '../daemon-client.js';
import * as fs from 'fs';
import { getSocketPath, getPidPath } from '../socket-utils.js';

describe('Integration: DaemonClient', () => {
  const testModelId = 'mlx-community/test-model';

  afterAll(async () => {
    // Cleanup any test daemons
    const socketPath = getSocketPath(testModelId);
    const pidPath = getPidPath(testModelId);
    try { fs.unlinkSync(socketPath); } catch {}
    try { fs.unlinkSync(pidPath); } catch {}
  });

  it('handles connection to non-existent daemon gracefully', async () => {
    const client = new DaemonClient('nonexistent/model');
    await expect(client.connect()).rejects.toThrow();
  });
});
```

### Step 2: Run all tests

```bash
npm test
python3 -m unittest discover python/ -v
```

### Step 3: Commit

```bash
git add src/__tests__/integration.test.ts
git commit -m "test: add integration tests for daemon client"
```

---

## Task 9: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

### Step 1: Add shared daemon documentation

Add to `CLAUDE.md`:

```markdown
## Shared Daemon Architecture

The daemon now uses Unix sockets for cross-session model sharing:

- Daemons run at `~/.mlx-hub/daemons/<model>.sock`
- Multiple Claude Code sessions share the same daemon
- Models auto-unload after 30 minutes of inactivity

### Daemon Commands

\`\`\`bash
/mlx daemon status      # List running daemons
/mlx daemon stop <model> # Stop a daemon
/mlx daemon preload <model> # Pre-load a model
\`\`\`
```

### Step 2: Commit

```bash
git add CLAUDE.md
git commit -m "docs: add shared daemon documentation"
```

---

## Summary

| Task | Description | Est. Lines |
|------|-------------|------------|
| 1 | Socket path utilities | ~50 |
| 2 | Python socket server foundation | ~150 |
| 3 | Python inference methods | ~80 |
| 4 | Node.js socket client | ~200 |
| 5 | Python CLI entry point | ~30 |
| 6 | MCP server integration | ~50 |
| 7 | Daemon management commands | ~20 |
| 8 | Integration tests | ~50 |
| 9 | Documentation | ~20 |

**Total: ~650 lines across 9 tasks**
