---
name: mlx status
description: Show MLX daemon status and loaded model info
---

# /mlx status

Check the status of the MLX inference daemon. Shows whether a model is currently loaded in memory for fast inference.

## Usage

```bash
/mlx status
```

## What It Shows

- **Daemon mode**: Whether the persistent daemon is active, disabled, or not yet started
- **Loaded model**: If a model is loaded, shows which one is ready for fast inference

## Why This Matters

The MLX daemon keeps models loaded in memory between inference calls. This dramatically reduces latency:

- **Cold start**: 5-10 seconds (loading model from disk)
- **Warm inference**: <1 second (model already in memory)

If the daemon shows a different model than you want to use, the next `mlx_infer` call will automatically unload the current model and load the new one.

## Implementation

Use the `mlx_status` MCP tool to get the current daemon state.
