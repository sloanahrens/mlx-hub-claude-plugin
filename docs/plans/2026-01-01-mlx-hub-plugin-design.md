# mlx-hub Plugin Design

A Claude Code plugin for discovering, downloading, and running Hugging Face models locally using MLX on Apple Silicon.

## Overview

**Target Users:** Developers on M1/M2/M3/M4 Macs who want to:
- Quickly try out open-source LLMs without cloud dependencies
- Manage local model storage efficiently
- Run inference directly from Claude Code conversations

**Runtime:** MLX (Apple Silicon only)

**Scope (v1):** Core functionality - search, download, list, remove, infer. Training/fine-tuning deferred to v2.

## Plugin Structure

```
mlx-hub/
├── .claude-plugin/
│   └── plugin.json           # Plugin manifest
├── server/
│   ├── index.ts              # MCP server entry point
│   └── tools/                # Tool implementations
│       ├── search.ts
│       ├── download.ts
│       ├── list.ts
│       ├── remove.ts
│       └── infer.ts
├── commands/
│   ├── search.md             # /mlx search
│   ├── download.md           # /mlx download
│   ├── models.md             # /mlx models
│   └── run.md                # /mlx run
├── python/
│   ├── mlx_runner.py         # Python wrapper for MLX operations
│   └── requirements.txt
├── package.json
└── README.md
```

**Architecture:** The MCP server is TypeScript, but inference calls out to a Python script (`mlx_runner.py`) that uses `mlx-lm`. This keeps the MCP layer simple while leveraging MLX's native Python API.

## MCP Tools

### Tool Definitions

| Tool | Parameters | Returns |
|------|------------|---------|
| `mlx_search` | `query: string`, `limit?: number` | Array of models with name, size, downloads, MLX-compatible flag |
| `mlx_download` | `model_id: string`, `quantization?: "4bit" \| "8bit"` | Download status, path, size on disk |
| `mlx_list_local` | none | Array of local models with size, last used, path |
| `mlx_remove` | `model_id: string` | Success/failure, space freed |
| `mlx_infer` | `model_id: string`, `prompt: string`, `max_tokens?: number`, `temperature?: number` | Streamed text response |

### Implementation Notes

**`mlx_search`:** Queries `huggingface_hub` Python API, filters to models tagged with `mlx` or from `mlx-community` org. Returns top results sorted by downloads.

**`mlx_download`:** Calls `huggingface-cli download` or `mlx_lm.convert` for quantization. Models cache to `~/.cache/huggingface/hub/` (standard HF cache location).

**`mlx_infer`:** Spawns Python subprocess with `mlx_runner.py`. Uses `mlx_lm.stream_generate()` for streaming. Tokens stream back to MCP server via stdout, which forwards to Claude.

**Error handling:**
- Model not found → helpful error with suggestions
- Out of memory → suggest smaller model or quantization
- Model not downloaded → auto-prompt to download first

## Slash Commands

### /mlx search <query>

Search Hugging Face Hub for MLX-compatible models.

```
> /mlx search "code generation 7b"

Found 12 MLX-compatible models:

1. mlx-community/Qwen2.5-Coder-7B-4bit (2.1 GB) ⭐ 45k downloads
2. mlx-community/CodeLlama-7b-4bit (3.8 GB) ⭐ 32k downloads
3. mlx-community/deepseek-coder-6.7b-4bit (3.5 GB) ⭐ 18k downloads

Would you like to download one of these?
```

### /mlx download <model>

Download a model to local cache.

```
> /mlx download mlx-community/Qwen2.5-Coder-7B-4bit

Downloading Qwen2.5-Coder-7B-4bit...
████████████████████░ 89% (1.9 GB / 2.1 GB)

✓ Downloaded to ~/.cache/huggingface/hub/models--mlx-community--Qwen2.5-Coder-7B-4bit
```

### /mlx models

List locally downloaded models.

```
> /mlx models

Local models (3 total, 8.2 GB):

  Model                              Size    Last Used
  ─────────────────────────────────────────────────────
  Qwen2.5-Coder-7B-4bit             2.1 GB   2 hours ago
  Llama-3.2-3B-4bit                 1.8 GB   yesterday
  Mistral-7B-v0.3-4bit              4.3 GB   3 days ago
```

### /mlx run <model> [prompt]

Run inference on a local model.

```
> /mlx run qwen-coder "Write a Python function to reverse a string"

Using Qwen2.5-Coder-7B-4bit...

def reverse_string(s: str) -> str:
    return s[::-1]
```

Commands support fuzzy matching on model names (e.g., `qwen-coder` → `Qwen2.5-Coder-7B-4bit`).

## Python Runner

### Interface

The Python script handles actual MLX operations. The MCP server spawns it as a subprocess.

```bash
# Search
python mlx_runner.py search "query" --limit 10

# Download
python mlx_runner.py download "mlx-community/Model-Name" --quantize 4bit

# List local
python mlx_runner.py list

# Remove
python mlx_runner.py remove "mlx-community/Model-Name"

# Inference (streaming)
python mlx_runner.py infer "mlx-community/Model-Name" --prompt "Hello" --max-tokens 256
```

### Streaming Protocol

For inference, the script outputs JSON-lines to stdout:

```jsonl
{"type": "token", "content": "Hello"}
{"type": "token", "content": " world"}
{"type": "token", "content": "!"}
{"type": "done", "tokens_generated": 3, "tokens_per_sec": 45.2}
```

The MCP server reads these lines and forwards tokens as streaming responses.

### Dependencies

```
# python/requirements.txt
mlx>=0.21.0
mlx-lm>=0.19.0
huggingface_hub>=0.25.0
```

### Model Loading

Models take 2-5 seconds to load. Strategy for v1:
- **Lazy loading:** Load on first inference, keep in memory for subsequent calls
- Simpler than subprocess persistence, and users typically do multiple inferences once they load a model

## Error Handling

| Scenario | Detection | User Message |
|----------|-----------|--------------|
| Model not on Hub | 404 from HF API | "Model 'X' not found. Did you mean 'Y'?" (suggest similar) |
| Not MLX-compatible | Missing mlx tag/files | "This model isn't available in MLX format. Try mlx-community/X instead" |
| Model not downloaded | Check local cache | "Model not downloaded. Run `/mlx download X` first" |
| Out of memory | MLX memory error | "Not enough memory for this model. Try a 4-bit quantized version" |
| Python not found | Subprocess spawn fails | "Python 3.10+ required. Install via `brew install python`" |
| MLX not installed | Import error | "MLX not installed. Run `pip install mlx mlx-lm huggingface_hub`" |
| No Apple Silicon | Architecture check | "MLX requires Apple Silicon (M1/M2/M3/M4). This Mac has Intel." |

### Graceful Degradation

**Auto-download prompt:** If user runs `/mlx run model-name` and model isn't local, offer to download:
```
Model "Qwen2.5-7B" not found locally.
Download it now? (2.1 GB, ~30 seconds on fast connection)
```

**Fuzzy matching:** Typos like `qqwen` or `lama` resolve to closest match with confirmation.

**Disk space warning:** Before download, check available space. Warn if < 2GB remaining after download.

## Installation & Setup

### Prerequisites

1. **Apple Silicon Mac** (M1/M2/M3/M4)
2. **Python 3.10+** (`brew install python` or system Python)
3. **Node.js 18+** (for MCP server)

### Plugin Installation

```bash
# Install from marketplace (future)
claude plugin install mlx-hub

# Or install from local development
claude plugin marketplace add /path/to/mlx-hub
claude plugin install mlx-hub@mlx-hub-dev
```

### First-Run Setup

The plugin includes a setup skill that runs on first use:

```
Welcome to mlx-hub! Let me check your environment...

✓ Apple Silicon detected (M3 Pro)
✓ Python 3.12.0 found
✗ MLX not installed

Installing dependencies...
$ pip install mlx mlx-lm huggingface_hub

✓ Setup complete! Try: /mlx search "llama 8b"
```

### Configuration (Optional)

Users can set in `~/.claude/settings.json`:

```json
{
  "mlx-hub": {
    "defaultQuantization": "4bit",
    "cacheDir": "~/.cache/huggingface/hub",
    "maxCacheSize": "50GB"
  }
}
```

### Hugging Face Authentication

For gated models (Llama, etc.), user needs HF token:

```bash
huggingface-cli login
# or
export HF_TOKEN=hf_xxxxx
```

Plugin detects missing auth and prompts when accessing gated models.

## Future Enhancements (v2+)

- **Training/fine-tuning:** Add `mlx_train` and `mlx_push` tools when MLX training matures
- **Embeddings:** Support embedding models for RAG workflows
- **Vision:** Support multimodal models (LLaVA, Qwen-VL)
- **Model comparison:** Run same prompt across multiple models
- **Persistent process:** Keep MLX runner alive for faster subsequent inferences
- **Cache management:** Auto-cleanup of old/unused models based on maxCacheSize

## Implementation Order

1. Python runner (`mlx_runner.py`) with CLI interface
2. MCP server skeleton with tool definitions
3. `mlx_list_local` tool (simplest, good for testing)
4. `mlx_search` tool
5. `mlx_download` tool
6. `mlx_infer` tool with streaming
7. `mlx_remove` tool
8. Slash commands
9. First-run setup skill
10. Error handling refinement
11. Documentation and README
