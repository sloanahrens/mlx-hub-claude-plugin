# mlx-hub

Claude Code plugin for local ML model inference with MLX on Apple Silicon.

## Quick Start

```bash
npm install          # Install Node dependencies
npm run build        # Build TypeScript
pip install -r python/requirements.txt  # Install Python deps
```

## Architecture

- `src/mcp-server.ts` - MCP server exposing 7 tools
- `src/daemon-client.ts` - Client for connecting to shared Python daemons over Unix sockets
- `src/socket-utils.ts` - Socket path utilities and daemon directory management
- `src/python-runner.ts` - Fallback subprocess mode for MLX ops (non-inference)
- `python/mlx_daemon.py` - Shared daemon process that keeps models loaded in memory
- `python/mlx_runner.py` - CLI for search, download, list, remove, infer, info
- `commands/` - Slash commands (/mlx-hub:search, /mlx-hub:download, /mlx-hub:models, /mlx-hub:run, /mlx-hub:info, /mlx-hub:status, /mlx-hub:daemon)

## Shared Daemon Architecture

The daemon uses Unix sockets for cross-session model sharing:

- Daemons run at `~/.mlx-hub/daemons/<model>.sock`
- Multiple Claude Code sessions share the same daemon
- Models auto-unload after 30 minutes of inactivity
- Each model gets its own daemon process with a corresponding PID file

### Daemon Commands

```bash
/mlx-hub:daemon status       # List running daemons with memory usage
/mlx-hub:daemon stop <model> # Stop a specific daemon
/mlx-hub:daemon stop-all     # Stop all running daemons
/mlx-hub:daemon preload <model> # Pre-load a model for faster first inference
```

### How It Works

1. When inference is requested, `DaemonClient` checks if a daemon exists for the model
2. If no daemon is running, it spawns `python/mlx_daemon.py` which creates a Unix socket
3. The MCP server connects to the socket and sends JSON-RPC requests
4. The daemon keeps the model loaded in memory for fast subsequent requests
5. After 30 minutes of inactivity, the daemon automatically shuts down

## Testing

```bash
# Run all TypeScript tests (59 tests)
npm test

# Run all Python tests (23 tests)
python3 -m unittest python/test_mlx_runner.py

# Manual testing - Python runner directly
python3 python/mlx_runner.py list
python3 python/mlx_runner.py search "llama" --limit 5
```

## Key Files

| File | Purpose |
|------|---------|
| `.claude-plugin/plugin.json` | Plugin manifest |
| `src/mcp-server.ts` | MCP tool definitions and handlers |
| `python/mlx_runner.py` | All MLX operations |

## Development Setup

This plugin is registered as a local marketplace in Claude Code, pointing to this repo.

**Dev workflow:**
```bash
# After editing code
npm run build                           # Build TypeScript
claude plugin update mlx-hub@mlx-hub    # Sync changes to plugin cache
# Restart Claude Code if MCP server changed
```

**First-time setup** (if not already registered):
```bash
claude plugin marketplace add ~/code/mlx-hub-claude-plugin
claude plugin install mlx-hub@mlx-hub
```
