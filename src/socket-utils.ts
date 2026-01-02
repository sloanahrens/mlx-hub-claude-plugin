/**
 * Socket path utilities for shared daemon management.
 * Converts model IDs to safe socket filenames for Unix domain sockets.
 */

import { homedir } from 'os';
import { join } from 'path';

const MLX_COMMUNITY_PREFIX = 'mlx-community/';
const DAEMON_DIR_NAME = '.mlx-hub';
const DAEMONS_SUBDIR = 'daemons';

/**
 * Convert a model ID to a safe socket filename.
 *
 * Transformation rules:
 * 1. Strip 'mlx-community/' prefix if present
 * 2. Convert to lowercase
 * 3. Replace non-alphanumeric characters with hyphens
 * 4. Collapse multiple consecutive hyphens
 * 5. Remove leading and trailing hyphens
 *
 * @example
 * modelIdToSocketName('mlx-community/DeepSeek-Coder-V2-Lite-Instruct-4bit')
 * // => 'deepseek-coder-v2-lite-instruct-4bit'
 */
export function modelIdToSocketName(modelId: string): string {
  // Strip mlx-community/ prefix if present
  let name = modelId;
  if (name.startsWith(MLX_COMMUNITY_PREFIX)) {
    name = name.slice(MLX_COMMUNITY_PREFIX.length);
  }

  // Lowercase
  name = name.toLowerCase();

  // Replace non-alphanumeric with hyphens
  name = name.replace(/[^a-z0-9]/g, '-');

  // Collapse multiple hyphens
  name = name.replace(/-+/g, '-');

  // Remove leading/trailing hyphens
  name = name.replace(/^-+|-+$/g, '');

  return name;
}

/**
 * Get the directory where daemon sockets and pid files are stored.
 *
 * @returns Path to ~/.mlx-hub/daemons
 */
export function getDaemonDir(): string {
  return join(homedir(), DAEMON_DIR_NAME, DAEMONS_SUBDIR);
}

/**
 * Get the Unix domain socket path for a model.
 *
 * @param modelId - The model ID (e.g., 'mlx-community/Llama-3.2-1B-Instruct-4bit')
 * @returns Path to the socket file (e.g., ~/.mlx-hub/daemons/llama-3-2-1b-instruct-4bit.sock)
 */
export function getSocketPath(modelId: string): string {
  const socketName = modelIdToSocketName(modelId);
  return join(getDaemonDir(), `${socketName}.sock`);
}

/**
 * Get the PID file path for a model's daemon.
 *
 * @param modelId - The model ID (e.g., 'mlx-community/Llama-3.2-1B-Instruct-4bit')
 * @returns Path to the PID file (e.g., ~/.mlx-hub/daemons/llama-3-2-1b-instruct-4bit.pid)
 */
export function getPidPath(modelId: string): string {
  const socketName = modelIdToSocketName(modelId);
  return join(getDaemonDir(), `${socketName}.pid`);
}
