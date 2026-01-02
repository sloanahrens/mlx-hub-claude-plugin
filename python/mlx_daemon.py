#!/usr/bin/env python3
"""
MLX Daemon - Long-running process that keeps models loaded in memory.
Communicates via JSON over stdin/stdout.

Protocol:
- Read one JSON line from stdin
- Execute command
- Write JSON response(s) to stdout (streaming for inference)
- Repeat until EOF or "shutdown" command
"""

import json
import sys
import time
from typing import Optional, Tuple, Any


class MLXDaemon:
    """Daemon that keeps MLX models loaded in memory for fast inference."""

    def __init__(self):
        self.loaded_model: Optional[Any] = None
        self.loaded_tokenizer: Optional[Any] = None
        self.loaded_model_id: Optional[str] = None
        self.loaded_model_path: Optional[str] = None

    def _send(self, data: dict) -> None:
        """Send a JSON response to stdout."""
        print(json.dumps(data), flush=True)

    def _find_model_path(self, model_id: str) -> Optional[str]:
        """Find local path for a model ID."""
        from huggingface_hub import scan_cache_dir

        cache_info = scan_cache_dir()
        for repo in cache_info.repos:
            if repo.repo_id == model_id:
                revisions = sorted(
                    repo.revisions,
                    key=lambda r: r.last_modified if isinstance(r.last_modified, (int, float)) else r.last_modified.timestamp(),
                    reverse=True
                )
                if revisions:
                    return str(revisions[0].snapshot_path)
        return None

    def _ensure_model_loaded(self, model_id: str) -> Tuple[bool, Optional[str]]:
        """
        Ensure the requested model is loaded.
        Returns (success, error_message).
        """
        # Already loaded?
        if self.loaded_model_id == model_id and self.loaded_model is not None:
            return True, None

        # Find model path
        model_path = self._find_model_path(model_id)
        if not model_path:
            return False, f"Model not found locally: {model_id}. Run download first."

        # Unload current model if different
        if self.loaded_model is not None:
            self._send({"type": "status", "message": f"Unloading {self.loaded_model_id}..."})
            self.loaded_model = None
            self.loaded_tokenizer = None
            self.loaded_model_id = None
            self.loaded_model_path = None

        # Load new model
        try:
            from mlx_lm import load

            self._send({"type": "status", "message": f"Loading {model_id}..."})
            start = time.time()
            self.loaded_model, self.loaded_tokenizer = load(model_path)
            elapsed = time.time() - start
            self.loaded_model_id = model_id
            self.loaded_model_path = model_path
            self._send({
                "type": "status",
                "message": f"Loaded {model_id} in {elapsed:.1f}s"
            })
            return True, None
        except ImportError as e:
            return False, f"MLX not installed: {e}. Run: pip install mlx mlx-lm"
        except Exception as e:
            return False, f"Failed to load model: {e}"

    def cmd_infer(self, request: dict) -> None:
        """Run inference on the loaded model."""
        model_id = request.get("model_id")
        prompt = request.get("prompt")
        system_prompt = request.get("system_prompt")
        max_tokens = request.get("max_tokens", 256)
        temperature = request.get("temperature", 0.7)

        if not model_id or not prompt:
            self._send({"type": "error", "error": "model_id and prompt are required"})
            return

        # Ensure model is loaded
        success, error = self._ensure_model_loaded(model_id)
        if not success:
            self._send({"type": "error", "error": error})
            return

        try:
            from mlx_lm import stream_generate
            from mlx_lm.sample_utils import make_sampler

            # Format prompt for chat models
            if hasattr(self.loaded_tokenizer, "apply_chat_template"):
                messages = []
                if system_prompt:
                    messages.append({"role": "system", "content": system_prompt})
                messages.append({"role": "user", "content": prompt})
                formatted_prompt = self.loaded_tokenizer.apply_chat_template(
                    messages, tokenize=False, add_generation_prompt=True
                )
            else:
                if system_prompt:
                    formatted_prompt = f"{system_prompt}\n\n{prompt}"
                else:
                    formatted_prompt = prompt

            # Create sampler
            sampler = make_sampler(temp=temperature)

            # Stream tokens
            self._send({"type": "status", "message": "Generating..."})
            tokens_generated = 0
            start_time = time.time()

            for response in stream_generate(
                self.loaded_model,
                self.loaded_tokenizer,
                prompt=formatted_prompt,
                max_tokens=max_tokens,
                sampler=sampler,
            ):
                tokens_generated += 1
                token_text = response.text if hasattr(response, 'text') else str(response)
                self._send({"type": "token", "content": token_text})

            elapsed = time.time() - start_time
            tokens_per_sec = tokens_generated / elapsed if elapsed > 0 else 0

            self._send({
                "type": "done",
                "tokens_generated": tokens_generated,
                "tokens_per_sec": round(tokens_per_sec, 1),
                "elapsed_sec": round(elapsed, 2),
            })

        except Exception as e:
            self._send({"type": "error", "error": str(e)})

    def cmd_infer_messages(self, request: dict) -> None:
        """Run inference with a messages array (for multi-turn chat)."""
        model_id = request.get("model_id")
        messages = request.get("messages", [])
        max_tokens = request.get("max_tokens", 256)
        temperature = request.get("temperature", 0.7)

        if not model_id or not messages:
            self._send({"type": "error", "error": "model_id and messages are required"})
            return

        # Ensure model is loaded
        success, error = self._ensure_model_loaded(model_id)
        if not success:
            self._send({"type": "error", "error": error})
            return

        try:
            from mlx_lm import stream_generate
            from mlx_lm.sample_utils import make_sampler

            # Format messages using chat template
            if hasattr(self.loaded_tokenizer, "apply_chat_template"):
                formatted_prompt = self.loaded_tokenizer.apply_chat_template(
                    messages, tokenize=False, add_generation_prompt=True
                )
            else:
                # Fallback: concatenate messages
                formatted_prompt = "\n".join(
                    f"{m.get('role', 'user')}: {m.get('content', '')}"
                    for m in messages
                )

            # Create sampler
            sampler = make_sampler(temp=temperature)

            # Stream tokens
            self._send({"type": "status", "message": "Generating..."})
            tokens_generated = 0
            start_time = time.time()

            for response in stream_generate(
                self.loaded_model,
                self.loaded_tokenizer,
                prompt=formatted_prompt,
                max_tokens=max_tokens,
                sampler=sampler,
            ):
                tokens_generated += 1
                token_text = response.text if hasattr(response, 'text') else str(response)
                self._send({"type": "token", "content": token_text})

            elapsed = time.time() - start_time
            tokens_per_sec = tokens_generated / elapsed if elapsed > 0 else 0

            self._send({
                "type": "done",
                "tokens_generated": tokens_generated,
                "tokens_per_sec": round(tokens_per_sec, 1),
                "elapsed_sec": round(elapsed, 2),
            })

        except Exception as e:
            self._send({"type": "error", "error": str(e)})

    def cmd_status(self, request: dict) -> None:
        """Report current daemon status."""
        self._send({
            "type": "status_report",
            "loaded_model": self.loaded_model_id,
            "loaded_path": self.loaded_model_path,
            "is_ready": self.loaded_model is not None,
        })

    def cmd_unload(self, request: dict) -> None:
        """Unload the current model to free memory."""
        if self.loaded_model is not None:
            model_id = self.loaded_model_id
            self.loaded_model = None
            self.loaded_tokenizer = None
            self.loaded_model_id = None
            self.loaded_model_path = None
            self._send({"type": "unloaded", "model_id": model_id})
        else:
            self._send({"type": "unloaded", "model_id": None})

    def cmd_ping(self, request: dict) -> None:
        """Health check."""
        self._send({"type": "pong", "timestamp": time.time()})

    def run(self) -> None:
        """Main daemon loop."""
        self._send({"type": "ready", "message": "MLX daemon started"})

        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue

            try:
                request = json.loads(line)
            except json.JSONDecodeError as e:
                self._send({"type": "error", "error": f"Invalid JSON: {e}"})
                continue

            command = request.get("command", "")

            if command == "shutdown":
                self._send({"type": "shutdown", "message": "Daemon shutting down"})
                break
            elif command == "ping":
                self.cmd_ping(request)
            elif command == "status":
                self.cmd_status(request)
            elif command == "unload":
                self.cmd_unload(request)
            elif command == "infer":
                self.cmd_infer(request)
            elif command == "infer_messages":
                self.cmd_infer_messages(request)
            else:
                self._send({"type": "error", "error": f"Unknown command: {command}"})


def main():
    daemon = MLXDaemon()
    try:
        daemon.run()
    except KeyboardInterrupt:
        pass
    except Exception as e:
        print(json.dumps({"type": "fatal", "error": str(e)}), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
