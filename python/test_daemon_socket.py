#!/usr/bin/env python3
"""
Tests for Unix socket-based MLX daemon.

Run with: python3 -m unittest python/test_daemon_socket.py
"""

import json
import os
import socket
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

# Add python directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))


class TestDaemonSocketBasics(unittest.TestCase):
    """Test basic socket daemon operations."""

    def setUp(self):
        """Create a temporary directory for socket files."""
        self.temp_dir = tempfile.mkdtemp()
        self.socket_path = Path(self.temp_dir) / "test.sock"
        self.pid_path = Path(self.temp_dir) / "test.pid"

    def tearDown(self):
        """Clean up temporary files."""
        import shutil
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _send_request(self, request: dict, timeout: float = 5.0) -> dict:
        """Send a JSON-RPC request to the daemon and return the response."""
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        client.settimeout(timeout)
        client.connect(str(self.socket_path))
        try:
            # Send request
            data = json.dumps(request) + "\n"
            client.sendall(data.encode("utf-8"))

            # Receive response
            buffer = b""
            while True:
                chunk = client.recv(4096)
                if not chunk:
                    break
                buffer += chunk
                if b"\n" in buffer:
                    break

            response_line = buffer.split(b"\n")[0]
            return json.loads(response_line.decode("utf-8"))
        finally:
            client.close()

    def test_daemon_starts_and_creates_pid_file(self):
        """Daemon creates PID file on startup."""
        from mlx_daemon import MLXDaemon

        daemon = MLXDaemon(
            model_id="test/model",
            socket_path=str(self.socket_path),
            idle_timeout=1800,
        )

        # Start daemon in a thread
        daemon_thread = threading.Thread(target=daemon.start)
        daemon_thread.daemon = True
        daemon_thread.start()

        # Wait for daemon to be ready
        time.sleep(0.2)

        try:
            # Check PID file exists and contains our PID
            self.assertTrue(self.pid_path.exists())
            pid_content = self.pid_path.read_text().strip()
            self.assertEqual(int(pid_content), os.getpid())
        finally:
            daemon.stop()
            daemon_thread.join(timeout=2)

    def test_daemon_cleans_stale_socket(self):
        """Daemon removes stale socket file on startup."""
        from mlx_daemon import MLXDaemon

        # Create a stale socket file
        self.socket_path.touch()

        daemon = MLXDaemon(
            model_id="test/model",
            socket_path=str(self.socket_path),
            idle_timeout=1800,
        )

        daemon_thread = threading.Thread(target=daemon.start)
        daemon_thread.daemon = True
        daemon_thread.start()

        time.sleep(0.2)

        try:
            # Should be able to connect (stale file was removed)
            self.assertTrue(self.socket_path.exists())
        finally:
            daemon.stop()
            daemon_thread.join(timeout=2)

    def test_daemon_ping_returns_pong(self):
        """Daemon responds to ping with pong via JSON-RPC."""
        from mlx_daemon import MLXDaemon

        daemon = MLXDaemon(
            model_id="test/model",
            socket_path=str(self.socket_path),
            idle_timeout=1800,
        )

        daemon_thread = threading.Thread(target=daemon.start)
        daemon_thread.daemon = True
        daemon_thread.start()

        time.sleep(0.2)

        try:
            response = self._send_request({
                "jsonrpc": "2.0",
                "id": "test-1",
                "method": "ping",
                "params": {},
            })

            self.assertEqual(response["jsonrpc"], "2.0")
            self.assertEqual(response["id"], "test-1")
            self.assertEqual(response["result"]["type"], "pong")
            self.assertIn("timestamp", response["result"])
        finally:
            daemon.stop()
            daemon_thread.join(timeout=2)

    def test_daemon_status_returns_model_info(self):
        """Daemon returns status with model_id."""
        from mlx_daemon import MLXDaemon

        daemon = MLXDaemon(
            model_id="test/model",
            socket_path=str(self.socket_path),
            idle_timeout=1800,
        )

        daemon_thread = threading.Thread(target=daemon.start)
        daemon_thread.daemon = True
        daemon_thread.start()

        time.sleep(0.2)

        try:
            response = self._send_request({
                "jsonrpc": "2.0",
                "id": "test-2",
                "method": "status",
                "params": {},
            })

            self.assertEqual(response["jsonrpc"], "2.0")
            self.assertEqual(response["id"], "test-2")
            result = response["result"]
            self.assertEqual(result["type"], "status_report")
            self.assertEqual(result["model_id"], "test/model")
            self.assertIn("is_ready", result)
        finally:
            daemon.stop()
            daemon_thread.join(timeout=2)

    def test_daemon_unload_clears_model(self):
        """Daemon unload method returns success."""
        from mlx_daemon import MLXDaemon

        daemon = MLXDaemon(
            model_id="test/model",
            socket_path=str(self.socket_path),
            idle_timeout=1800,
        )

        daemon_thread = threading.Thread(target=daemon.start)
        daemon_thread.daemon = True
        daemon_thread.start()

        time.sleep(0.2)

        try:
            response = self._send_request({
                "jsonrpc": "2.0",
                "id": "test-3",
                "method": "unload",
                "params": {},
            })

            self.assertEqual(response["jsonrpc"], "2.0")
            self.assertEqual(response["id"], "test-3")
            self.assertEqual(response["result"]["type"], "unloaded")
        finally:
            daemon.stop()
            daemon_thread.join(timeout=2)

    def test_daemon_shutdown_stops_server(self):
        """Daemon shutdown method stops the server gracefully."""
        from mlx_daemon import MLXDaemon

        daemon = MLXDaemon(
            model_id="test/model",
            socket_path=str(self.socket_path),
            idle_timeout=1800,
        )

        daemon_thread = threading.Thread(target=daemon.start)
        daemon_thread.daemon = True
        daemon_thread.start()

        time.sleep(0.2)

        response = self._send_request({
            "jsonrpc": "2.0",
            "id": "test-4",
            "method": "shutdown",
            "params": {},
        })

        self.assertEqual(response["jsonrpc"], "2.0")
        self.assertEqual(response["id"], "test-4")
        self.assertEqual(response["result"]["type"], "shutdown")

        # Wait for daemon to stop
        daemon_thread.join(timeout=2)
        self.assertFalse(daemon_thread.is_alive())

    def test_daemon_handles_unknown_method(self):
        """Daemon returns error for unknown method."""
        from mlx_daemon import MLXDaemon

        daemon = MLXDaemon(
            model_id="test/model",
            socket_path=str(self.socket_path),
            idle_timeout=1800,
        )

        daemon_thread = threading.Thread(target=daemon.start)
        daemon_thread.daemon = True
        daemon_thread.start()

        time.sleep(0.2)

        try:
            response = self._send_request({
                "jsonrpc": "2.0",
                "id": "test-5",
                "method": "nonexistent",
                "params": {},
            })

            self.assertEqual(response["jsonrpc"], "2.0")
            self.assertEqual(response["id"], "test-5")
            self.assertIn("error", response)
            self.assertEqual(response["error"]["code"], -32601)  # Method not found
        finally:
            daemon.stop()
            daemon_thread.join(timeout=2)

    def test_daemon_handles_invalid_json(self):
        """Daemon returns parse error for invalid JSON."""
        from mlx_daemon import MLXDaemon

        daemon = MLXDaemon(
            model_id="test/model",
            socket_path=str(self.socket_path),
            idle_timeout=1800,
        )

        daemon_thread = threading.Thread(target=daemon.start)
        daemon_thread.daemon = True
        daemon_thread.start()

        time.sleep(0.2)

        try:
            # Send invalid JSON
            client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            client.settimeout(5.0)
            client.connect(str(self.socket_path))
            try:
                client.sendall(b"not valid json\n")
                buffer = b""
                while True:
                    chunk = client.recv(4096)
                    if not chunk:
                        break
                    buffer += chunk
                    if b"\n" in buffer:
                        break
                response = json.loads(buffer.split(b"\n")[0].decode("utf-8"))
            finally:
                client.close()

            self.assertIn("error", response)
            self.assertEqual(response["error"]["code"], -32700)  # Parse error
        finally:
            daemon.stop()
            daemon_thread.join(timeout=2)

    def test_daemon_cleanup_removes_socket_and_pid(self):
        """Daemon cleanup removes socket and PID files."""
        from mlx_daemon import MLXDaemon

        daemon = MLXDaemon(
            model_id="test/model",
            socket_path=str(self.socket_path),
            idle_timeout=1800,
        )

        daemon_thread = threading.Thread(target=daemon.start)
        daemon_thread.daemon = True
        daemon_thread.start()

        time.sleep(0.2)

        # Verify files exist
        self.assertTrue(self.socket_path.exists())
        self.assertTrue(self.pid_path.exists())

        # Stop daemon
        daemon.stop()
        daemon_thread.join(timeout=2)

        # Verify cleanup
        self.assertFalse(self.socket_path.exists())
        self.assertFalse(self.pid_path.exists())

    def test_daemon_handles_multiple_clients(self):
        """Daemon handles multiple simultaneous client connections."""
        from mlx_daemon import MLXDaemon

        daemon = MLXDaemon(
            model_id="test/model",
            socket_path=str(self.socket_path),
            idle_timeout=1800,
        )

        daemon_thread = threading.Thread(target=daemon.start)
        daemon_thread.daemon = True
        daemon_thread.start()

        time.sleep(0.2)

        try:
            results = []
            errors = []

            def send_ping(client_id):
                try:
                    response = self._send_request({
                        "jsonrpc": "2.0",
                        "id": f"client-{client_id}",
                        "method": "ping",
                        "params": {},
                    })
                    results.append(response)
                except Exception as e:
                    errors.append(e)

            # Send multiple pings concurrently
            threads = []
            for i in range(5):
                t = threading.Thread(target=send_ping, args=(i,))
                threads.append(t)
                t.start()

            for t in threads:
                t.join(timeout=5)

            self.assertEqual(len(errors), 0, f"Errors: {errors}")
            self.assertEqual(len(results), 5)
            for response in results:
                self.assertEqual(response["result"]["type"], "pong")
        finally:
            daemon.stop()
            daemon_thread.join(timeout=2)

    def test_daemon_infer_missing_prompt_returns_error(self):
        """Daemon infer method returns error when prompt is missing."""
        from mlx_daemon import MLXDaemon

        daemon = MLXDaemon(
            model_id="test/model",
            socket_path=str(self.socket_path),
            idle_timeout=1800,
        )

        daemon_thread = threading.Thread(target=daemon.start)
        daemon_thread.daemon = True
        daemon_thread.start()

        time.sleep(0.2)

        try:
            response = self._send_request({
                "jsonrpc": "2.0",
                "id": "test-6",
                "method": "infer",
                "params": {},  # Missing prompt
            })

            self.assertEqual(response["jsonrpc"], "2.0")
            self.assertEqual(response["id"], "test-6")
            self.assertIn("error", response)
            self.assertEqual(response["error"]["code"], -32602)  # Invalid params
            self.assertIn("prompt", response["error"]["message"].lower())
        finally:
            daemon.stop()
            daemon_thread.join(timeout=2)

    def test_daemon_infer_messages_missing_messages_returns_error(self):
        """Daemon infer_messages method returns error when messages is missing."""
        from mlx_daemon import MLXDaemon

        daemon = MLXDaemon(
            model_id="test/model",
            socket_path=str(self.socket_path),
            idle_timeout=1800,
        )

        daemon_thread = threading.Thread(target=daemon.start)
        daemon_thread.daemon = True
        daemon_thread.start()

        time.sleep(0.2)

        try:
            response = self._send_request({
                "jsonrpc": "2.0",
                "id": "test-7",
                "method": "infer_messages",
                "params": {},  # Missing messages
            })

            self.assertEqual(response["jsonrpc"], "2.0")
            self.assertEqual(response["id"], "test-7")
            self.assertIn("error", response)
            self.assertEqual(response["error"]["code"], -32602)  # Invalid params
            self.assertIn("messages", response["error"]["message"].lower())
        finally:
            daemon.stop()
            daemon_thread.join(timeout=2)

    def test_daemon_infer_model_not_found_returns_error(self):
        """Daemon infer returns error when model is not found locally."""
        from mlx_daemon import MLXDaemon

        daemon = MLXDaemon(
            model_id="nonexistent/model-that-does-not-exist",
            socket_path=str(self.socket_path),
            idle_timeout=1800,
        )

        daemon_thread = threading.Thread(target=daemon.start)
        daemon_thread.daemon = True
        daemon_thread.start()

        time.sleep(0.2)

        try:
            response = self._send_request({
                "jsonrpc": "2.0",
                "id": "test-8",
                "method": "infer",
                "params": {"prompt": "Hello, world!"},
            })

            self.assertEqual(response["jsonrpc"], "2.0")
            self.assertEqual(response["id"], "test-8")
            self.assertIn("error", response)
            self.assertEqual(response["error"]["code"], -32603)  # Internal error
            self.assertIn("not found", response["error"]["message"].lower())
        finally:
            daemon.stop()
            daemon_thread.join(timeout=2)

    def test_daemon_infer_messages_model_not_found_returns_error(self):
        """Daemon infer_messages returns error when model is not found locally."""
        from mlx_daemon import MLXDaemon

        daemon = MLXDaemon(
            model_id="nonexistent/model-that-does-not-exist",
            socket_path=str(self.socket_path),
            idle_timeout=1800,
        )

        daemon_thread = threading.Thread(target=daemon.start)
        daemon_thread.daemon = True
        daemon_thread.start()

        time.sleep(0.2)

        try:
            response = self._send_request({
                "jsonrpc": "2.0",
                "id": "test-9",
                "method": "infer_messages",
                "params": {"messages": [{"role": "user", "content": "Hello"}]},
            })

            self.assertEqual(response["jsonrpc"], "2.0")
            self.assertEqual(response["id"], "test-9")
            self.assertIn("error", response)
            self.assertEqual(response["error"]["code"], -32603)  # Internal error
            self.assertIn("not found", response["error"]["message"].lower())
        finally:
            daemon.stop()
            daemon_thread.join(timeout=2)

    def test_daemon_infer_messages_invalid_messages_type_returns_error(self):
        """Daemon infer_messages returns error when messages is not an array."""
        from mlx_daemon import MLXDaemon

        daemon = MLXDaemon(
            model_id="test/model",
            socket_path=str(self.socket_path),
            idle_timeout=1800,
        )

        daemon_thread = threading.Thread(target=daemon.start)
        daemon_thread.daemon = True
        daemon_thread.start()

        time.sleep(0.2)

        try:
            response = self._send_request({
                "jsonrpc": "2.0",
                "id": "test-10",
                "method": "infer_messages",
                "params": {"messages": "not an array"},
            })

            self.assertEqual(response["jsonrpc"], "2.0")
            self.assertEqual(response["id"], "test-10")
            self.assertIn("error", response)
            self.assertEqual(response["error"]["code"], -32602)  # Invalid params
        finally:
            daemon.stop()
            daemon_thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
