# uv-Based Python Environment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace hardcoded Python path with uv-managed virtual environment that auto-creates on first run.

**Architecture:** New `env-setup.ts` module handles environment detection and creation. Both `python-runner.ts` and `daemon-client.ts` call `getPythonPath()` which returns the cached venv Python path, creating the environment if needed.

**Tech Stack:** TypeScript, Node.js child_process (execFileSync/spawn - NOT exec), uv (Python package manager)

---

## Task 1: Create env-setup.ts with constants and path helpers

**Files:**
- Create: `src/env-setup.ts`
- Test: `src/__tests__/env-setup.test.ts`

**Step 1: Write the failing test for path constants**

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/env-setup.test.ts`
Expected: FAIL with "Cannot find module '../env-setup.js'"

**Step 3: Write minimal implementation**

```typescript
// src/env-setup.ts
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
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/env-setup.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/env-setup.ts src/__tests__/env-setup.test.ts
git commit -m "feat(env): add env-setup module with path constants"
```

---

## Task 2: Add requirements hash function

**Files:**
- Modify: `src/env-setup.ts`
- Test: `src/__tests__/env-setup.test.ts`

**Step 1: Write the failing test**

```typescript
// Add to src/__tests__/env-setup.test.ts
import { getRequirementsHash } from '../env-setup.js';

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
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/env-setup.test.ts`
Expected: FAIL with "getRequirementsHash is not a function"

**Step 3: Write minimal implementation**

```typescript
// Add to src/env-setup.ts
import { readFileSync } from 'fs';
import { createHash } from 'crypto';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REQUIREMENTS_PATH = join(__dirname, '..', 'python', 'requirements.txt');

/**
 * Get SHA256 hash of requirements.txt for cache invalidation.
 */
export function getRequirementsHash(): string {
  const content = readFileSync(REQUIREMENTS_PATH, 'utf-8');
  return createHash('sha256').update(content).digest('hex');
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/env-setup.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/env-setup.ts src/__tests__/env-setup.test.ts
git commit -m "feat(env): add requirements hash function for cache invalidation"
```

---

## Task 3: Add uv detection function

**Files:**
- Modify: `src/env-setup.ts`
- Test: `src/__tests__/env-setup.test.ts`

**Step 1: Write the failing test**

```typescript
// Add to src/__tests__/env-setup.test.ts
import { vi, beforeEach } from 'vitest';
import { checkUvInstalled } from '../env-setup.js';

// Mock child_process
vi.mock('child_process', async () => {
  const actual = await vi.importActual('child_process');
  return {
    ...actual,
    execFileSync: vi.fn(),
  };
});

import { execFileSync } from 'child_process';

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
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/env-setup.test.ts`
Expected: FAIL with "checkUvInstalled is not a function"

**Step 3: Write minimal implementation**

```typescript
// Add to src/env-setup.ts
import { execFileSync } from 'child_process';

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
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/env-setup.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/env-setup.ts src/__tests__/env-setup.test.ts
git commit -m "feat(env): add uv installation detection"
```

---

## Task 4: Add marker file read/write functions

**Files:**
- Modify: `src/env-setup.ts`
- Test: `src/__tests__/env-setup.test.ts`

**Step 1: Write the failing test**

```typescript
// Add to src/__tests__/env-setup.test.ts
import { writeFileSync, rmSync, mkdirSync, existsSync } from 'fs';
import { readMarkerFile, writeMarkerFile, MarkerData, PYTHON_READY_FILE, MLX_HUB_DIR } from '../env-setup.js';

describe('marker file operations', () => {
  beforeEach(() => {
    // Clean up any existing marker
    if (existsSync(PYTHON_READY_FILE)) {
      rmSync(PYTHON_READY_FILE);
    }
  });

  it('readMarkerFile returns null when file does not exist', () => {
    expect(readMarkerFile()).toBeNull();
  });

  it('writeMarkerFile creates marker with correct structure', () => {
    mkdirSync(MLX_HUB_DIR, { recursive: true });
    writeMarkerFile('abc123');
    const marker = readMarkerFile();
    expect(marker).not.toBeNull();
    expect(marker!.requirements_hash).toBe('abc123');
    expect(marker!.created).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('readMarkerFile returns parsed data when file exists', () => {
    mkdirSync(MLX_HUB_DIR, { recursive: true });
    const data: MarkerData = { created: '2025-01-02T00:00:00Z', requirements_hash: 'test123' };
    writeFileSync(PYTHON_READY_FILE, JSON.stringify(data));
    expect(readMarkerFile()).toEqual(data);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/env-setup.test.ts`
Expected: FAIL with "readMarkerFile is not a function"

**Step 3: Write minimal implementation**

```typescript
// Add to src/env-setup.ts
import { existsSync, writeFileSync, mkdirSync } from 'fs';

export interface MarkerData {
  created: string;
  requirements_hash: string;
}

/**
 * Read the .python-ready marker file.
 * @returns Parsed marker data or null if file doesn't exist or is invalid
 */
export function readMarkerFile(): MarkerData | null {
  if (!existsSync(PYTHON_READY_FILE)) {
    return null;
  }
  try {
    const content = readFileSync(PYTHON_READY_FILE, 'utf-8');
    return JSON.parse(content) as MarkerData;
  } catch {
    return null;
  }
}

/**
 * Write the .python-ready marker file.
 * @param requirementsHash - Hash of requirements.txt
 */
export function writeMarkerFile(requirementsHash: string): void {
  mkdirSync(MLX_HUB_DIR, { recursive: true });
  const data: MarkerData = {
    created: new Date().toISOString(),
    requirements_hash: requirementsHash,
  };
  writeFileSync(PYTHON_READY_FILE, JSON.stringify(data, null, 2));
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/env-setup.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/env-setup.ts src/__tests__/env-setup.test.ts
git commit -m "feat(env): add marker file read/write operations"
```

---

## Task 5: Add ensurePythonEnv function

**Files:**
- Modify: `src/env-setup.ts`
- Test: `src/__tests__/env-setup.test.ts`

**Step 1: Write the failing test**

```typescript
// Add to src/__tests__/env-setup.test.ts
import { ensurePythonEnv } from '../env-setup.js';

describe('ensurePythonEnv', () => {
  it('throws error when uv is not installed', async () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('not found');
    });

    await expect(ensurePythonEnv()).rejects.toThrow(/requires 'uv'/);
  });

  it('returns venv python path when marker is valid', async () => {
    // Mock uv exists
    vi.mocked(execFileSync).mockReturnValue(Buffer.from('uv 0.5.11\n'));

    // Create valid marker with current requirements hash
    mkdirSync(MLX_HUB_DIR, { recursive: true });
    const hash = getRequirementsHash();
    writeMarkerFile(hash);

    const pythonPath = await ensurePythonEnv();
    expect(pythonPath).toContain('.mlx-hub/venv/bin/python3');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/env-setup.test.ts`
Expected: FAIL with "ensurePythonEnv is not a function"

**Step 3: Write minimal implementation**

```typescript
// Add to src/env-setup.ts
import { spawn } from 'child_process';

/**
 * Ensure the Python environment is ready, creating it if needed.
 * @returns Path to the Python binary
 * @throws Error if uv is not installed
 */
export async function ensurePythonEnv(): Promise<string> {
  // Check uv is installed
  if (!checkUvInstalled()) {
    throw new Error(
      `MLX Hub requires 'uv' for Python environment management.\n\n` +
      `Install with:\n` +
      `  curl -LsSf https://astral.sh/uv/install.sh | sh\n` +
      `  brew install uv\n\n` +
      `Then restart Claude Code.`
    );
  }

  const currentHash = getRequirementsHash();
  const marker = readMarkerFile();

  // Check if environment is ready and up-to-date
  if (marker && marker.requirements_hash === currentHash && existsSync(getVenvPythonPath())) {
    return getVenvPythonPath();
  }

  // Need to create or update environment
  await createPythonEnv(currentHash);
  return getVenvPythonPath();
}

/**
 * Create or update the Python virtual environment.
 * Uses spawn (not exec) to avoid shell injection vulnerabilities.
 */
async function createPythonEnv(requirementsHash: string): Promise<void> {
  // Create venv
  await runCommand('uv', ['venv', VENV_DIR]);

  // Install requirements
  const requirementsPath = join(__dirname, '..', 'python', 'requirements.txt');
  await runCommand('uv', ['pip', 'install', '-r', requirementsPath, '--python', getVenvPythonPath()]);

  // Write marker
  writeMarkerFile(requirementsHash);
}

/**
 * Run a command and wait for completion.
 * Uses spawn (not exec) to avoid shell injection vulnerabilities.
 */
function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/env-setup.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/env-setup.ts src/__tests__/env-setup.test.ts
git commit -m "feat(env): add ensurePythonEnv function with auto-setup"
```

---

## Task 6: Add getPythonPath with caching

**Files:**
- Modify: `src/env-setup.ts`
- Test: `src/__tests__/env-setup.test.ts`

**Step 1: Write the failing test**

```typescript
// Add to src/__tests__/env-setup.test.ts
import { getPythonPath, resetPythonPathCache } from '../env-setup.js';

describe('getPythonPath', () => {
  beforeEach(() => {
    resetPythonPathCache();
  });

  it('caches the python path after first call', async () => {
    vi.mocked(execFileSync).mockReturnValue(Buffer.from('uv 0.5.11\n'));
    mkdirSync(MLX_HUB_DIR, { recursive: true });
    writeMarkerFile(getRequirementsHash());

    const path1 = await getPythonPath();
    const path2 = await getPythonPath();

    expect(path1).toBe(path2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/env-setup.test.ts`
Expected: FAIL with "getPythonPath is not a function"

**Step 3: Write minimal implementation**

```typescript
// Add to src/env-setup.ts
let cachedPythonPath: string | null = null;

/**
 * Get the Python path, ensuring environment is ready.
 * Caches the result for subsequent calls.
 */
export async function getPythonPath(): Promise<string> {
  if (cachedPythonPath) {
    return cachedPythonPath;
  }
  cachedPythonPath = await ensurePythonEnv();
  return cachedPythonPath;
}

/**
 * Reset the cached Python path (for testing).
 */
export function resetPythonPathCache(): void {
  cachedPythonPath = null;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/env-setup.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/env-setup.ts src/__tests__/env-setup.test.ts
git commit -m "feat(env): add getPythonPath with caching"
```

---

## Task 7: Update python-runner.ts to use getPythonPath

**Files:**
- Modify: `src/python-runner.ts`
- Modify: `src/__tests__/python-runner.test.ts`

**Step 1: Update imports and remove hardcoded path**

```typescript
// src/python-runner.ts - replace lines 1-30 with:
/**
 * Python Runner - executes mlx_runner.py commands and parses results.
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getPythonPath } from './env-setup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT = join(__dirname, '..', 'python', 'mlx_runner.py');

export interface PythonResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface StreamToken {
  type: 'token' | 'status' | 'done';
  content?: string;
  message?: string;
  tokens_generated?: number;
  tokens_per_sec?: number;
}
```

**Step 2: Update runPythonCommand to be async**

```typescript
// src/python-runner.ts - update runPythonCommand:
export async function runPythonCommand(
  command: string,
  args: string[]
): Promise<PythonResult> {
  const pythonPath = await getPythonPath();

  return new Promise((resolve) => {
    const proc = spawn(pythonPath, [PYTHON_SCRIPT, command, ...args]);
    // ... rest of function unchanged
  });
}
```

**Step 3: Update runInferenceStreaming similarly**

```typescript
// src/python-runner.ts - update runInferenceStreaming:
export async function runInferenceStreaming(
  modelId: string,
  prompt: string,
  maxTokens: number,
  temperature: number,
  onToken: (token: StreamToken) => void,
  systemPrompt?: string
): Promise<PythonResult> {
  const pythonPath = await getPythonPath();

  return new Promise((resolve) => {
    const args = [
      PYTHON_SCRIPT,
      'infer',
      modelId,
      '--prompt', prompt,
      '--max-tokens', maxTokens.toString(),
      '--temperature', temperature.toString(),
    ];

    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    const proc = spawn(pythonPath, args);
    // ... rest of function unchanged
  });
}
```

**Step 4: Run tests**

Run: `npm test`
Expected: PASS (existing tests should still pass with mocking)

**Step 5: Commit**

```bash
git add src/python-runner.ts src/__tests__/python-runner.test.ts
git commit -m "refactor(python-runner): use getPythonPath instead of hardcoded path"
```

---

## Task 8: Update daemon-client.ts to use getPythonPath

**Files:**
- Modify: `src/daemon-client.ts`

**Step 1: Add import**

```typescript
// Add to top of src/daemon-client.ts:
import { getPythonPath } from './env-setup.js';
```

**Step 2: Update startDaemon method**

```typescript
// src/daemon-client.ts - update startDaemon method (around line 181):
async startDaemon(): Promise<void> {
  const socketPath = this.getSocketPath();
  const daemonDir = getDaemonDir();

  // Ensure daemon directory exists
  if (!fs.existsSync(daemonDir)) {
    fs.mkdirSync(daemonDir, { recursive: true });
  }

  // Get Python path from managed environment
  const pythonPath = await getPythonPath();

  // Spawn detached daemon process
  const daemon = spawn(
    pythonPath,
    [DAEMON_SCRIPT, '--model', this.modelId, '--socket', socketPath],
    {
      detached: true,
      stdio: 'ignore',
    }
  );

  // ... rest of method unchanged
}
```

**Step 3: Run tests**

Run: `npm test`
Expected: PASS

**Step 4: Build and verify**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 5: Commit**

```bash
git add src/daemon-client.ts
git commit -m "refactor(daemon-client): use getPythonPath instead of hardcoded path"
```

---

## Task 9: Update Makefile

**Files:**
- Modify: `Makefile`

**Step 1: Update install target and add reset-python**

```makefile
# Makefile - replace entire contents:
# mlx-hub Makefile
# ================
# Build and test automation for the MLX Hub Claude Code plugin

.PHONY: help install build test test-ts test-py test-watch typecheck clean reset-python all

# Default target
help:
	@echo "mlx-hub - Claude Code plugin for local ML inference"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Setup:"
	@echo "  install        Install Node dependencies (Python deps auto-managed by uv)"
	@echo ""
	@echo "Development:"
	@echo "  build          Compile TypeScript to dist/"
	@echo "  typecheck      Type-check without emitting files"
	@echo "  test-watch     Run tests in watch mode"
	@echo ""
	@echo "Testing:"
	@echo "  test           Run all tests (TypeScript + Python)"
	@echo "  test-ts        Run TypeScript tests only"
	@echo "  test-py        Run Python tests only"
	@echo ""
	@echo "Maintenance:"
	@echo "  clean          Remove build artifacts"
	@echo "  reset-python   Remove managed Python environment"
	@echo "  all            Full check: install, build, test"
	@echo ""
	@echo "Note: Python dependencies are auto-managed via uv."
	@echo "      Ensure uv is installed: brew install uv"

# Install Node dependencies only (Python is auto-managed)
install:
	@echo "Installing Node dependencies..."
	npm install
	@echo ""
	@echo "Note: Python environment will be created automatically on first run."
	@echo "      Requires uv: brew install uv"

# Build TypeScript
build:
	@echo "Building TypeScript..."
	npm run build
	@echo "Build complete: dist/"

# Type-check without emitting
typecheck:
	@echo "Type-checking..."
	npx tsc --noEmit
	@echo "Type-check passed."

# Run all tests
test: test-ts test-py
	@echo ""
	@echo "All tests passed!"

# Run TypeScript tests only
test-ts:
	@echo "Running TypeScript tests..."
	npm test

# Run Python tests only (uses managed venv if available)
test-py:
	@echo "Running Python tests..."
	@if [ -f ~/.mlx-hub/venv/bin/python3 ]; then \
		~/.mlx-hub/venv/bin/python3 -m unittest python/test_mlx_runner.py; \
	else \
		python3 -m unittest python/test_mlx_runner.py; \
	fi

# Watch mode for development
test-watch:
	npm run test:watch

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	rm -rf dist/
	@echo "Clean complete."

# Reset managed Python environment
reset-python:
	@echo "Removing managed Python environment..."
	rm -rf ~/.mlx-hub/venv
	rm -f ~/.mlx-hub/.python-ready
	@echo "Python environment will be recreated on next use."

# Full check: install, build, and test
all: install build test
	@echo ""
	@echo "All checks passed!"
```

**Step 2: Test the new targets**

Run: `make help`
Expected: Shows updated help with reset-python

**Step 3: Commit**

```bash
git add Makefile
git commit -m "build: update Makefile for uv-based Python management"
```

---

## Task 10: Manual integration test

**Files:** None (manual testing)

**Step 1: Reset environment**

```bash
make reset-python
```

**Step 2: Rebuild plugin**

```bash
npm run build
```

**Step 3: Test inference**

Run: `/mlx-hub:run qwen "say hello"`

Expected:
- First run shows "Setting up MLX environment..."
- Subsequent runs are instant
- Inference works

**Step 4: Verify marker file**

```bash
cat ~/.mlx-hub/.python-ready
```

Expected: JSON with created timestamp and requirements_hash

**Step 5: Final commit with all changes**

If any fixes were needed:
```bash
git add -A
git commit -m "fix: integration test fixes"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Path constants | `src/env-setup.ts` |
| 2 | Requirements hash | `src/env-setup.ts` |
| 3 | uv detection | `src/env-setup.ts` |
| 4 | Marker file ops | `src/env-setup.ts` |
| 5 | ensurePythonEnv | `src/env-setup.ts` |
| 6 | getPythonPath cache | `src/env-setup.ts` |
| 7 | Update python-runner | `src/python-runner.ts` |
| 8 | Update daemon-client | `src/daemon-client.ts` |
| 9 | Update Makefile | `Makefile` |
| 10 | Integration test | manual |

Total: ~10 commits, ~200 lines of new code
