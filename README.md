# mlx-hub

A Claude Code plugin for discovering, downloading, and running Hugging Face models locally using MLX on Apple Silicon.

> **See also:** [slash-commands](https://github.com/sloanahrens/slash-commands) - Portable slash commands for multi-repo workspace management

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
