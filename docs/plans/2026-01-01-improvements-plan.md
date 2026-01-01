# mlx-hub Improvements Plan

**Created**: 2026-01-01
**Status**: Draft
**Scope**: Comprehensive improvements to reliability, features, and developer experience

## Overview

This plan addresses gaps identified in the mlx-hub plugin review, organized by implementation priority. The goal is to make mlx-hub production-ready and genuinely useful for local ML workflows.

---

## Phase 1: Foundation (High-value, Low-effort)

### 1.1 Add Test Suite

**Problem**: Zero test files despite vitest configuration. A plugin that spawns Python subprocesses needs tests.

**Scope**:
- Unit tests for `types.ts` schema validation
- Unit tests for `python-runner.ts` (mock subprocess)
- Integration tests for MCP server tool handlers
- Python tests for `mlx_runner.py` commands

**Files to create**:
```
src/__tests__/
  types.test.ts        # Zod schema edge cases
  python-runner.test.ts # Subprocess mocking
  mcp-server.test.ts   # Tool handler logic
python/
  test_mlx_runner.py   # Python CLI tests
```

**Acceptance criteria**:
- [ ] `npm test` runs and passes
- [ ] `python -m pytest python/` runs and passes
- [ ] Coverage for all 5 MCP tools
- [ ] Error path coverage (model not found, network errors, etc.)

---

### 1.2 Model Info Command

**Problem**: Users can't see model details (parameters, quantization, context length) before downloading.

**Scope**:
- New MCP tool: `mlx_info`
- New slash command: `/mlx info <model_id>`

**Implementation**:
```python
# In mlx_runner.py
def cmd_info(args):
    """Get detailed model information from HF Hub."""
    from huggingface_hub import HfApi
    api = HfApi()
    info = api.model_info(args.model_id)
    # Extract: parameters, quantization, context_length from config.json
    # Return: model card excerpt, size estimate, hardware requirements
```

**Output format**:
```
Model: mlx-community/Llama-3.2-3B-Instruct-4bit
Parameters: 3.2B (4-bit quantized)
Context: 8192 tokens
Size: ~1.8 GB
Downloads: 45,231
Description: Instruction-tuned Llama 3.2 optimized for MLX...
```

**Acceptance criteria**:
- [ ] `mlx_info` tool registered in MCP server
- [ ] `/mlx info` slash command works
- [ ] Shows parameter count, quantization, context length
- [ ] Graceful error for non-existent models

---

### 1.3 Download Progress Reporting

**Problem**: 70GB model downloads show nothing — users think it's frozen.

**Scope**:
- Stream progress updates during `snapshot_download`
- Show bytes downloaded, percentage, ETA

**Implementation**:
```python
# In cmd_download
from huggingface_hub import snapshot_download
from tqdm.auto import tqdm

# Use tqdm callback or hf_hub progress callback
# Stream JSON progress updates like inference does:
# {"type": "progress", "downloaded": 1024000, "total": 70000000000, "percent": 0.01}
```

**Acceptance criteria**:
- [ ] Progress updates stream during download
- [ ] Shows percentage and downloaded size
- [ ] Works for multi-file model downloads
- [ ] Final message shows total size and path

---

## Phase 2: Core Features (High-value, Moderate-effort)

### 2.1 System Prompt Support

**Problem**: Chat models need system prompts for real-world use. Currently impossible.

**Scope**:
- Add `system_prompt` parameter to `mlx_infer` tool
- Update Python runner to include system message in chat template

**Implementation**:
```typescript
// In mcp-server.ts mlx_infer schema
system_prompt: {
  type: 'string',
  description: 'System prompt for chat models (optional)'
}
```

```python
# In cmd_infer
if args.system_prompt:
    messages = [
        {"role": "system", "content": args.system_prompt},
        {"role": "user", "content": args.prompt}
    ]
else:
    messages = [{"role": "user", "content": args.prompt}]
```

**Acceptance criteria**:
- [ ] System prompt parameter accepted
- [ ] Correctly formatted in chat template
- [ ] Works with models that support/don't support system prompts
- [ ] Documented in tool description

---

### 2.2 Persistent Python Process

**Problem**: Each inference spawns a fresh `python3` process. Model loading takes 5-10 seconds, making sequential calls painful.

**Scope**:
- Long-running Python daemon with stdin/stdout JSON-RPC
- Keep model loaded in memory between calls
- Graceful shutdown and reload

**Architecture options**:

**Option A: Simple stdin daemon**
```
Node.js ──JSON──► Python daemon (keeps model loaded)
                  ↓
              MLX inference
                  ↓
         ◄──JSON stream──
```

**Option B: Unix socket server**
```
Python server on /tmp/mlx-hub.sock
Node.js connects per-request
Model stays loaded
```

**Recommendation**: Option A (simpler, no socket management)

**Implementation sketch**:
```python
# python/mlx_daemon.py
import sys, json

loaded_model = None
loaded_model_id = None

while True:
    line = sys.stdin.readline()
    if not line:
        break
    request = json.loads(line)

    if request["command"] == "infer":
        if request["model_id"] != loaded_model_id:
            # Load new model
            loaded_model, tokenizer = load(model_path)
            loaded_model_id = request["model_id"]
        # Run inference with already-loaded model
        ...
```

**Acceptance criteria**:
- [ ] Model stays loaded between `mlx_infer` calls
- [ ] Second inference on same model is <1s (vs 5-10s cold)
- [ ] Different model triggers reload
- [ ] Daemon exits cleanly on Node.js shutdown
- [ ] Fallback to subprocess mode if daemon fails

---

### 2.3 Conversation Memory

**Problem**: Multi-turn chat is impossible. Each call is stateless.

**Scope**:
- Add `messages` array parameter (alternative to `prompt`)
- Support OpenAI-style message format
- Optional `conversation_id` for server-side state

**Implementation**:
```typescript
// New parameter schema
messages: {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      role: { enum: ['system', 'user', 'assistant'] },
      content: { type: 'string' }
    }
  },
  description: 'Chat messages array (alternative to prompt)'
}
```

**Usage**:
```json
{
  "model_id": "mlx-community/Llama-3.2-3B-Instruct-4bit",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "What is 2+2?"},
    {"role": "assistant", "content": "4"},
    {"role": "user", "content": "Multiply that by 10"}
  ]
}
```

**Acceptance criteria**:
- [ ] `messages` array accepted as alternative to `prompt`
- [ ] Correctly formatted via `apply_chat_template`
- [ ] Either `prompt` or `messages` required (not both)
- [ ] Works with system prompts in messages array

---

## Phase 3: Polish (Lower Priority)

### 3.1 Wire Up Quantization in Download

**Problem**: `--quantize` flag exists but isn't used.

**Current state**: `DownloadInputSchema` accepts `quantization` but `cmd_download` ignores it.

**Options**:
1. Download pre-quantized model variant (if available on Hub)
2. Download full model and quantize locally via `mlx_lm.convert`
3. Remove the parameter if not useful

**Recommendation**: Option 1 — search for `{model_id}-{quantization}` variant first.

---

### 3.2 Fuzzy Model Matching for /mlx run

**Problem**: Slash command mentions fuzzy matching but it's not implemented.

**Scope**:
- Match partial model names against local cache
- Example: `llama-3b` → `mlx-community/Llama-3.2-3B-Instruct-4bit`

**Implementation**: Simple substring/lowercase matching against cached model IDs.

---

### 3.3 Retry Logic for Network Operations

**Scope**:
- Retry with backoff for `search` and `download` on network errors
- Not critical for local operations (list, remove, infer)

---

## Implementation Order

Suggested sequence based on dependencies and value:

```
Week 1: Foundation
├── 1.1 Test suite (unblocks safe refactoring)
├── 1.2 Model info command (standalone)
└── 1.3 Download progress (standalone)

Week 2: Core features
├── 2.1 System prompt support (quick win)
├── 2.2 Persistent Python process (enables 2.3)
└── 2.3 Conversation memory (builds on 2.1, 2.2)

Week 3: Polish
├── 3.1 Quantization wiring
├── 3.2 Fuzzy matching
└── 3.3 Retry logic
```

## Open Questions

1. **Daemon lifecycle**: Should the Python daemon auto-start on first inference, or require explicit `/mlx start`?

2. **Memory limits**: Should we unload models after N minutes of inactivity to free RAM?

3. **Multiple models**: Support keeping 2+ models loaded simultaneously (for fast/quality tier switching)?

4. **Streaming in MCP**: Current MCP SDK may not support true streaming — verify before implementing progress reporting.

---

## Success Metrics

- [ ] Test coverage >80% for TypeScript, >70% for Python
- [ ] Cold inference: <10s for 3B model
- [ ] Warm inference: <1s for same model
- [ ] Download progress visible within 2s of starting
- [ ] Multi-turn conversation works correctly
