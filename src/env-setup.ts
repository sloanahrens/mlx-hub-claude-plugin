/**
 * Environment Setup - manages uv-based Python virtual environment for MLX operations.
 */

import { homedir } from 'os';
import { join } from 'path';

export const MLX_HUB_DIR = join(homedir(), '.mlx-hub');
export const VENV_DIR = join(MLX_HUB_DIR, 'venv');
export const PYTHON_READY_FILE = join(MLX_HUB_DIR, '.python-ready');

/**
 * Get the path to the Python binary in the managed venv.
 */
export function getVenvPythonPath(): string {
  return join(VENV_DIR, 'bin', 'python3');
}
