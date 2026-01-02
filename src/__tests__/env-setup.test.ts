// src/__tests__/env-setup.test.ts
import { describe, it, expect } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';
import { MLX_HUB_DIR, VENV_DIR, PYTHON_READY_FILE, getVenvPythonPath } from '../env-setup.js';

describe('env-setup constants', () => {
  it('defines correct directory paths', () => {
    expect(MLX_HUB_DIR).toBe(join(homedir(), '.mlx-hub'));
    expect(VENV_DIR).toBe(join(homedir(), '.mlx-hub', 'venv'));
    expect(PYTHON_READY_FILE).toBe(join(homedir(), '.mlx-hub', '.python-ready'));
  });

  it('returns correct venv python path', () => {
    expect(getVenvPythonPath()).toBe(join(homedir(), '.mlx-hub', 'venv', 'bin', 'python3'));
  });
});
