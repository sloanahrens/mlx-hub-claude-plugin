"""Unit tests for socket_utils.py"""

import unittest
from pathlib import Path

from socket_utils import (
    model_id_to_socket_name,
    get_socket_path,
    get_pid_path,
    get_daemon_dir,
)


class TestModelIdToSocketName(unittest.TestCase):
    """Tests for model_id_to_socket_name function."""

    def test_converts_mlx_community_model_id_to_socket_name(self):
        """Convert mlx-community model ID to socket name."""
        result = model_id_to_socket_name("mlx-community/DeepSeek-Coder-V2-Lite-Instruct-4bit")
        self.assertEqual(result, "deepseek-coder-v2-lite-instruct-4bit")

    def test_strips_mlx_community_prefix(self):
        """Strip mlx-community/ prefix."""
        result = model_id_to_socket_name("mlx-community/Llama-3.2-1B-Instruct-4bit")
        self.assertEqual(result, "llama-3-2-1b-instruct-4bit")

    def test_lowercases_the_entire_name(self):
        """Lowercase the entire name."""
        result = model_id_to_socket_name("mlx-community/UPPERCASE-Model")
        self.assertEqual(result, "uppercase-model")

    def test_replaces_non_alphanumeric_characters_with_hyphens(self):
        """Replace non-alphanumeric characters with hyphens."""
        result = model_id_to_socket_name("mlx-community/Model_with.special@chars")
        self.assertEqual(result, "model-with-special-chars")

    def test_handles_model_ids_without_mlx_community_prefix(self):
        """Handle model IDs without mlx-community prefix."""
        result = model_id_to_socket_name("some-org/Some-Model-4bit")
        self.assertEqual(result, "some-org-some-model-4bit")

    def test_collapses_multiple_consecutive_hyphens(self):
        """Collapse multiple consecutive hyphens."""
        result = model_id_to_socket_name("mlx-community/Model__with---multiple___chars")
        self.assertEqual(result, "model-with-multiple-chars")

    def test_removes_leading_and_trailing_hyphens(self):
        """Remove leading and trailing hyphens."""
        result = model_id_to_socket_name("mlx-community/-Model-Name-")
        self.assertEqual(result, "model-name")

    def test_handles_empty_string_after_prefix_strip(self):
        """Handle empty string after prefix strip."""
        result = model_id_to_socket_name("mlx-community/")
        self.assertEqual(result, "")

    def test_handles_completely_empty_string(self):
        """Handle completely empty string."""
        result = model_id_to_socket_name("")
        self.assertEqual(result, "")

    def test_handles_numeric_model_ids(self):
        """Handle numeric model IDs."""
        result = model_id_to_socket_name("mlx-community/123-Model-456")
        self.assertEqual(result, "123-model-456")

    def test_handles_model_id_that_is_all_special_characters(self):
        """Handle model ID that is all special characters."""
        result = model_id_to_socket_name("mlx-community/___")
        self.assertEqual(result, "")


class TestGetDaemonDir(unittest.TestCase):
    """Tests for get_daemon_dir function."""

    def test_returns_mlx_hub_daemons_path(self):
        """Return ~/.mlx-hub/daemons path."""
        result = get_daemon_dir()
        expected = Path.home() / ".mlx-hub" / "daemons"
        self.assertEqual(result, expected)


class TestGetSocketPath(unittest.TestCase):
    """Tests for get_socket_path function."""

    def test_returns_full_socket_path_for_model_id(self):
        """Return full socket path for model ID."""
        result = get_socket_path("mlx-community/Llama-3.2-1B-Instruct-4bit")
        expected = Path.home() / ".mlx-hub" / "daemons" / "llama-3-2-1b-instruct-4bit.sock"
        self.assertEqual(result, expected)

    def test_handles_complex_model_names(self):
        """Handle complex model names."""
        result = get_socket_path("mlx-community/DeepSeek-Coder-V2-Lite-Instruct-4bit")
        expected = Path.home() / ".mlx-hub" / "daemons" / "deepseek-coder-v2-lite-instruct-4bit.sock"
        self.assertEqual(result, expected)


class TestGetPidPath(unittest.TestCase):
    """Tests for get_pid_path function."""

    def test_returns_full_pid_path_for_model_id(self):
        """Return full pid path for model ID."""
        result = get_pid_path("mlx-community/Llama-3.2-1B-Instruct-4bit")
        expected = Path.home() / ".mlx-hub" / "daemons" / "llama-3-2-1b-instruct-4bit.pid"
        self.assertEqual(result, expected)

    def test_handles_complex_model_names(self):
        """Handle complex model names."""
        result = get_pid_path("mlx-community/DeepSeek-Coder-V2-Lite-Instruct-4bit")
        expected = Path.home() / ".mlx-hub" / "daemons" / "deepseek-coder-v2-lite-instruct-4bit.pid"
        self.assertEqual(result, expected)


if __name__ == "__main__":
    unittest.main()
