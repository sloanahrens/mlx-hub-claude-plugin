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

// Module-level cache for Python path
let cachedPythonPath: string | null = null;

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

/**
 * Ensure Python virtual environment is set up and ready for MLX operations.
 * Uses a marker file to cache setup state and avoid re-running on every call.
 *
 * @param markerPath - Optional custom marker path (for testing)
 * @returns Path to the Python binary in the venv
 * @throws Error if uv is not installed
 */
export async function ensurePythonEnv(markerPath: string = PYTHON_READY_FILE): Promise<string> {
  // 1. Check marker file - if valid, hash matches, AND venv exists, return fast
  const marker = readMarkerFile(markerPath);
  const currentHash = getRequirementsHash();
  const pythonPath = getVenvPythonPath();
  if (marker && marker.requirements_hash === currentHash && existsSync(pythonPath)) {
    return pythonPath;
  }

  // 2. Check uv is installed
  if (!checkUvInstalled()) {
    throw new Error(
      "MLX Hub requires 'uv' for Python environment management.\n\n" +
      'Install with:\n' +
      '  curl -LsSf https://astral.sh/uv/install.sh | sh\n' +
      '  brew install uv\n\n' +
      'Then restart Claude Code.'
    );
  }

  // 3. Create venv
  execFileSync('uv', ['venv', VENV_DIR], { stdio: 'pipe' });

  // 4. Install dependencies
  execFileSync('uv', ['pip', 'install', '-r', REQUIREMENTS_PATH, '--python', getVenvPythonPath()], { stdio: 'pipe' });

  // 5. Get uv version
  const versionOutput = execFileSync('uv', ['--version'], { encoding: 'utf-8' });
  const uvVersion = versionOutput.trim().replace('uv ', '');

  // 6. Write marker file
  writeMarkerFile(markerPath, {
    created: new Date().toISOString(),
    uv_version: uvVersion,
    requirements_hash: currentHash,
  });

  return getVenvPythonPath();
}

/**
 * Get path to the Python binary, using cache to avoid repeated ensurePythonEnv calls.
 * This is the primary function other modules should use to get the Python path.
 *
 * @returns Path to the Python binary in the venv
 */
export async function getPythonPath(): Promise<string> {
  if (cachedPythonPath) {
    return cachedPythonPath;
  }
  cachedPythonPath = await ensurePythonEnv();
  return cachedPythonPath;
}

/**
 * Reset the Python path cache. Exported for test isolation.
 */
export function resetPythonPathCache(): void {
  cachedPythonPath = null;
}
