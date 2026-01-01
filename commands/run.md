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
