#!/usr/bin/env python3
"""
MLX Daemon - Unix socket server for persistent model inference.

Serves a single model over a Unix domain socket using JSON-RPC 2.0 protocol.
Accepts multiple client connections via threading.

Protocol (JSON-RPC 2.0):
- Request: {"jsonrpc": "2.0", "id": "uuid", "method": "ping", "params": {}}
- Response: {"jsonrpc": "2.0", "id": "uuid", "result": {...}}
- Error: {"jsonrpc": "2.0", "id": "uuid", "error": {"code": -32600, "message": "..."}}

Methods:
- ping: Health check, returns pong with timestamp
- status: Report daemon status (model_id, is_ready, etc.)
- unload: Unload model from memory
- shutdown: Gracefully stop the daemon
- infer: Run inference with prompt, streams tokens
- infer_messages: Run inference with messages array, streams tokens
"""

import argparse
import json
import os
import signal
import socket
import sys
import threading
import time
import types
from pathlib import Path
from typing import Any, Callable, Generator, Optional, Union

# JSON-RPC 2.0 error codes
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603

# Buffer limits
MAX_REQUEST_SIZE = 1024 * 1024  # 1MB limit to prevent buffer overflow


class MLXDaemon:
    """Unix socket daemon that keeps an MLX model loaded in memory for fast inference."""

    def __init__(
        self,
        model_id: str,
        socket_path: str,
        idle_timeout: int = 1800,
    ):
        """
        Initialize the daemon.

        Args:
            model_id: The model ID this daemon serves (e.g., 'mlx-community/Llama-3.2-1B-Instruct-4bit')
            socket_path: Path to the Unix domain socket
            idle_timeout: Seconds of inactivity before auto-shutdown (default: 30 minutes)
        """
        self.model_id = model_id
        self.socket_path = Path(socket_path)
        self.pid_path = self.socket_path.with_suffix(".pid")
        self.idle_timeout = idle_timeout

        # Model state (protected by _model_lock)
        self.loaded_model: Optional[Any] = None
        self.loaded_tokenizer: Optional[Any] = None
        self.loaded_model_path: Optional[str] = None
        self._model_lock = threading.Lock()

        # Server state
        self._server_socket: Optional[socket.socket] = None
        self._shutdown_event = threading.Event()
        self._client_threads: list[threading.Thread] = []
        self._start_time = time.time()
        self._last_activity = time.time()
        self._activity_lock = threading.Lock()

    def _find_model_path(self, model_id: str) -> Optional[str]:
        """Find local path for a model ID."""
        try:
            from huggingface_hub import scan_cache_dir

            cache_info = scan_cache_dir()
            for repo in cache_info.repos:
                if repo.repo_id == model_id:
                    revisions = sorted(
                        repo.revisions,
                        key=lambda r: r.last_modified
                        if isinstance(r.last_modified, (int, float))
                        else r.last_modified.timestamp(),
                        reverse=True,
                    )
                    if revisions:
                        return str(revisions[0].snapshot_path)
        except ImportError:
            pass
        return None

    def _ensure_model_loaded(self) -> tuple[bool, str]:
        """
        Ensure the model is loaded and ready for inference.

        Returns:
            Tuple of (success, error_message). If success is True, error_message is empty.
        """
        with self._model_lock:
            if self.loaded_model is not None:
                return (True, "")

            # Find model path
            model_path = self._find_model_path(self.model_id)
            if not model_path:
                return (False, f"Model not found locally: {self.model_id}. Run download first.")

            try:
                from mlx_lm import load

                model, tokenizer = load(model_path)
                self.loaded_model = model
                self.loaded_tokenizer = tokenizer
                self.loaded_model_path = model_path
                return (True, "")
            except ImportError as e:
                return (False, f"MLX not installed: {e}. Run: pip install mlx mlx-lm")
            except Exception as e:
                return (False, f"Failed to load model: {e}")

    def _make_response(
        self, request_id: Optional[str], result: dict
    ) -> dict:
        """Create a JSON-RPC 2.0 success response."""
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": result,
        }

    def _make_error(
        self, request_id: Optional[str], code: int, message: str, data: Any = None
    ) -> dict:
        """Create a JSON-RPC 2.0 error response."""
        error = {"code": code, "message": message}
        if data is not None:
            error["data"] = data
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": error,
        }

    def _handle_ping(self, request_id: str, params: dict) -> dict:
        """Handle ping method."""
        return self._make_response(
            request_id,
            {"type": "pong", "timestamp": time.time()},
        )

    def _handle_status(self, request_id: str, params: dict) -> dict:
        """Handle status method."""
        with self._model_lock:
            loaded_path = self.loaded_model_path
            is_ready = self.loaded_model is not None
        uptime = time.time() - self._start_time
        return self._make_response(
            request_id,
            {
                "type": "status_report",
                "model_id": self.model_id,
                "loaded_path": loaded_path,
                "is_ready": is_ready,
                "uptime_seconds": uptime,
            },
        )

    def _handle_unload(self, request_id: str, params: dict) -> dict:
        """Handle unload method."""
        with self._model_lock:
            model_id = self.model_id if self.loaded_model is not None else None
            self.loaded_model = None
            self.loaded_tokenizer = None
            self.loaded_model_path = None
        return self._make_response(
            request_id,
            {"type": "unloaded", "model_id": model_id},
        )

    def _handle_shutdown(self, request_id: str, params: dict) -> dict:
        """Handle shutdown method."""
        # Signal shutdown after sending response
        self._shutdown_event.set()
        return self._make_response(
            request_id,
            {"type": "shutdown", "message": "Daemon shutting down"},
        )

    def _handle_infer(
        self, request_id: str, params: dict
    ) -> Union[dict, Generator[dict, None, None]]:
        """
        Handle infer method - run inference with a prompt.

        Params:
            prompt: The prompt text (required)
            system_prompt: Optional system prompt
            max_tokens: Maximum tokens to generate (default: 256)
            temperature: Sampling temperature (default: 0.7)

        Yields streaming responses:
            {"type": "token", "content": "..."}
            {"type": "done", "tokens_generated": N, "tokens_per_sec": X, "elapsed_sec": Y}
        """
        # Validate prompt
        prompt = params.get("prompt")
        if not prompt:
            return self._make_error(
                request_id,
                INVALID_PARAMS,
                "Missing required parameter: prompt",
            )

        # Build messages from prompt
        messages = []
        system_prompt = params.get("system_prompt")
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        # Delegate to _handle_infer_messages
        return self._handle_infer_messages(request_id, {
            "messages": messages,
            "max_tokens": params.get("max_tokens", 256),
            "temperature": params.get("temperature", 0.7),
        })

    def _handle_infer_messages(
        self, request_id: str, params: dict
    ) -> Union[dict, Generator[dict, None, None]]:
        """
        Handle infer_messages method - run inference with a messages array.

        Params:
            messages: Array of {"role": "...", "content": "..."} (required)
            max_tokens: Maximum tokens to generate (default: 256)
            temperature: Sampling temperature (default: 0.7)

        Yields streaming responses:
            {"type": "token", "content": "..."}
            {"type": "done", "tokens_generated": N, "tokens_per_sec": X, "elapsed_sec": Y}
        """
        # Validate messages
        messages = params.get("messages")
        if not messages or not isinstance(messages, list):
            return self._make_error(
                request_id,
                INVALID_PARAMS,
                "Missing required parameter: messages (must be an array)",
            )

        max_tokens = min(params.get("max_tokens", 256), 4096)
        temperature = params.get("temperature", 0.7)

        # Ensure model is loaded
        success, error_msg = self._ensure_model_loaded()
        if not success:
            return self._make_error(
                request_id,
                INTERNAL_ERROR,
                error_msg,
            )

        # Generator for streaming tokens
        def generate_tokens() -> Generator[dict, None, None]:
            try:
                from mlx_lm import stream_generate
                from mlx_lm.sample_utils import make_sampler

                with self._model_lock:
                    model = self.loaded_model
                    tokenizer = self.loaded_tokenizer

                # Format prompt using chat template if available
                if hasattr(tokenizer, "apply_chat_template"):
                    prompt = tokenizer.apply_chat_template(
                        messages, tokenize=False, add_generation_prompt=True
                    )
                else:
                    # Fallback for non-chat models
                    prompt_parts = []
                    for msg in messages:
                        role = msg.get("role", "user")
                        content = msg.get("content", "")
                        if role == "system":
                            prompt_parts.insert(0, content)
                        else:
                            prompt_parts.append(content)
                    prompt = "\n\n".join(prompt_parts)

                # Create sampler
                sampler = make_sampler(temp=temperature)

                # Stream tokens
                tokens_generated = 0
                start_time = time.time()

                for response in stream_generate(
                    model,
                    tokenizer,
                    prompt=prompt,
                    max_tokens=max_tokens,
                    sampler=sampler,
                ):
                    tokens_generated += 1
                    token_text = response.text if hasattr(response, "text") else str(response)
                    yield self._make_response(
                        request_id,
                        {"type": "token", "content": token_text},
                    )

                elapsed = time.time() - start_time
                tokens_per_sec = tokens_generated / elapsed if elapsed > 0 else 0

                yield self._make_response(
                    request_id,
                    {
                        "type": "done",
                        "tokens_generated": tokens_generated,
                        "tokens_per_sec": round(tokens_per_sec, 1),
                        "elapsed_sec": round(elapsed, 2),
                    },
                )

            except ImportError as e:
                yield self._make_error(
                    request_id,
                    INTERNAL_ERROR,
                    f"MLX not installed: {e}. Run: pip install mlx mlx-lm",
                )
            except Exception as e:
                yield self._make_error(
                    request_id,
                    INTERNAL_ERROR,
                    f"Inference error: {e}",
                )

        return generate_tokens()

    def _dispatch(
        self, request: dict
    ) -> Union[dict, Generator[dict, None, None]]:
        """Dispatch a JSON-RPC request to the appropriate handler."""
        request_id = request.get("id")
        method = request.get("method", "")
        params = request.get("params", {})

        handlers = {
            "ping": self._handle_ping,
            "status": self._handle_status,
            "unload": self._handle_unload,
            "shutdown": self._handle_shutdown,
            "infer": self._handle_infer,
            "infer_messages": self._handle_infer_messages,
        }

        handler = handlers.get(method)
        if handler is None:
            return self._make_error(
                request_id,
                METHOD_NOT_FOUND,
                f"Method not found: {method}",
            )

        try:
            return handler(request_id, params)
        except Exception as e:
            return self._make_error(
                request_id,
                INTERNAL_ERROR,
                str(e),
            )

    def _handle_client(self, client_socket: socket.socket, addr: Any) -> None:
        """Handle a single client connection."""
        try:
            client_socket.settimeout(60.0)  # 1 minute timeout per request
            buffer = b""

            while not self._shutdown_event.is_set():
                try:
                    chunk = client_socket.recv(4096)
                    if not chunk:
                        break
                    buffer += chunk

                    # Check for buffer overflow
                    if len(buffer) > MAX_REQUEST_SIZE:
                        response = self._make_error(
                            None,
                            INVALID_REQUEST,
                            f"Request too large (max {MAX_REQUEST_SIZE} bytes)",
                        )
                        client_socket.sendall(
                            (json.dumps(response) + "\n").encode("utf-8")
                        )
                        return

                    # Process complete lines
                    while b"\n" in buffer:
                        line, buffer = buffer.split(b"\n", 1)
                        if not line.strip():
                            continue

                        with self._activity_lock:
                            self._last_activity = time.time()

                        # Parse request
                        try:
                            request = json.loads(line.decode("utf-8"))
                        except json.JSONDecodeError as e:
                            response = self._make_error(
                                None,
                                PARSE_ERROR,
                                f"Parse error: {e}",
                            )
                            client_socket.sendall(
                                (json.dumps(response) + "\n").encode("utf-8")
                            )
                            continue

                        # Dispatch and send response
                        response = self._dispatch(request)

                        # Check if response is a generator (streaming)
                        if isinstance(response, types.GeneratorType):
                            # Streaming response - send each item
                            for item in response:
                                client_socket.sendall(
                                    (json.dumps(item) + "\n").encode("utf-8")
                                )
                        else:
                            # Single response
                            client_socket.sendall(
                                (json.dumps(response) + "\n").encode("utf-8")
                            )

                        # Close connection after response
                        return

                except socket.timeout:
                    break

        except Exception as e:
            # Log error but don't crash the server
            print(f"Error handling client: {e}", file=sys.stderr)
        finally:
            try:
                client_socket.close()
            except Exception:
                pass

    def _cleanup(self) -> None:
        """Remove socket and PID files."""
        try:
            if self.socket_path.exists():
                self.socket_path.unlink()
        except Exception:
            pass

        try:
            if self.pid_path.exists():
                self.pid_path.unlink()
        except Exception:
            pass

    def start(self) -> None:
        """Start the daemon server."""
        # Ensure parent directory exists
        self.socket_path.parent.mkdir(parents=True, exist_ok=True)

        # Clean up stale socket
        if self.socket_path.exists():
            try:
                self.socket_path.unlink()
            except Exception:
                pass

        # Write PID file
        self.pid_path.write_text(str(os.getpid()))

        # Create and bind socket
        self._server_socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self._server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._server_socket.bind(str(self.socket_path))
        self._server_socket.listen(5)
        self._server_socket.settimeout(1.0)  # Allow periodic shutdown check

        try:
            while not self._shutdown_event.is_set():
                try:
                    client_socket, addr = self._server_socket.accept()
                    # Handle each client in a new thread
                    thread = threading.Thread(
                        target=self._handle_client,
                        args=(client_socket, addr),
                        daemon=True,
                    )
                    thread.start()
                    self._client_threads.append(thread)

                    # Clean up finished threads
                    self._client_threads = [
                        t for t in self._client_threads if t.is_alive()
                    ]

                except socket.timeout:
                    # Check for idle timeout
                    if self.idle_timeout > 0:
                        with self._activity_lock:
                            idle_time = time.time() - self._last_activity
                        if idle_time > self.idle_timeout:
                            print(
                                f"Idle timeout ({self.idle_timeout}s) reached, shutting down",
                                file=sys.stderr,
                            )
                            break
                    continue

        finally:
            # Join all active client threads before cleanup
            for t in self._client_threads:
                t.join(timeout=2.0)
            self._cleanup()
            if self._server_socket:
                try:
                    self._server_socket.close()
                except Exception:
                    pass

    def stop(self) -> None:
        """Signal the daemon to stop."""
        self._shutdown_event.set()


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="MLX Daemon - Unix socket server")
    parser.add_argument(
        "model_id",
        help="Model ID to serve (e.g., mlx-community/Llama-3.2-1B-Instruct-4bit)",
    )
    parser.add_argument(
        "--socket",
        required=True,
        help="Path to Unix domain socket",
    )
    parser.add_argument(
        "--idle-timeout",
        type=int,
        default=1800,
        help="Seconds of inactivity before auto-shutdown (default: 1800)",
    )

    args = parser.parse_args()

    daemon = MLXDaemon(
        model_id=args.model_id,
        socket_path=args.socket,
        idle_timeout=args.idle_timeout,
    )

    # Handle SIGTERM gracefully
    def signal_handler(signum, frame):
        print("Received signal, shutting down...", file=sys.stderr)
        daemon.stop()

    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    try:
        daemon.start()
    except Exception as e:
        print(json.dumps({"type": "fatal", "error": str(e)}), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
