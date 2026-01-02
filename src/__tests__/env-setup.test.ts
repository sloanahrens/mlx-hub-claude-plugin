// src/__tests__/env-setup.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { MLX_HUB_DIR, VENV_DIR, PYTHON_READY_FILE, getVenvPythonPath, getRequirementsHash, checkUvInstalled, MarkerData, readMarkerFile, writeMarkerFile, ensurePythonEnv } from '../env-setup.js';

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

describe('readMarkerFile', () => {
  let tempDir: string;
  let testMarkerPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'mlx-hub-test-'));
    testMarkerPath = join(tempDir, '.python-ready');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns null for missing file', () => {
    const result = readMarkerFile(testMarkerPath);
    expect(result).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    writeFileSync(testMarkerPath, 'not valid json {{{');
    const result = readMarkerFile(testMarkerPath);
    expect(result).toBeNull();
  });

  it('returns data for valid file', () => {
    const markerData: MarkerData = {
      created: '2025-01-02T10:00:00.000Z',
      uv_version: '0.5.11',
      requirements_hash: 'abc123def456',
    };
    writeFileSync(testMarkerPath, JSON.stringify(markerData));

    const result = readMarkerFile(testMarkerPath);
    expect(result).toEqual(markerData);
  });
});

describe('writeMarkerFile', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'mlx-hub-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates file with correct content', () => {
    const testMarkerPath = join(tempDir, '.python-ready');
    const markerData: MarkerData = {
      created: '2025-01-02T10:00:00.000Z',
      uv_version: '0.5.11',
      requirements_hash: 'abc123def456',
    };

    writeMarkerFile(testMarkerPath, markerData);

    expect(existsSync(testMarkerPath)).toBe(true);
    const content = readFileSync(testMarkerPath, 'utf-8');
    expect(JSON.parse(content)).toEqual(markerData);
  });

  it('creates parent directory if needed', () => {
    const nestedPath = join(tempDir, 'nested', 'deep', '.python-ready');
    const markerData: MarkerData = {
      created: '2025-01-02T10:00:00.000Z',
      uv_version: '0.5.11',
      requirements_hash: 'abc123def456',
    };

    writeMarkerFile(nestedPath, markerData);

    expect(existsSync(nestedPath)).toBe(true);
    const content = readFileSync(nestedPath, 'utf-8');
    expect(JSON.parse(content)).toEqual(markerData);
  });
});

describe('ensurePythonEnv', () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), 'mlx-hub-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns cached path when marker is valid and hash matches', async () => {
    // Setup: create a marker file with matching requirements hash
    const currentHash = getRequirementsHash();
    const markerData: MarkerData = {
      created: '2025-01-02T10:00:00.000Z',
      uv_version: '0.5.11',
      requirements_hash: currentHash,
    };
    const testMarkerPath = join(tempDir, '.python-ready');
    writeFileSync(testMarkerPath, JSON.stringify(markerData));

    // Call with custom marker path for testing
    const result = await ensurePythonEnv(testMarkerPath);

    // Should return venv python path without calling uv commands
    expect(result).toBe(getVenvPythonPath());
    // execFileSync should NOT be called (fast path)
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('throws when uv is not installed', async () => {
    // Setup: mock uv not found
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('command not found');
    });

    const testMarkerPath = join(tempDir, '.python-ready');

    // Should throw with installation instructions
    await expect(ensurePythonEnv(testMarkerPath)).rejects.toThrow(
      /uv.*for Python environment management/
    );
    await expect(ensurePythonEnv(testMarkerPath)).rejects.toThrow(
      /curl -LsSf https:\/\/astral\.sh\/uv\/install\.sh/
    );
  });

  it('creates venv and installs deps when marker is missing', async () => {
    // Setup: mock uv commands to succeed
    vi.mocked(execFileSync).mockImplementation((cmd, args, options) => {
      if (cmd === 'uv' && args?.[0] === '--version') {
        // Return string when encoding is specified, Buffer otherwise
        const result = 'uv 0.5.11\n';
        if (options && typeof options === 'object' && 'encoding' in options) {
          return result;
        }
        return Buffer.from(result);
      }
      if (cmd === 'uv' && args?.[0] === 'venv') {
        return Buffer.from('');
      }
      if (cmd === 'uv' && args?.[0] === 'pip') {
        return Buffer.from('');
      }
      return Buffer.from('');
    });

    const testMarkerPath = join(tempDir, '.python-ready');

    const result = await ensurePythonEnv(testMarkerPath);

    // Should return venv python path
    expect(result).toBe(getVenvPythonPath());

    // Should have called uv venv
    expect(execFileSync).toHaveBeenCalledWith(
      'uv',
      ['venv', VENV_DIR],
      expect.any(Object)
    );

    // Should have called uv pip install
    expect(execFileSync).toHaveBeenCalledWith(
      'uv',
      expect.arrayContaining(['pip', 'install', '-r']),
      expect.any(Object)
    );

    // Should have written marker file
    expect(existsSync(testMarkerPath)).toBe(true);
    const savedMarker = JSON.parse(readFileSync(testMarkerPath, 'utf-8')) as MarkerData;
    expect(savedMarker.uv_version).toBe('0.5.11');
    expect(savedMarker.requirements_hash).toBe(getRequirementsHash());
  });

  it('recreates venv when requirements hash changes', async () => {
    // Setup: create a marker file with OLD/different hash
    const markerData: MarkerData = {
      created: '2025-01-01T10:00:00.000Z',
      uv_version: '0.5.10',
      requirements_hash: 'old-hash-that-does-not-match',
    };
    const testMarkerPath = join(tempDir, '.python-ready');
    writeFileSync(testMarkerPath, JSON.stringify(markerData));

    // Mock uv commands to succeed
    vi.mocked(execFileSync).mockImplementation((cmd, args, options) => {
      if (cmd === 'uv' && args?.[0] === '--version') {
        // Return string when encoding is specified, Buffer otherwise
        const result = 'uv 0.5.11\n';
        if (options && typeof options === 'object' && 'encoding' in options) {
          return result;
        }
        return Buffer.from(result);
      }
      return Buffer.from('');
    });

    const result = await ensurePythonEnv(testMarkerPath);

    // Should have recreated venv because hash changed
    expect(execFileSync).toHaveBeenCalledWith(
      'uv',
      ['venv', VENV_DIR],
      expect.any(Object)
    );

    // Should have updated marker file with new hash
    const savedMarker = JSON.parse(readFileSync(testMarkerPath, 'utf-8')) as MarkerData;
    expect(savedMarker.requirements_hash).toBe(getRequirementsHash());
    expect(savedMarker.requirements_hash).not.toBe('old-hash-that-does-not-match');

    expect(result).toBe(getVenvPythonPath());
  });
});
