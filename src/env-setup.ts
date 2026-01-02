/**
 * Environment Setup - manages uv-based Python virtual environment for MLX operations.
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
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
 * Data stored in the marker file to track Python environment state.
 */
export interface MarkerData {
  created: string;           // ISO timestamp
  uv_version: string;        // e.g., "0.5.11"
  requirements_hash: string; // SHA256 hash
}

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

/**
 * Check if uv is installed and available in PATH.
 * Uses execFileSync (not exec) to avoid shell injection vulnerabilities.
 */
export function checkUvInstalled(): boolean {
  try {
    execFileSync('uv', ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Read and parse the marker file.
 * @param path - Path to the marker file (defaults to PYTHON_READY_FILE)
 * @returns MarkerData if file exists and is valid JSON, null otherwise
 */
export function readMarkerFile(path: string = PYTHON_READY_FILE): MarkerData | null {
  try {
    if (!existsSync(path)) {
      return null;
    }
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content) as MarkerData;
  } catch {
    return null;
  }
}

/**
 * Write marker data to file.
 * Creates parent directory if needed.
 * @param path - Path to the marker file
 * @param data - MarkerData to write
 */
export function writeMarkerFile(path: string, data: MarkerData): void {
  const parentDir = dirname(path);
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(data));
}
