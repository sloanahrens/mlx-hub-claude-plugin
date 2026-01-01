# mlx-hub

Claude Code plugin for local ML model inference with MLX on Apple Silicon.

## Quick Start

```bash
npm install          # Install Node dependencies
npm run build        # Build TypeScript
pip install -r python/requirements.txt  # Install Python deps
```

## Architecture

- `src/mcp-server.ts` - MCP server exposing 5 tools
- `src/python-runner.ts` - Spawns Python subprocess for MLX ops
- `python/mlx_runner.py` - CLI for search, download, list, remove, infer
- `commands/` - Slash commands (/mlx search, download, models, run)

## Testing

```bash
# Test Python runner directly
python3 python/mlx_runner.py list
python3 python/mlx_runner.py search "llama" --limit 5

# Build and test MCP server
npm run build
node dist/mcp-server.js  # Runs via stdio
```

## Key Files

| File | Purpose |
|------|---------|
| `.claude-plugin/plugin.json` | Plugin manifest |
| `src/mcp-server.ts` | MCP tool definitions and handlers |
| `python/mlx_runner.py` | All MLX operations |

## Development Setup

To avoid reinstalling after every change, symlink the plugin cache to this repo:

```bash
# Remove the cache copy and symlink to dev repo
rm -rf ~/.claude/plugins/cache/mlx-hub-dev/mlx-hub/0.1.0
ln -s /Users/sloan/code/mono-claude/mlx-hub ~/.claude/plugins/cache/mlx-hub-dev/mlx-hub/0.1.0
```

After symlinking, the dev workflow is:
1. Edit code in this repo
2. Run `npm run build`
3. Changes are live immediately
4. Only restart Claude Code if the MCP server needs a full reload

**Note**: If you bump version in `plugin.json`, update the symlink path to match (e.g., `0.2.0`).
