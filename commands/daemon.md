---
description: Manage MLX daemons (status, stop, preload)
---

# /mlx-hub:daemon

Manage shared MLX model daemons. Each model runs its own daemon process that keeps the model loaded in memory for fast inference.

## Usage

- `/mlx daemon status` - List running daemons with model info and memory usage
- `/mlx daemon stop <model>` - Stop a specific daemon by model ID
- `/mlx daemon stop-all` - Stop all running daemons
- `/mlx daemon preload <model>` - Pre-load a model by starting its daemon

## Implementation

### Daemon Directory

Daemons store their socket and PID files in `~/.mlx-hub/daemons/`:
- Socket files: `<model-name>.sock`
- PID files: `<model-name>.pid`

Model names are normalized: `mlx-community/` prefix stripped, lowercase, non-alphanumeric replaced with hyphens.

### status Subcommand

List all running daemons:

1. List all `.sock` files in `~/.mlx-hub/daemons/`
2. For each socket file:
   - Read the corresponding `.pid` file
   - Check if the process is alive using `ps -p <pid>`
   - If alive, connect to the socket and send a status request using JSON-RPC:
     ```json
     {"jsonrpc": "2.0", "id": "1", "method": "status", "params": {}}
     ```
   - Parse the response to get: model_id, is_ready, uptime_seconds
3. Display results in a table format:
   ```
   Model                                          Status    Uptime    Socket
   mlx-community/Llama-3.2-1B-Instruct-4bit      ready     5m 23s    llama-3-2-1b-instruct-4bit.sock
   mlx-community/Qwen2.5-Coder-7B-4bit           loading   0m 12s    qwen2-5-coder-7b-4bit.sock
   ```
4. If no daemons are running, display: "No MLX daemons running."

To get memory usage, use `ps -o rss= -p <pid>` and convert to human-readable format.

### stop <model> Subcommand

Stop a specific daemon:

1. Parse the model argument (supports fuzzy matching against running daemons)
2. Find the corresponding socket file
3. Connect to the socket and send shutdown request:
   ```json
   {"jsonrpc": "2.0", "id": "1", "method": "shutdown", "params": {}}
   ```
4. Wait for the response: `{"type": "shutdown", "message": "Daemon shutting down"}`
5. Verify the daemon has stopped by checking the PID
6. Display: "Stopped daemon for <model_id>"

If the daemon doesn't respond within 5 seconds, forcefully kill it using the PID.

### stop-all Subcommand

Stop all running daemons:

1. List all `.sock` files in `~/.mlx-hub/daemons/`
2. For each socket file, execute the same logic as `stop <model>`
3. Report each daemon stopped
4. Display summary: "Stopped N daemons."

If no daemons are running, display: "No daemons to stop."

### preload <model> Subcommand

Pre-load a model by starting its daemon:

1. Parse the model argument (supports fuzzy matching against local models)
2. If model not found locally, suggest using `/mlx download <model>` first
3. Use the DaemonClient to connect to the model's daemon:
   - DaemonClient auto-starts the daemon if not running
   - Pass the model ID to the DaemonClient constructor
4. Send a ping to verify the daemon is responsive:
   ```json
   {"jsonrpc": "2.0", "id": "1", "method": "ping", "params": {}}
   ```
5. Optionally send a status request to trigger model loading
6. Display: "Preloaded <model_id> - daemon ready for inference"

Note: The model won't actually be loaded into memory until the first inference request. The daemon starts but defers model loading. To fully warm the model, you could send a minimal inference request.

## Examples

```bash
# Check what's running
/mlx daemon status

# Stop a specific daemon
/mlx daemon stop llama-1b

# Stop all daemons to free memory
/mlx daemon stop-all

# Pre-load a model for fast first inference
/mlx daemon preload qwen-coder
```

## Error Handling

- If socket file exists but daemon is dead: Clean up stale socket/PID files
- If model not found for preload: Suggest downloading first
- If shutdown times out: Force kill using SIGTERM/SIGKILL
- If socket connection fails: Report daemon as unresponsive

## Why Use This

- **Memory management**: Stop daemons you're not using to free GPU/RAM
- **Pre-warming**: Preload models before needing them for faster first inference
- **Debugging**: Check daemon status when inference seems slow or broken
