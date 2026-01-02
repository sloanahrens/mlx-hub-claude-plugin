# Shared Daemon Architecture

Convert mlx-hub from per-session child process to shared Unix socket daemons for cross-session model sharing.

**Date:** 2026-01-01
**Status:** Design approved

## Problem

Each Claude Code session spawns its own MLX daemon, duplicating RAM usage:
- Session 1: DeepSeek (9.1 GB)
- Session 2: DeepSeek (9.1 GB) ← 18.2 GB total

With 128 GB unified memory, we can do better.

## Solution

Multiple persistent daemons (one per model) accessible via Unix sockets. Any Claude Code session connects to the same daemon, sharing the loaded model.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Lifecycle | Hybrid (auto-start + manual controls) | Convenience with power-user escape hatches |
| Concurrency | Sequential FIFO queue | MLX can't parallelize; simple and predictable |
| Architecture | Multiple daemons (one per model) | Isolated failures, easy experimentation |
| Idle behavior | Unload model, keep daemon running | Free RAM while maintaining fast reconnect |

## Socket Layout

```
~/.mlx-hub/
├── daemons/
│   ├── deepseek-coder-v2-lite-instruct-4bit.sock
│   ├── deepseek-coder-v2-lite-instruct-4bit.pid
│   ├── llama-3.3-70b-instruct-8bit.sock
│   └── llama-3.3-70b-instruct-8bit.pid
└── daemon.log
```

**Socket naming:** Model ID with `mlx-community/` stripped, lowercased, non-alphanumeric replaced with `-`.

**PID files:** For detecting running daemons and cleanup of stale sockets.

## Protocol (JSON-RPC 2.0)

```json
// Request
{"jsonrpc": "2.0", "id": "uuid", "method": "infer", "params": {"prompt": "...", "max_tokens": 256}}

// Streaming response
{"jsonrpc": "2.0", "id": "uuid", "result": {"type": "token", "content": "Hello"}}
{"jsonrpc": "2.0", "id": "uuid", "result": {"type": "done", "tokens_generated": 50}}

// Error
{"jsonrpc": "2.0", "id": "uuid", "error": {"code": -32000, "message": "Model not found"}}
```

**Methods:**

| Method | Purpose |
|--------|---------|
| `infer` | Single-turn inference |
| `infer_messages` | Multi-turn chat |
| `ping` | Health check |
| `status` | Model state (loaded/unloaded, memory) |
| `unload` | Free model from memory |
| `shutdown` | Graceful daemon exit |

## Daemon Lifecycle

### Auto-start flow

```
Client calls mlx_infer(model_id, ...)
    │
    ▼
Build socket path from model_id
    │
    ▼
Socket exists? ──No──► Spawn: python3 mlx_daemon.py --model <id> --socket <path>
    │                              │
   Yes                             ▼
    │                   Wait for socket (10s timeout)
    │                              │
    ▼                              ▼
Connect to socket ◄────────────────┘
    │
    ▼
Send request, stream response
```

### Idle timeout

- Track `last_request_time` per daemon
- Background thread checks every 60s
- Idle > 30 min → unload model (daemon stays running)
- Next request triggers model reload (5-10s)

### Manual commands

| Command | Action |
|---------|--------|
| `/mlx daemon status` | List running daemons, models, memory |
| `/mlx daemon stop <model>` | Shutdown specific daemon |
| `/mlx daemon stop-all` | Shutdown all daemons |
| `/mlx daemon preload <model>` | Start daemon and load model proactively |

## Python Daemon Structure

```python
class MLXDaemon:
    def __init__(self, model_id: str, socket_path: str, idle_timeout: int = 1800):
        self.model_id = model_id
        self.socket_path = socket_path
        self.idle_timeout = idle_timeout
        self.model = None
        self.last_request_time = time.time()

    def start(self):
        # Write PID file
        # Clean stale socket
        # Start idle monitor thread
        # Start request processor thread (FIFO)
        # Accept connections in main thread
```

**Threading model:**
- Main thread: accept connections
- Per-client threads: read requests, enqueue
- Processor thread: execute inference sequentially
- Monitor thread: unload model when idle

## Node.js Client Structure

```typescript
class DaemonClient {
  private socket: net.Socket | null = null;
  private modelId: string;

  getSocketPath(): string {
    // Model ID → socket path
  }

  async connect(): Promise<void> {
    // Auto-start daemon if socket missing
    // Connect to Unix socket
  }

  async *infer(params): AsyncGenerator<Token> {
    // Send JSON-RPC request
    // Yield tokens as they arrive
  }
}
```

## Error Handling

| Failure | Response |
|---------|----------|
| Daemon won't start | Fall back to subprocess mode |
| Daemon crashes mid-request | Retry once, then subprocess |
| Model fails to load | Return error, daemon stays up |
| Stale socket | Remove socket + PID, start fresh |

**Principle:** Shared daemon is an optimization. Subprocess fallback ensures users never get stuck.

## Implementation Scope

**Modify:**

| File | Changes |
|------|---------|
| `python/mlx_daemon.py` | stdin/stdout → Unix socket server |
| `src/daemon-runner.ts` | Rename to `daemon-client.ts`, socket logic |
| `src/mcp-server.ts` | Use new client, add management tools |
| `commands/` | Add `/mlx daemon` subcommands |

**Create:**

| File | Purpose |
|------|---------|
| `python/daemon_manager.py` | CLI for start/stop/status/preload |

**Estimates:**

| Component | Lines |
|-----------|-------|
| Python socket server | ~250 |
| Node.js socket client | ~200 |
| Daemon management CLI | ~100 |
| MCP tool updates | ~50 |
| Tests | ~150 |

## Backward Compatibility

- Subprocess fallback preserves current behavior
- No breaking changes to MCP tool interface
- Transparent to users unaware of daemon architecture
