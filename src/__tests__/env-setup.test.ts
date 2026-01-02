// src/__tests__/env-setup.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';
import { MLX_HUB_DIR, VENV_DIR, PYTHON_READY_FILE, getVenvPythonPath, getRequirementsHash, checkUvInstalled } from '../env-setup.js';

// Mock child_process
vi.mock('child_process', async () => {
  const actual = await vi.importActual('child_process');
  return {
    ...actual,
    execFileSync: vi.fn(),
  };
});

import { execFileSync } from 'child_process';

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

describe('getRequirementsHash', () => {
  it('returns a sha256 hash string', () => {
    const hash = getRequirementsHash();
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns consistent hash for same content', () => {
    const hash1 = getRequirementsHash();
    const hash2 = getRequirementsHash();
    expect(hash1).toBe(hash2);
  });
});

describe('checkUvInstalled', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when uv is found', () => {
    vi.mocked(execFileSync).mockReturnValue(Buffer.from('uv 0.5.11\n'));
    expect(checkUvInstalled()).toBe(true);
  });

  it('returns false when uv is not found', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('command not found');
    });
    expect(checkUvInstalled()).toBe(false);
  });
});
