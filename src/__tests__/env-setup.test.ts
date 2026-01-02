// src/__tests__/env-setup.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { MLX_HUB_DIR, VENV_DIR, PYTHON_READY_FILE, getVenvPythonPath, getRequirementsHash, checkUvInstalled, MarkerData, readMarkerFile, writeMarkerFile, ensurePythonEnv, getPythonPath, resetPythonPathCache } from '../env-setup.js';

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
    // Clean up venv directory created by tests (getVenvPythonPath points to real location)
    rmSync(VENV_DIR, { recursive: true, force: true });
  });

  it('returns cached path when marker is valid, hash matches, AND venv exists', async () => {
    // Setup: create a marker file with matching requirements hash
    const currentHash = getRequirementsHash();
    const markerData: MarkerData = {
      created: '2025-01-02T10:00:00.000Z',
      uv_version: '0.5.11',
      requirements_hash: currentHash,
    };
    const testMarkerPath = join(tempDir, '.python-ready');
    writeFileSync(testMarkerPath, JSON.stringify(markerData));

    // Setup: create the venv python binary that ensurePythonEnv checks for
    const pythonPath = getVenvPythonPath();
    mkdirSync(dirname(pythonPath), { recursive: true });
    writeFileSync(pythonPath, '#!/usr/bin/env python3\n');

    // Call with custom marker path for testing
    const result = await ensurePythonEnv(testMarkerPath);

    // Should return venv python path without calling uv commands
    expect(result).toBe(pythonPath);
    // execFileSync should NOT be called (fast path)
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('recreates venv when marker exists but venv is missing', async () => {
    // Setup: create a marker file with matching requirements hash BUT no venv
    const currentHash = getRequirementsHash();
    const markerData: MarkerData = {
      created: '2025-01-02T10:00:00.000Z',
      uv_version: '0.5.11',
      requirements_hash: currentHash,
    };
    const testMarkerPath = join(tempDir, '.python-ready');
    writeFileSync(testMarkerPath, JSON.stringify(markerData));

    // Setup: mock uv commands to succeed (since venv doesn't exist, it should try to create it)
    vi.mocked(execFileSync).mockImplementation((cmd, args, options) => {
      if (cmd === 'uv' && args?.[0] === '--version') {
        const result = 'uv 0.5.11\n';
        if (options && typeof options === 'object' && 'encoding' in options) {
          return result;
        }
        return Buffer.from(result);
      }
      return Buffer.from('');
    });

    // Call with custom marker path for testing
    const result = await ensurePythonEnv(testMarkerPath);

    // Should return venv python path
    expect(result).toBe(getVenvPythonPath());
    // Should have called uv venv (because venv was missing)
    expect(execFileSync).toHaveBeenCalledWith(
      'uv',
      ['venv', expect.any(String)],
      expect.anything()
    );
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

describe('getPythonPath', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPythonPathCache();
  });

  afterEach(() => {
    resetPythonPathCache();
  });

  it('returns cached path on second call', async () => {
    // First call - will call ensurePythonEnv which may hit real marker file (fast path)
    const path1 = await getPythonPath();

    // Second call - should use cache
    const path2 = await getPythonPath();

    // Both should return the same path
    expect(path1).toBe(path2);
    // Should be the venv python path
    expect(path1).toBe(getVenvPythonPath());
  });

  it('calls ensurePythonEnv only once with cache', async () => {
    // Setup: mock uv to track calls (this triggers the slow path in ensurePythonEnv
    // when marker file doesn't match or doesn't exist)
    let uvCalls = 0;
    vi.mocked(execFileSync).mockImplementation((cmd, args, options) => {
      if (cmd === 'uv') {
        uvCalls++;
        if (args?.[0] === '--version') {
          const result = 'uv 0.5.11\n';
          if (options && typeof options === 'object' && 'encoding' in options) {
            return result;
          }
          return Buffer.from(result);
        }
      }
      return Buffer.from('');
    });

    // Call getPythonPath - will call ensurePythonEnv internally
    await getPythonPath();
    const uvCallsAfterFirst = uvCalls;

    // Call again - should use cache, NOT call ensurePythonEnv
    await getPythonPath();
    await getPythonPath();

    // The number of uv calls should NOT have increased after first getPythonPath
    // (because subsequent calls use the cache and don't go through ensurePythonEnv)
    expect(uvCalls).toBe(uvCallsAfterFirst);
  });
});

describe('resetPythonPathCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPythonPathCache();
  });

  afterEach(() => {
    resetPythonPathCache();
  });

  it('clears the cache allowing ensurePythonEnv to be called again', async () => {
    // First call
    const path1 = await getPythonPath();

    // Second call - uses cache
    const path2 = await getPythonPath();
    expect(path1).toBe(path2);

    // Reset the cache
    resetPythonPathCache();

    // Third call - should still work (cache was cleared, so it calls ensurePythonEnv again)
    const path3 = await getPythonPath();

    // All paths should be the same (the venv python path)
    expect(path3).toBe(path1);
    expect(path3).toBe(getVenvPythonPath());
  });
});
