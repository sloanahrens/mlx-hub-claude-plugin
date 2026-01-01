# mlx-hub Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Claude Code plugin that lets users discover, download, and run Hugging Face models locally using MLX on Apple Silicon.

**Architecture:** TypeScript MCP server exposes 5 tools (`mlx_search`, `mlx_download`, `mlx_list_local`, `mlx_remove`, `mlx_infer`). The MCP server spawns a Python subprocess (`mlx_runner.py`) for actual MLX operations. Streaming inference uses JSON-lines protocol over stdout.

**Tech Stack:** TypeScript + @modelcontextprotocol/sdk for MCP server, Python + mlx-lm + huggingface_hub for ML operations, Zod for input validation.

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`

**Step 1: Create package.json**

```json
{
  "name": "mlx-hub",
  "version": "0.1.0",
  "description": "Claude Code plugin for local ML model inference with MLX",
  "main": "dist/mcp-server.js",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "keywords": ["claude-code", "mlx", "huggingface", "local-llm"],
  "author": {
    "name": "sloan"
  },
  "license": "MIT",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.20.0",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create .gitignore**

```
node_modules/
dist/
*.log
.DS_Store
__pycache__/
*.pyc
.env
```

**Step 4: Create .claude-plugin/plugin.json**

```json
{
  "name": "mlx-hub",
  "version": "0.1.0",
  "description": "Discover, download, and run Hugging Face models locally with MLX",
  "author": {
    "name": "sloan"
  },
  "license": "MIT",
  "keywords": ["mlx", "huggingface", "local-llm", "apple-silicon"],
  "mcpServers": {
    "mlx-hub": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.js"]
    }
  }
}
```

**Step 5: Create .claude-plugin/marketplace.json**

```json
{
  "name": "mlx-hub-dev",
  "description": "Development marketplace for mlx-hub plugin",
  "owner": {
    "name": "sloan"
  },
  "plugins": [
    {
      "name": "mlx-hub",
      "description": "Local ML model inference with MLX",
      "version": "0.1.0",
      "source": "./",
      "author": {
        "name": "sloan"
      }
    }
  ]
}
```

**Step 6: Install dependencies**

Run: `npm install`
Expected: node_modules created, package-lock.json generated

**Step 7: Commit**

```bash
git add .
git commit -m "feat: scaffold project with TypeScript and plugin config"
```

---

## Task 2: Python Runner - CLI Interface

**Files:**
- Create: `python/mlx_runner.py`
- Create: `python/requirements.txt`

**Step 1: Create requirements.txt**

```
mlx>=0.21.0
mlx-lm>=0.19.0
huggingface_hub>=0.25.0
```

**Step 2: Create mlx_runner.py with argument parsing**

```python
#!/usr/bin/env python3
"""
MLX Runner - CLI interface for MLX model operations.
Called by the MCP server as a subprocess.
"""

import argparse
import json
import sys
from pathlib import Path


def cmd_search(args):
    """Search Hugging Face Hub for MLX-compatible models."""
    print(json.dumps({"error": "not implemented"}))
    sys.exit(1)


def cmd_download(args):
    """Download a model from Hugging Face Hub."""
    print(json.dumps({"error": "not implemented"}))
    sys.exit(1)


def cmd_list(args):
    """List locally downloaded models."""
    print(json.dumps({"error": "not implemented"}))
    sys.exit(1)


def cmd_remove(args):
    """Remove a locally downloaded model."""
    print(json.dumps({"error": "not implemented"}))
    sys.exit(1)


def cmd_infer(args):
    """Run inference on a model (streaming output)."""
    print(json.dumps({"error": "not implemented"}))
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="MLX model operations")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # search command
    search_parser = subparsers.add_parser("search", help="Search HF Hub")
    search_parser.add_argument("query", help="Search query")
    search_parser.add_argument("--limit", type=int, default=10)
    search_parser.set_defaults(func=cmd_search)

    # download command
    download_parser = subparsers.add_parser("download", help="Download model")
    download_parser.add_argument("model_id", help="Model ID (e.g., mlx-community/Llama-3.2-3B-4bit)")
    download_parser.add_argument("--quantize", choices=["4bit", "8bit"])
    download_parser.set_defaults(func=cmd_download)

    # list command
    list_parser = subparsers.add_parser("list", help="List local models")
    list_parser.set_defaults(func=cmd_list)

    # remove command
    remove_parser = subparsers.add_parser("remove", help="Remove local model")
    remove_parser.add_argument("model_id", help="Model ID to remove")
    remove_parser.set_defaults(func=cmd_remove)

    # infer command
    infer_parser = subparsers.add_parser("infer", help="Run inference")
    infer_parser.add_argument("model_id", help="Model ID")
    infer_parser.add_argument("--prompt", required=True, help="Input prompt")
    infer_parser.add_argument("--max-tokens", type=int, default=256)
    infer_parser.add_argument("--temperature", type=float, default=0.7)
    infer_parser.set_defaults(func=cmd_infer)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
```

**Step 3: Test CLI parsing works**

Run: `python3 python/mlx_runner.py --help`
Expected: Help text showing subcommands

Run: `python3 python/mlx_runner.py search "test"`
Expected: `{"error": "not implemented"}`

**Step 4: Commit**

```bash
git add python/
git commit -m "feat: add Python runner CLI skeleton"
```

---

## Task 3: Python Runner - List Local Models

**Files:**
- Modify: `python/mlx_runner.py`

**Step 1: Implement cmd_list function**

Replace the `cmd_list` function:

```python
def cmd_list(args):
    """List locally downloaded models."""
    from huggingface_hub import scan_cache_dir

    try:
        cache_info = scan_cache_dir()
        models = []

        for repo in cache_info.repos:
            # Only include MLX models (from mlx-community or with mlx in name)
            if "mlx" in repo.repo_id.lower() or repo.repo_id.startswith("mlx-community/"):
                # Get the most recent revision
                revisions = sorted(repo.revisions, key=lambda r: r.last_modified, reverse=True)
                if revisions:
                    latest = revisions[0]
                    models.append({
                        "model_id": repo.repo_id,
                        "size_bytes": repo.size_on_disk,
                        "size_human": f"{repo.size_on_disk / (1024**3):.1f} GB",
                        "last_modified": latest.last_modified.isoformat(),
                        "path": str(latest.snapshot_path),
                    })

        # Sort by last modified (most recent first)
        models.sort(key=lambda m: m["last_modified"], reverse=True)

        print(json.dumps({"models": models, "total_size_bytes": sum(m["size_bytes"] for m in models)}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
```

**Step 2: Test list command**

Run: `python3 python/mlx_runner.py list`
Expected: JSON with `models` array (may be empty if no MLX models downloaded)

**Step 3: Commit**

```bash
git add python/mlx_runner.py
git commit -m "feat: implement list local models command"
```

---

## Task 4: Python Runner - Search Hub

**Files:**
- Modify: `python/mlx_runner.py`

**Step 1: Implement cmd_search function**

Replace the `cmd_search` function:

```python
def cmd_search(args):
    """Search Hugging Face Hub for MLX-compatible models."""
    from huggingface_hub import HfApi

    try:
        api = HfApi()

        # Search in mlx-community org and models with mlx tag
        results = []

        # Search mlx-community organization
        models = api.list_models(
            search=args.query,
            author="mlx-community",
            sort="downloads",
            direction=-1,
            limit=args.limit,
        )

        for model in models:
            results.append({
                "model_id": model.id,
                "downloads": model.downloads or 0,
                "likes": model.likes or 0,
                "tags": model.tags or [],
                "last_modified": model.last_modified.isoformat() if model.last_modified else None,
            })

        # If we didn't find enough, also search for mlx tag
        if len(results) < args.limit:
            mlx_tagged = api.list_models(
                search=args.query,
                tags="mlx",
                sort="downloads",
                direction=-1,
                limit=args.limit - len(results),
            )

            existing_ids = {r["model_id"] for r in results}
            for model in mlx_tagged:
                if model.id not in existing_ids:
                    results.append({
                        "model_id": model.id,
                        "downloads": model.downloads or 0,
                        "likes": model.likes or 0,
                        "tags": model.tags or [],
                        "last_modified": model.last_modified.isoformat() if model.last_modified else None,
                    })

        # Sort by downloads
        results.sort(key=lambda m: m["downloads"], reverse=True)
        results = results[:args.limit]

        print(json.dumps({"results": results, "count": len(results)}))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
```

**Step 2: Test search command**

Run: `python3 python/mlx_runner.py search "llama 8b" --limit 5`
Expected: JSON with model results from mlx-community

**Step 3: Commit**

```bash
git add python/mlx_runner.py
git commit -m "feat: implement search Hugging Face Hub"
```

---

## Task 5: Python Runner - Download Model

**Files:**
- Modify: `python/mlx_runner.py`

**Step 1: Implement cmd_download function**

Replace the `cmd_download` function:

```python
def cmd_download(args):
    """Download a model from Hugging Face Hub."""
    from huggingface_hub import snapshot_download, HfApi
    from huggingface_hub.utils import GatedRepoError, RepositoryNotFoundError

    try:
        api = HfApi()

        # Check if model exists
        try:
            model_info = api.model_info(args.model_id)
        except RepositoryNotFoundError:
            print(json.dumps({"error": f"Model not found: {args.model_id}"}))
            sys.exit(1)
        except GatedRepoError:
            print(json.dumps({
                "error": f"Model {args.model_id} is gated. Run 'huggingface-cli login' first.",
                "gated": True
            }))
            sys.exit(1)

        # Download the model
        print(json.dumps({"status": "downloading", "model_id": args.model_id}), flush=True)

        path = snapshot_download(
            repo_id=args.model_id,
            local_dir_use_symlinks=False,
        )

        # Get size on disk
        from pathlib import Path
        total_size = sum(f.stat().st_size for f in Path(path).rglob("*") if f.is_file())

        print(json.dumps({
            "status": "complete",
            "model_id": args.model_id,
            "path": path,
            "size_bytes": total_size,
            "size_human": f"{total_size / (1024**3):.1f} GB",
        }))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
```

**Step 2: Test download command (dry run - small model)**

Run: `python3 python/mlx_runner.py download mlx-community/Llama-3.2-1B-Instruct-4bit`
Expected: Model downloads (warning: ~700MB, skip if bandwidth limited)

**Step 3: Commit**

```bash
git add python/mlx_runner.py
git commit -m "feat: implement model download"
```

---

## Task 6: Python Runner - Remove Model

**Files:**
- Modify: `python/mlx_runner.py`

**Step 1: Implement cmd_remove function**

Replace the `cmd_remove` function:

```python
def cmd_remove(args):
    """Remove a locally downloaded model."""
    from huggingface_hub import scan_cache_dir, HfApi
    import shutil

    try:
        cache_info = scan_cache_dir()

        # Find the model in cache
        target_repo = None
        for repo in cache_info.repos:
            if repo.repo_id == args.model_id:
                target_repo = repo
                break

        if not target_repo:
            print(json.dumps({"error": f"Model not found in cache: {args.model_id}"}))
            sys.exit(1)

        # Get size before deletion
        size_bytes = target_repo.size_on_disk

        # Delete all revisions
        delete_strategy = cache_info.delete_revisions(
            *[rev.commit_hash for rev in target_repo.revisions]
        )

        # Execute deletion
        delete_strategy.execute()

        print(json.dumps({
            "status": "removed",
            "model_id": args.model_id,
            "freed_bytes": size_bytes,
            "freed_human": f"{size_bytes / (1024**3):.1f} GB",
        }))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
```

**Step 2: Test remove command (only if you have a model to remove)**

Run: `python3 python/mlx_runner.py list` (check what's available)
Run: `python3 python/mlx_runner.py remove <model_id>` (if you want to remove one)
Expected: JSON with removal confirmation and space freed

**Step 3: Commit**

```bash
git add python/mlx_runner.py
git commit -m "feat: implement model removal"
```

---

## Task 7: Python Runner - Inference with Streaming

**Files:**
- Modify: `python/mlx_runner.py`

**Step 1: Implement cmd_infer function with streaming**

Replace the `cmd_infer` function:

```python
def cmd_infer(args):
    """Run inference on a model (streaming output)."""
    try:
        from mlx_lm import load, generate
        from mlx_lm.utils import stream_generate
        import mlx.core as mx

        # Check if model exists locally
        from huggingface_hub import scan_cache_dir
        cache_info = scan_cache_dir()

        model_path = None
        for repo in cache_info.repos:
            if repo.repo_id == args.model_id:
                revisions = sorted(repo.revisions, key=lambda r: r.last_modified, reverse=True)
                if revisions:
                    model_path = str(revisions[0].snapshot_path)
                break

        if not model_path:
            print(json.dumps({"error": f"Model not found locally: {args.model_id}. Run download first."}))
            sys.exit(1)

        # Load model and tokenizer
        print(json.dumps({"type": "status", "message": "Loading model..."}), flush=True)
        model, tokenizer = load(model_path)

        # Format prompt for chat models
        if hasattr(tokenizer, "apply_chat_template"):
            messages = [{"role": "user", "content": args.prompt}]
            prompt = tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
        else:
            prompt = args.prompt

        # Stream tokens
        print(json.dumps({"type": "status", "message": "Generating..."}), flush=True)

        tokens_generated = 0
        import time
        start_time = time.time()

        for token_text in stream_generate(
            model,
            tokenizer,
            prompt=prompt,
            max_tokens=args.max_tokens,
            temp=args.temperature,
        ):
            tokens_generated += 1
            print(json.dumps({"type": "token", "content": token_text}), flush=True)

        elapsed = time.time() - start_time
        tokens_per_sec = tokens_generated / elapsed if elapsed > 0 else 0

        print(json.dumps({
            "type": "done",
            "tokens_generated": tokens_generated,
            "tokens_per_sec": round(tokens_per_sec, 1),
            "elapsed_sec": round(elapsed, 2),
        }), flush=True)

    except ImportError as e:
        print(json.dumps({"error": f"MLX not installed: {e}. Run: pip install mlx mlx-lm"}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
```

**Step 2: Test inference (requires a downloaded model)**

Run: `python3 python/mlx_runner.py infer mlx-community/Llama-3.2-1B-Instruct-4bit --prompt "Hello, how are you?" --max-tokens 50`
Expected: Streaming JSON-lines with tokens, then done message

**Step 3: Commit**

```bash
git add python/mlx_runner.py
git commit -m "feat: implement streaming inference"
```

---

## Task 8: MCP Server - Skeleton with Tool Definitions

**Files:**
- Create: `src/mcp-server.ts`
- Create: `src/types.ts`

**Step 1: Create types.ts**

```typescript
import { z } from 'zod';

// Input schemas for tools
export const SearchInputSchema = z.object({
  query: z.string().min(1, 'Query is required'),
  limit: z.number().int().min(1).max(50).default(10),
});

export const DownloadInputSchema = z.object({
  model_id: z.string().min(1, 'Model ID is required'),
  quantization: z.enum(['4bit', '8bit']).optional(),
});

export const ListInputSchema = z.object({});

export const RemoveInputSchema = z.object({
  model_id: z.string().min(1, 'Model ID is required'),
});

export const InferInputSchema = z.object({
  model_id: z.string().min(1, 'Model ID is required'),
  prompt: z.string().min(1, 'Prompt is required'),
  max_tokens: z.number().int().min(1).max(4096).default(256),
  temperature: z.number().min(0).max(2).default(0.7),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;
export type DownloadInput = z.infer<typeof DownloadInputSchema>;
export type ListInput = z.infer<typeof ListInputSchema>;
export type RemoveInput = z.infer<typeof RemoveInputSchema>;
export type InferInput = z.infer<typeof InferInputSchema>;
```

**Step 2: Create mcp-server.ts skeleton**

```typescript
#!/usr/bin/env node
/**
 * MCP Server for mlx-hub.
 * Provides tools to search, download, and run MLX models locally.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  SearchInputSchema,
  DownloadInputSchema,
  ListInputSchema,
  RemoveInputSchema,
  InferInputSchema,
} from './types.js';

// Create MCP Server
const server = new Server(
  {
    name: 'mlx-hub',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register Tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'mlx_search',
        description: 'Search Hugging Face Hub for MLX-compatible models. Returns models from mlx-community and those tagged with mlx.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', minLength: 1, description: 'Search query (e.g., "llama 8b", "code", "mistral")' },
            limit: { type: 'number', minimum: 1, maximum: 50, default: 10, description: 'Max results to return' },
          },
          required: ['query'],
        },
      },
      {
        name: 'mlx_download',
        description: 'Download an MLX model from Hugging Face Hub to local cache.',
        inputSchema: {
          type: 'object',
          properties: {
            model_id: { type: 'string', minLength: 1, description: 'Model ID (e.g., mlx-community/Llama-3.2-3B-4bit)' },
            quantization: { type: 'string', enum: ['4bit', '8bit'], description: 'Quantization level (optional)' },
          },
          required: ['model_id'],
        },
      },
      {
        name: 'mlx_list_local',
        description: 'List all MLX models downloaded to local cache. Shows model ID, size, and last used date.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'mlx_remove',
        description: 'Remove a downloaded model from local cache to free disk space.',
        inputSchema: {
          type: 'object',
          properties: {
            model_id: { type: 'string', minLength: 1, description: 'Model ID to remove' },
          },
          required: ['model_id'],
        },
      },
      {
        name: 'mlx_infer',
        description: 'Run inference on a local MLX model. Streams tokens as they are generated.',
        inputSchema: {
          type: 'object',
          properties: {
            model_id: { type: 'string', minLength: 1, description: 'Model ID (must be downloaded first)' },
            prompt: { type: 'string', minLength: 1, description: 'Input prompt for the model' },
            max_tokens: { type: 'number', minimum: 1, maximum: 4096, default: 256, description: 'Maximum tokens to generate' },
            temperature: { type: 'number', minimum: 0, maximum: 2, default: 0.7, description: 'Sampling temperature' },
          },
          required: ['model_id', 'prompt'],
        },
      },
    ],
  };
});

// Handle Tool Calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // TODO: Implement tool handlers
  return {
    content: [{ type: 'text', text: `Tool ${name} not yet implemented` }],
    isError: true,
  };
});

// Main
async function main() {
  console.error('mlx-hub MCP server running via stdio');
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
```

**Step 3: Build and verify compilation**

Run: `npm run build`
Expected: Compiles successfully, creates dist/mcp-server.js and dist/types.js

**Step 4: Commit**

```bash
git add src/
git commit -m "feat: add MCP server skeleton with tool definitions"
```

---

## Task 9: MCP Server - Python Runner Integration

**Files:**
- Create: `src/python-runner.ts`

**Step 1: Create python-runner.ts**

```typescript
/**
 * Python Runner - executes mlx_runner.py commands and parses results.
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT = join(__dirname, '..', 'python', 'mlx_runner.py');

export interface PythonResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface StreamToken {
  type: 'token' | 'status' | 'done';
  content?: string;
  message?: string;
  tokens_generated?: number;
  tokens_per_sec?: number;
}

/**
 * Run a Python command and return the JSON result.
 */
export async function runPythonCommand(
  command: string,
  args: string[]
): Promise<PythonResult> {
  return new Promise((resolve) => {
    const proc = spawn('python3', [PYTHON_SCRIPT, command, ...args]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        try {
          const result = JSON.parse(stdout.trim().split('\n').pop() || '{}');
          resolve({ success: false, error: result.error || stderr || 'Unknown error' });
        } catch {
          resolve({ success: false, error: stderr || 'Unknown error' });
        }
        return;
      }

      try {
        // Get the last line of output (final result)
        const lines = stdout.trim().split('\n');
        const result = JSON.parse(lines[lines.length - 1]);

        if (result.error) {
          resolve({ success: false, error: result.error });
        } else {
          resolve({ success: true, data: result });
        }
      } catch (e) {
        resolve({ success: false, error: `Failed to parse output: ${stdout}` });
      }
    });

    proc.on('error', (error) => {
      resolve({ success: false, error: `Failed to spawn Python: ${error.message}` });
    });
  });
}

/**
 * Run inference with streaming output.
 * Calls the callback for each token/status update.
 */
export async function runInferenceStreaming(
  modelId: string,
  prompt: string,
  maxTokens: number,
  temperature: number,
  onToken: (token: StreamToken) => void
): Promise<PythonResult> {
  return new Promise((resolve) => {
    const proc = spawn('python3', [
      PYTHON_SCRIPT,
      'infer',
      modelId,
      '--prompt', prompt,
      '--max-tokens', maxTokens.toString(),
      '--temperature', temperature.toString(),
    ]);

    let buffer = '';
    let lastError = '';

    proc.stdout.on('data', (data) => {
      buffer += data.toString();

      // Process complete JSON lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as StreamToken;
          onToken(parsed);

          if (parsed.type === 'done') {
            resolve({ success: true, data: parsed });
          }
        } catch {
          // Ignore malformed lines
        }
      }
    });

    proc.stderr.on('data', (data) => {
      lastError += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({ success: false, error: lastError || 'Inference failed' });
      }
    });

    proc.on('error', (error) => {
      resolve({ success: false, error: `Failed to spawn Python: ${error.message}` });
    });
  });
}
```

**Step 2: Build and verify**

Run: `npm run build`
Expected: Compiles successfully

**Step 3: Commit**

```bash
git add src/python-runner.ts
git commit -m "feat: add Python runner integration module"
```

---

## Task 10: MCP Server - Implement Tool Handlers

**Files:**
- Modify: `src/mcp-server.ts`

**Step 1: Add imports and implement handlers**

Update `src/mcp-server.ts` - replace the CallToolRequestSchema handler:

```typescript
// Add import at top
import {
  runPythonCommand,
  runInferenceStreaming,
  StreamToken,
} from './python-runner.js';

// Replace the CallToolRequestSchema handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    if (name === 'mlx_search') {
      const params = SearchInputSchema.parse(args);
      const result = await runPythonCommand('search', [
        params.query,
        '--limit', params.limit.toString(),
      ]);

      if (!result.success) {
        return {
          content: [{ type: 'text', text: `Error: ${result.error}` }],
          isError: true,
        };
      }

      const data = result.data as { results: Array<{ model_id: string; downloads: number; likes: number }> };
      const formatted = data.results
        .map((m, i) => `${i + 1}. ${m.model_id} (${m.downloads.toLocaleString()} downloads, ${m.likes} likes)`)
        .join('\n');

      return {
        content: [{ type: 'text', text: `Found ${data.results.length} MLX-compatible models:\n\n${formatted}` }],
      };
    }

    if (name === 'mlx_download') {
      const params = DownloadInputSchema.parse(args);
      const cmdArgs = [params.model_id];
      if (params.quantization) {
        cmdArgs.push('--quantize', params.quantization);
      }

      const result = await runPythonCommand('download', cmdArgs);

      if (!result.success) {
        return {
          content: [{ type: 'text', text: `Error: ${result.error}` }],
          isError: true,
        };
      }

      const data = result.data as { model_id: string; path: string; size_human: string };
      return {
        content: [{ type: 'text', text: `Downloaded ${data.model_id}\nSize: ${data.size_human}\nPath: ${data.path}` }],
      };
    }

    if (name === 'mlx_list_local') {
      ListInputSchema.parse(args);
      const result = await runPythonCommand('list', []);

      if (!result.success) {
        return {
          content: [{ type: 'text', text: `Error: ${result.error}` }],
          isError: true,
        };
      }

      const data = result.data as { models: Array<{ model_id: string; size_human: string; last_modified: string }> };

      if (data.models.length === 0) {
        return {
          content: [{ type: 'text', text: 'No MLX models found locally. Use mlx_search and mlx_download to get started.' }],
        };
      }

      const formatted = data.models
        .map((m) => `- ${m.model_id} (${m.size_human}, last used: ${new Date(m.last_modified).toLocaleDateString()})`)
        .join('\n');

      return {
        content: [{ type: 'text', text: `Local MLX models:\n\n${formatted}` }],
      };
    }

    if (name === 'mlx_remove') {
      const params = RemoveInputSchema.parse(args);
      const result = await runPythonCommand('remove', [params.model_id]);

      if (!result.success) {
        return {
          content: [{ type: 'text', text: `Error: ${result.error}` }],
          isError: true,
        };
      }

      const data = result.data as { model_id: string; freed_human: string };
      return {
        content: [{ type: 'text', text: `Removed ${data.model_id}\nFreed: ${data.freed_human}` }],
      };
    }

    if (name === 'mlx_infer') {
      const params = InferInputSchema.parse(args);

      let output = '';
      const result = await runInferenceStreaming(
        params.model_id,
        params.prompt,
        params.max_tokens,
        params.temperature,
        (token: StreamToken) => {
          if (token.type === 'token' && token.content) {
            output += token.content;
          }
        }
      );

      if (!result.success) {
        return {
          content: [{ type: 'text', text: `Error: ${result.error}` }],
          isError: true,
        };
      }

      const data = result.data as { tokens_generated: number; tokens_per_sec: number };
      return {
        content: [{
          type: 'text',
          text: `${output}\n\n---\n${data.tokens_generated} tokens @ ${data.tokens_per_sec} tok/s`
        }],
      };
    }

    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
});
```

**Step 2: Build**

Run: `npm run build`
Expected: Compiles successfully

**Step 3: Commit**

```bash
git add src/mcp-server.ts
git commit -m "feat: implement all MCP tool handlers"
```

---

## Task 11: Slash Commands

**Files:**
- Create: `commands/search.md`
- Create: `commands/download.md`
- Create: `commands/models.md`
- Create: `commands/run.md`

**Step 1: Create commands/search.md**

```markdown
---
description: Search Hugging Face Hub for MLX-compatible models
---

# /mlx search

Search for MLX-compatible models on Hugging Face Hub.

## Instructions

1. Use the `mlx_search` tool with the user's query
2. Present results in a numbered list
3. Offer to download if user shows interest in a specific model

## Example

User: /mlx search "code generation 7b"

Response should include:
- Numbered list of models with download counts
- Brief note about model compatibility
- Offer to download any that interest them
```

**Step 2: Create commands/download.md**

```markdown
---
description: Download an MLX model from Hugging Face Hub
---

# /mlx download

Download an MLX model to local cache.

## Instructions

1. Use the `mlx_download` tool with the model ID
2. Report download progress and final size
3. Suggest trying the model with `/mlx run` when complete

## Example

User: /mlx download mlx-community/Qwen2.5-Coder-7B-4bit

Response should include:
- Confirmation of download start
- Final size and location
- Suggestion to run inference
```

**Step 3: Create commands/models.md**

```markdown
---
description: List locally downloaded MLX models
---

# /mlx models

List all MLX models in local cache.

## Instructions

1. Use the `mlx_list_local` tool
2. Format as a table with model name, size, and last used date
3. If no models, suggest using `/mlx search` to find some

## Example

User: /mlx models

Response should be a formatted table of local models.
```

**Step 4: Create commands/run.md**

```markdown
---
description: Run inference on a local MLX model
---

# /mlx run

Run inference on a locally downloaded MLX model.

## Instructions

1. Parse the model name (supports fuzzy matching against local models)
2. Use the `mlx_infer` tool
3. Stream the response to the user
4. Show performance stats at the end

## Arguments

- First argument: model name or partial match
- Remaining text: the prompt

## Example

User: /mlx run qwen-coder "Write a function to reverse a string"

Should fuzzy-match "qwen-coder" to "mlx-community/Qwen2.5-Coder-7B-4bit" if downloaded.
```

**Step 5: Commit**

```bash
git add commands/
git commit -m "feat: add slash commands for /mlx search, download, models, run"
```

---

## Task 12: README and Final Polish

**Files:**
- Create: `README.md`
- Create: `CLAUDE.md`

**Step 1: Create README.md**

```markdown
# mlx-hub

A Claude Code plugin for discovering, downloading, and running Hugging Face models locally using MLX on Apple Silicon.

## Requirements

- Apple Silicon Mac (M1/M2/M3/M4)
- Python 3.10+
- Node.js 18+

## Installation

```bash
# Install Python dependencies
pip install mlx mlx-lm huggingface_hub

# Add the development marketplace
claude plugin marketplace add /path/to/mlx-hub

# Install the plugin
claude plugin install mlx-hub@mlx-hub-dev

# Restart Claude Code
```

## Usage

### Search for models

```
/mlx search "llama 8b"
```

### Download a model

```
/mlx download mlx-community/Llama-3.2-3B-Instruct-4bit
```

### List local models

```
/mlx models
```

### Run inference

```
/mlx run llama "Write a haiku about programming"
```

## MCP Tools

The plugin exposes these tools that Claude can use directly:

- `mlx_search` - Search Hugging Face Hub
- `mlx_download` - Download models
- `mlx_list_local` - List cached models
- `mlx_remove` - Remove models
- `mlx_infer` - Run inference

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
```

**Step 2: Create CLAUDE.md**

```markdown
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
```

**Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: add README and CLAUDE.md"
```

---

## Task 13: Test Plugin Installation

**Step 1: Build everything**

Run: `npm run build`
Expected: dist/ directory with compiled JS

**Step 2: Install plugin locally**

Run: `claude plugin marketplace add /Users/sloan/code/mono-claude/mlx-hub`
Run: `claude plugin install mlx-hub@mlx-hub-dev`
Expected: Plugin installs successfully

**Step 3: Restart Claude Code and test**

Run: `/mlx models`
Expected: Lists local models or suggests searching

Run: `/mlx search "llama 3b"`
Expected: Returns search results from Hugging Face

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: ready for testing"
```

---

## Summary

| Task | Description | Estimated Steps |
|------|-------------|-----------------|
| 1 | Project scaffolding | 7 |
| 2 | Python CLI skeleton | 4 |
| 3 | List local models | 3 |
| 4 | Search Hub | 3 |
| 5 | Download model | 3 |
| 6 | Remove model | 3 |
| 7 | Streaming inference | 3 |
| 8 | MCP server skeleton | 4 |
| 9 | Python runner integration | 3 |
| 10 | Tool handlers | 3 |
| 11 | Slash commands | 5 |
| 12 | Documentation | 3 |
| 13 | Test installation | 4 |

**Total: 13 tasks, ~48 steps**
