#!/usr/bin/env python3
"""
Tests for mlx_runner.py

Uses unittest (built-in) so no extra dependencies needed.
Run with: python3 -m unittest python/test_mlx_runner.py
"""

import unittest
from unittest.mock import patch, MagicMock
import json
import sys
from io import StringIO
from pathlib import Path

# Add python directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from mlx_runner import _format_timestamp, JsonProgressBar


class TestFormatTimestamp(unittest.TestCase):
    """Test the timestamp formatting helper."""

    def test_formats_float_timestamp(self):
        result = _format_timestamp(1704067200.0)  # 2024-01-01 00:00:00 UTC
        # Accept any valid ISO format (timezone may vary)
        self.assertRegex(result, r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")

    def test_formats_datetime_object(self):
        from datetime import datetime
        dt = datetime(2024, 6, 15, 12, 30, 0)
        result = _format_timestamp(dt)
        self.assertEqual(result, "2024-06-15T12:30:00")

    def test_formats_string_fallback(self):
        result = _format_timestamp("some-string")
        self.assertEqual(result, "some-string")


class TestJsonProgressBar(unittest.TestCase):
    """Test the JSON progress bar for downloads."""

    def test_emits_progress_at_intervals(self):
        captured = StringIO()
        sys.stdout = captured

        bar = JsonProgressBar(total=100, desc="test.bin")
        # Update in small increments
        for _ in range(100):
            bar.update(1)
        bar.close()

        sys.stdout = sys.__stdout__
        output = captured.getvalue()

        # Should emit roughly every 5% (around 20 updates for 0-100%)
        lines = [l for l in output.strip().split('\n') if l]
        self.assertGreaterEqual(len(lines), 10)  # At least 10 updates
        self.assertLessEqual(len(lines), 25)  # Not more than 25

        # Check first progress update has expected format
        first = json.loads(lines[0])
        self.assertEqual(first["type"], "progress")
        self.assertEqual(first["file"], "test.bin")
        self.assertIn("percent", first)
        self.assertLessEqual(first["percent"], 10)  # First emit is early

        # Check last progress update is 100%
        last = json.loads(lines[-1])
        self.assertEqual(last["percent"], 100)

    def test_context_manager(self):
        with JsonProgressBar(total=10) as bar:
            bar.update(10)
        # Should not raise


class TestCmdSearch(unittest.TestCase):
    """Test the search command."""

    @patch('huggingface_hub.HfApi')
    def test_search_returns_results(self, mock_api_class):
        from mlx_runner import cmd_search

        mock_api = MagicMock()
        mock_api_class.return_value = mock_api

        # Create mock model objects
        mock_model = MagicMock()
        mock_model.id = "mlx-community/Test-Model"
        mock_model.downloads = 1000
        mock_model.likes = 50
        mock_model.tags = ["mlx"]
        mock_model.last_modified = 1704067200.0

        mock_api.list_models.return_value = [mock_model]

        # Capture stdout
        captured = StringIO()
        sys.stdout = captured

        args = MagicMock()
        args.query = "test"
        args.limit = 10

        cmd_search(args)

        sys.stdout = sys.__stdout__
        output = captured.getvalue()

        result = json.loads(output.strip().split('\n')[-1])
        self.assertIn("results", result)
        self.assertEqual(len(result["results"]), 1)
        self.assertEqual(result["results"][0]["model_id"], "mlx-community/Test-Model")
        self.assertEqual(result["results"][0]["downloads"], 1000)

    @patch('huggingface_hub.HfApi')
    def test_search_handles_error(self, mock_api_class):
        from mlx_runner import cmd_search

        mock_api = MagicMock()
        mock_api_class.return_value = mock_api
        mock_api.list_models.side_effect = Exception("Network error")

        captured = StringIO()
        sys.stdout = captured

        args = MagicMock()
        args.query = "test"
        args.limit = 10

        with self.assertRaises(SystemExit) as cm:
            cmd_search(args)

        self.assertEqual(cm.exception.code, 1)

        sys.stdout = sys.__stdout__
        output = captured.getvalue()
        result = json.loads(output.strip())
        self.assertIn("error", result)
        self.assertIn("Network error", result["error"])


class TestCmdList(unittest.TestCase):
    """Test the list command."""

    @patch('huggingface_hub.scan_cache_dir')
    def test_list_shows_mlx_models(self, mock_scan):
        from mlx_runner import cmd_list

        mock_cache = MagicMock()

        # Create mock repo
        mock_repo = MagicMock()
        mock_repo.repo_id = "mlx-community/Llama-Test"
        mock_repo.size_on_disk = 1024 * 1024 * 1024  # 1 GB

        mock_revision = MagicMock()
        mock_revision.last_modified = 1704067200.0
        mock_revision.snapshot_path = "/path/to/model"
        mock_repo.revisions = [mock_revision]

        mock_cache.repos = [mock_repo]
        mock_scan.return_value = mock_cache

        captured = StringIO()
        sys.stdout = captured

        args = MagicMock()
        cmd_list(args)

        sys.stdout = sys.__stdout__
        output = captured.getvalue()
        result = json.loads(output.strip())

        self.assertIn("models", result)
        self.assertEqual(len(result["models"]), 1)
        self.assertEqual(result["models"][0]["model_id"], "mlx-community/Llama-Test")
        self.assertIn("1.0 GB", result["models"][0]["size_human"])

    @patch('huggingface_hub.scan_cache_dir')
    def test_list_filters_non_mlx_models(self, mock_scan):
        from mlx_runner import cmd_list

        mock_cache = MagicMock()

        # Create non-MLX model
        mock_repo = MagicMock()
        mock_repo.repo_id = "openai/whisper-large"  # Not MLX
        mock_repo.size_on_disk = 1024 * 1024 * 1024
        mock_revision = MagicMock()
        mock_revision.last_modified = 1704067200.0
        mock_revision.snapshot_path = "/path/to/model"
        mock_repo.revisions = [mock_revision]

        mock_cache.repos = [mock_repo]
        mock_scan.return_value = mock_cache

        captured = StringIO()
        sys.stdout = captured

        args = MagicMock()
        cmd_list(args)

        sys.stdout = sys.__stdout__
        output = captured.getvalue()
        result = json.loads(output.strip())

        self.assertEqual(len(result["models"]), 0)


class TestCmdDownload(unittest.TestCase):
    """Test the download command."""

    @patch('huggingface_hub.snapshot_download')
    @patch('huggingface_hub.HfApi')
    def test_download_success(self, mock_api_class, mock_download):
        from mlx_runner import cmd_download

        mock_api = MagicMock()
        mock_api_class.return_value = mock_api

        # Mock model info with siblings for size calculation
        mock_model = MagicMock()
        mock_sibling = MagicMock()
        mock_sibling.size = 1024 * 1024  # 1 MB
        mock_model.siblings = [mock_sibling]
        mock_api.model_info.return_value = mock_model

        # Mock the download to return a temp path
        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a dummy file so size calculation works
            dummy_file = Path(tmpdir) / "model.bin"
            dummy_file.write_bytes(b"x" * 1000)

            mock_download.return_value = tmpdir

            captured = StringIO()
            sys.stdout = captured

            args = MagicMock()
            args.model_id = "mlx-community/Test"
            args.quantize = None

            cmd_download(args)

            sys.stdout = sys.__stdout__
            output = captured.getvalue()
            lines = output.strip().split('\n')

            # First line should be status with total size info
            status = json.loads(lines[0])
            self.assertEqual(status["type"], "status")
            self.assertEqual(status["status"], "downloading")
            self.assertEqual(status["model_id"], "mlx-community/Test")
            self.assertEqual(status["file_count"], 1)

            # Last line should be completion
            result = json.loads(lines[-1])
            self.assertEqual(result["type"], "complete")
            self.assertEqual(result["status"], "complete")
            self.assertEqual(result["model_id"], "mlx-community/Test")
            self.assertIn("size_bytes", result)

    @patch('huggingface_hub.HfApi')
    def test_download_model_not_found(self, mock_api_class):
        from huggingface_hub.utils import RepositoryNotFoundError
        from mlx_runner import cmd_download

        mock_api = MagicMock()
        mock_api_class.return_value = mock_api
        # RepositoryNotFoundError requires a response object
        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_api.model_info.side_effect = RepositoryNotFoundError("Not found", response=mock_response)

        captured = StringIO()
        sys.stdout = captured

        args = MagicMock()
        args.model_id = "fake/model"

        with self.assertRaises(SystemExit) as cm:
            cmd_download(args)

        self.assertEqual(cm.exception.code, 1)

        sys.stdout = sys.__stdout__
        output = captured.getvalue()
        result = json.loads(output.strip())
        self.assertIn("error", result)
        self.assertIn("not found", result["error"].lower())


class TestCmdRemove(unittest.TestCase):
    """Test the remove command."""

    @patch('huggingface_hub.scan_cache_dir')
    def test_remove_model_not_in_cache(self, mock_scan):
        from mlx_runner import cmd_remove

        mock_cache = MagicMock()
        mock_cache.repos = []
        mock_scan.return_value = mock_cache

        captured = StringIO()
        sys.stdout = captured

        args = MagicMock()
        args.model_id = "nonexistent/model"

        with self.assertRaises(SystemExit) as cm:
            cmd_remove(args)

        self.assertEqual(cm.exception.code, 1)

        sys.stdout = sys.__stdout__
        output = captured.getvalue()
        result = json.loads(output.strip())
        self.assertIn("error", result)
        self.assertIn("not found", result["error"].lower())


class TestCmdInfer(unittest.TestCase):
    """Test the infer command."""

    @patch('huggingface_hub.scan_cache_dir')
    def test_infer_model_not_downloaded(self, mock_scan):
        from mlx_runner import cmd_infer

        mock_cache = MagicMock()
        mock_cache.repos = []
        mock_scan.return_value = mock_cache

        captured = StringIO()
        sys.stdout = captured

        args = MagicMock()
        args.model_id = "not-downloaded/model"
        args.prompt = "Hello"
        args.max_tokens = 100
        args.temperature = 0.7

        with self.assertRaises(SystemExit) as cm:
            cmd_infer(args)

        self.assertEqual(cm.exception.code, 1)

        sys.stdout = sys.__stdout__
        output = captured.getvalue()
        result = json.loads(output.strip())
        self.assertIn("error", result)
        self.assertIn("not found locally", result["error"].lower())


class TestCmdInfo(unittest.TestCase):
    """Test the info command."""

    @patch('huggingface_hub.scan_cache_dir')
    @patch('huggingface_hub.hf_hub_download')
    @patch('huggingface_hub.HfApi')
    def test_info_returns_model_details(self, mock_api_class, mock_download, mock_scan):
        from mlx_runner import cmd_info
        import tempfile

        mock_api = MagicMock()
        mock_api_class.return_value = mock_api

        # Mock model info
        mock_model = MagicMock()
        mock_model.id = "mlx-community/Test-Model-4bit"
        mock_model.downloads = 5000
        mock_model.likes = 25
        mock_model.tags = ["mlx", "text-generation"]
        mock_model.last_modified = 1704067200.0
        mock_model.pipeline_tag = "text-generation"
        mock_model.library_name = "transformers"
        mock_api.model_info.return_value = mock_model

        # Mock config.json download
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            import json as json_lib
            json_lib.dump({
                "max_position_embeddings": 8192,
                "hidden_size": 2048,
                "num_hidden_layers": 16,
                "num_attention_heads": 32,
                "quantization_config": {"quant_method": "quantized", "bits": 4}
            }, f)
            config_path = f.name

        mock_download.return_value = config_path

        # Mock cache (model not local)
        mock_cache = MagicMock()
        mock_cache.repos = []
        mock_scan.return_value = mock_cache

        captured = StringIO()
        sys.stdout = captured

        args = MagicMock()
        args.model_id = "mlx-community/Test-Model-4bit"

        cmd_info(args)

        sys.stdout = sys.__stdout__
        output = captured.getvalue()
        result = json.loads(output.strip())

        self.assertEqual(result["model_id"], "mlx-community/Test-Model-4bit")
        self.assertEqual(result["downloads"], 5000)
        self.assertEqual(result["context_length"], 8192)
        self.assertEqual(result["hidden_size"], 2048)
        self.assertEqual(result["quantization_bits"], 4)
        self.assertFalse(result["is_local"])

        # Cleanup
        import os
        os.unlink(config_path)

    @patch('huggingface_hub.HfApi')
    def test_info_model_not_found(self, mock_api_class):
        from huggingface_hub.utils import RepositoryNotFoundError
        from mlx_runner import cmd_info

        mock_api = MagicMock()
        mock_api_class.return_value = mock_api
        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_api.model_info.side_effect = RepositoryNotFoundError("Not found", response=mock_response)

        captured = StringIO()
        sys.stdout = captured

        args = MagicMock()
        args.model_id = "fake/model"

        with self.assertRaises(SystemExit) as cm:
            cmd_info(args)

        self.assertEqual(cm.exception.code, 1)

        sys.stdout = sys.__stdout__
        output = captured.getvalue()
        result = json.loads(output.strip())
        self.assertIn("error", result)
        self.assertIn("not found", result["error"].lower())


class TestMLXDaemon(unittest.TestCase):
    """Test the MLX daemon for persistent model loading."""

    def test_daemon_sends_ready_on_start(self):
        from mlx_daemon import MLXDaemon
        from io import StringIO

        captured = StringIO()
        sys.stdout = captured

        daemon = MLXDaemon()
        daemon._send({"type": "ready", "message": "test"})

        sys.stdout = sys.__stdout__
        output = captured.getvalue()
        result = json.loads(output.strip())
        self.assertEqual(result["type"], "ready")

    def test_daemon_ping_returns_pong(self):
        from mlx_daemon import MLXDaemon
        from io import StringIO

        captured = StringIO()
        sys.stdout = captured

        daemon = MLXDaemon()
        daemon.cmd_ping({})

        sys.stdout = sys.__stdout__
        output = captured.getvalue()
        result = json.loads(output.strip())
        self.assertEqual(result["type"], "pong")
        self.assertIn("timestamp", result)

    def test_daemon_status_shows_no_model(self):
        from mlx_daemon import MLXDaemon
        from io import StringIO

        captured = StringIO()
        sys.stdout = captured

        daemon = MLXDaemon()
        daemon.cmd_status({})

        sys.stdout = sys.__stdout__
        output = captured.getvalue()
        result = json.loads(output.strip())
        self.assertEqual(result["type"], "status_report")
        self.assertIsNone(result["loaded_model"])
        self.assertFalse(result["is_ready"])

    def test_daemon_unload_when_nothing_loaded(self):
        from mlx_daemon import MLXDaemon
        from io import StringIO

        captured = StringIO()
        sys.stdout = captured

        daemon = MLXDaemon()
        daemon.cmd_unload({})

        sys.stdout = sys.__stdout__
        output = captured.getvalue()
        result = json.loads(output.strip())
        self.assertEqual(result["type"], "unloaded")
        self.assertIsNone(result["model_id"])

    def test_daemon_infer_requires_model_and_prompt(self):
        from mlx_daemon import MLXDaemon
        from io import StringIO

        captured = StringIO()
        sys.stdout = captured

        daemon = MLXDaemon()
        daemon.cmd_infer({})  # Missing model_id and prompt

        sys.stdout = sys.__stdout__
        output = captured.getvalue()
        result = json.loads(output.strip())
        self.assertEqual(result["type"], "error")
        self.assertIn("model_id and prompt are required", result["error"])

    @patch('huggingface_hub.scan_cache_dir')
    def test_daemon_infer_model_not_found(self, mock_scan):
        from mlx_daemon import MLXDaemon
        from io import StringIO

        mock_cache = MagicMock()
        mock_cache.repos = []
        mock_scan.return_value = mock_cache

        captured = StringIO()
        sys.stdout = captured

        daemon = MLXDaemon()
        daemon.cmd_infer({"model_id": "nonexistent/model", "prompt": "Hello"})

        sys.stdout = sys.__stdout__
        output = captured.getvalue()
        result = json.loads(output.strip())
        self.assertEqual(result["type"], "error")
        self.assertIn("not found locally", result["error"].lower())


if __name__ == "__main__":
    unittest.main()
