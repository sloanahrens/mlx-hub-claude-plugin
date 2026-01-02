/**
 * Environment Setup - manages uv-based Python virtual environment for MLX operations.
 */

import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REQUIREMENTS_PATH = join(__dirname, '..', 'python', 'requirements.txt');

export const MLX_HUB_DIR = join(homedir(), '.mlx-hub');
export const VENV_DIR = join(MLX_HUB_DIR, 'venv');
export const PYTHON_READY_FILE = join(MLX_HUB_DIR, '.python-ready');

/**
 * Get the path to the Python binary in the managed venv.
 */
export function getVenvPythonPath(): string {
  return join(VENV_DIR, 'bin', 'python3');
}

/**
 * Get SHA256 hash of requirements.txt for cache invalidation.
 */
export function getRequirementsHash(): string {
  const content = readFileSync(REQUIREMENTS_PATH, 'utf-8');
  return createHash('sha256').update(content).digest('hex');
}
