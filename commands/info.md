---
description: Get detailed information about an MLX model
---

# /mlx info

Get detailed information about a model from Hugging Face Hub.

## Instructions

1. Parse the model ID from the user's input
2. Use the `mlx_info` tool to fetch model details
3. Present the information in a readable format
4. Indicate whether the model is already downloaded locally

## Arguments

- First argument: model ID (e.g., `mlx-community/Llama-3.2-3B-Instruct-4bit`)

## Example

User: /mlx info mlx-community/Llama-3.2-1B-Instruct-4bit

Response should include:
- Model name and type
- Parameter count and quantization
- Context window size
- Download count and popularity
- Whether it's downloaded locally (and size if so)
