"""
Socket path utilities for shared daemon management.
Converts model IDs to safe socket filenames for Unix domain sockets.
"""

import re
from pathlib import Path

MLX_COMMUNITY_PREFIX = "mlx-community/"
DAEMON_DIR_NAME = ".mlx-hub"
DAEMONS_SUBDIR = "daemons"


def model_id_to_socket_name(model_id: str) -> str:
    """
    Convert a model ID to a safe socket filename.

    Transformation rules:
    1. Strip 'mlx-community/' prefix if present
    2. Convert to lowercase
    3. Replace non-alphanumeric characters with hyphens
    4. Collapse multiple consecutive hyphens
    5. Remove leading and trailing hyphens

    Example:
        >>> model_id_to_socket_name('mlx-community/DeepSeek-Coder-V2-Lite-Instruct-4bit')
        'deepseek-coder-v2-lite-instruct-4bit'
    """
    name = model_id

    # Strip mlx-community/ prefix if present
    if name.startswith(MLX_COMMUNITY_PREFIX):
        name = name[len(MLX_COMMUNITY_PREFIX):]

    # Lowercase
    name = name.lower()

    # Replace non-alphanumeric with hyphens
    name = re.sub(r"[^a-z0-9]", "-", name)

    # Collapse multiple hyphens
    name = re.sub(r"-+", "-", name)

    # Remove leading/trailing hyphens
    name = name.strip("-")

    return name


def get_daemon_dir() -> Path:
    """
    Get the directory where daemon sockets and pid files are stored.

    Returns:
        Path to ~/.mlx-hub/daemons
    """
    return Path.home() / DAEMON_DIR_NAME / DAEMONS_SUBDIR


def get_socket_path(model_id: str) -> Path:
    """
    Get the Unix domain socket path for a model.

    Args:
        model_id: The model ID (e.g., 'mlx-community/Llama-3.2-1B-Instruct-4bit')

    Returns:
        Path to the socket file (e.g., ~/.mlx-hub/daemons/llama-3-2-1b-instruct-4bit.sock)
    """
    socket_name = model_id_to_socket_name(model_id)
    return get_daemon_dir() / f"{socket_name}.sock"


def get_pid_path(model_id: str) -> Path:
    """
    Get the PID file path for a model's daemon.

    Args:
        model_id: The model ID (e.g., 'mlx-community/Llama-3.2-1B-Instruct-4bit')

    Returns:
        Path to the PID file (e.g., ~/.mlx-hub/daemons/llama-3-2-1b-instruct-4bit.pid)
    """
    socket_name = model_id_to_socket_name(model_id)
    return get_daemon_dir() / f"{socket_name}.pid"


if __name__ == "__main__":
    # Quick test
    test_cases = [
        "mlx-community/DeepSeek-Coder-V2-Lite-Instruct-4bit",
        "mlx-community/Llama-3.2-1B-Instruct-4bit",
        "some-org/Some-Model-4bit",
    ]

    for model_id in test_cases:
        print(f"Model ID: {model_id}")
        print(f"  Socket name: {model_id_to_socket_name(model_id)}")
        print(f"  Socket path: {get_socket_path(model_id)}")
        print(f"  PID path: {get_pid_path(model_id)}")
        print()
