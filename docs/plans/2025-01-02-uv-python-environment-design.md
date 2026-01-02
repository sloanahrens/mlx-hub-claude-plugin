# MLX Hub: uv-Based Python Environment Management

**Date**: 2025-01-02
**Status**: Approved
**Problem**: MCP server uses hardcoded Python path that doesn't match where dependencies are installed

## Decision

Use `uv` to create and manage an isolated Python virtual environment at `~/.mlx-hub/venv/`. This provides:
- Zero-config experience for new users (auto-setup on first run)
- Isolated environment that won't conflict with system Python
- Fast dependency installation (~10x faster than pip)
- Automatic updates when requirements change

## Environment Structure

```
~/.mlx-hub/
├── venv/                 # uv-managed virtual environment
│   ├── bin/python3       # The Python binary we always use
│   └── lib/...           # Installed packages (mlx, mlx-lm, huggingface_hub)
├── daemons/              # Daemon Unix sockets (existing, unchanged)
└── .python-ready         # Marker file indicating setup complete
```

## Setup Flow

```
1. Check ~/.mlx-hub/.python-ready exists?
   YES → Use ~/.mlx-hub/venv/bin/python3, done
   NO  → Continue to setup

2. Check `uv` is available (which uv)
   NOT FOUND → Return error with install instructions

3. Create venv: uv venv ~/.mlx-hub/venv

4. Install deps: uv pip install -r requirements.txt --python ~/.mlx-hub/venv/bin/python3

5. Write marker: ~/.mlx-hub/.python-ready (timestamp + requirements hash)
```

## Cache Invalidation

The `.python-ready` marker contains:

```json
{
  "created": "2025-01-02T12:00:00Z",
  "uv_version": "0.5.11",
  "requirements_hash": "sha256:a1b2c3d4..."
}
```

| Trigger | Action |
|---------|--------|
| `requirements_hash` changed | Re-run `uv pip install` |
| `.python-ready` missing | Full setup |
| `/mlx-hub:daemon reset` | Delete venv, re-setup on next use |

## Code Changes

### New file: `src/env-setup.ts`

```typescript
export async function ensurePythonEnv(): Promise<string>
// Returns path to python binary, setting up venv if needed

export async function getPythonPath(): Promise<string>
// Fast path: check marker, return cached path
// Slow path: call ensurePythonEnv()

export function getRequirementsHash(): string
// SHA256 hash of requirements.txt for cache invalidation
```

### Modified: `src/python-runner.ts`

Replace hardcoded path:
```typescript
// Before
const PYTHON_PATH = process.env.MLX_PYTHON_PATH || '/Library/Developer/CommandLineTools/usr/bin/python3';

// After
let cachedPythonPath: string | null = null;
async function getPython(): Promise<string> {
  if (cachedPythonPath) return cachedPythonPath;
  cachedPythonPath = await getPythonPath();
  return cachedPythonPath;
}
```

### Modified: `src/daemon-client.ts`

Use `getPythonPath()` when spawning daemon processes.

### Modified: `Makefile`

- Update `install` to document `uv` requirement
- Add `reset-python` target to remove venv

## User Experience

**First run:**
```
Setting up MLX environment (one-time, ~10 seconds)...
Creating virtual environment...
Installing mlx, mlx-lm, huggingface_hub...
Setup complete.
```

**If uv not installed:**
```
Error: MLX Hub requires 'uv' for Python environment management.

Install with:
  curl -LsSf https://astral.sh/uv/install.sh | sh
  brew install uv

Then restart Claude Code.
```

## Not Included

- Fallback to pip (adds complexity, uv is fast becoming standard)
- Auto-detection of existing mlx installs (creates "which Python?" ambiguity)
- Bundling uv with the plugin (it's a system tool, not a plugin dependency)
