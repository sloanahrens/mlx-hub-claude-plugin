import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock child_process before importing the module
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock env-setup to provide a consistent Python path
vi.mock('../env-setup.js', () => ({
  getPythonPath: vi.fn().mockResolvedValue('/mocked/venv/bin/python3'),
}));

import { spawn } from 'child_process';
import { runPythonCommand, runInferenceStreaming, StreamToken } from '../python-runner.js';

// Helper to create a mock process
function createMockProcess() {
  const proc = {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    on: vi.fn(),
  } as unknown as ReturnType<typeof spawn>;

  // Make 'on' chainable and store handlers
  const handlers: Record<string, Function> = {};
  (proc.on as ReturnType<typeof vi.fn>).mockImplementation((event: string, handler: Function) => {
    handlers[event] = handler;
    return proc;
  });

  return { proc, handlers };
}

describe('runPythonCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns parsed JSON on success', async () => {
    const { proc, handlers } = createMockProcess();
    vi.mocked(spawn).mockReturnValue(proc);

    const resultPromise = runPythonCommand('list', []);

    // Wait for getPythonPath() to resolve before emitting events
    await new Promise((resolve) => setImmediate(resolve));

    // Simulate stdout data
    proc.stdout.emit('data', '{"models": [], "total_size_bytes": 0}\n');

    // Simulate successful exit
    handlers['close']?.(0);

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ models: [], total_size_bytes: 0 });
  });

  it('returns error on non-zero exit code', async () => {
    const { proc, handlers } = createMockProcess();
    vi.mocked(spawn).mockReturnValue(proc);

    const resultPromise = runPythonCommand('search', ['test']);

    // Wait for getPythonPath() to resolve before emitting events
    await new Promise((resolve) => setImmediate(resolve));

    // Simulate stderr
    proc.stderr.emit('data', 'Connection error');

    // Simulate failed exit
    handlers['close']?.(1);

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('Connection error');
  });

  it('handles JSON error in output', async () => {
    const { proc, handlers } = createMockProcess();
    vi.mocked(spawn).mockReturnValue(proc);

    const resultPromise = runPythonCommand('download', ['test/model']);

    // Wait for getPythonPath() to resolve before emitting events
    await new Promise((resolve) => setImmediate(resolve));

    // Simulate error JSON in stdout
    proc.stdout.emit('data', '{"error": "Model not found"}\n');

    handlers['close']?.(1);

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toBe('Model not found');
  });

  it('handles spawn error', async () => {
    const { proc, handlers } = createMockProcess();
    vi.mocked(spawn).mockReturnValue(proc);

    const resultPromise = runPythonCommand('infer', ['model']);

    // Wait for getPythonPath() to resolve before emitting events
    await new Promise((resolve) => setImmediate(resolve));

    // Simulate spawn error (e.g., python3 not found)
    handlers['error']?.(new Error('spawn python3 ENOENT'));

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to spawn Python');
  });

  it('parses last line of multi-line output', async () => {
    const { proc, handlers } = createMockProcess();
    vi.mocked(spawn).mockReturnValue(proc);

    const resultPromise = runPythonCommand('download', ['mlx-community/test']);

    // Wait for getPythonPath() to resolve before emitting events
    await new Promise((resolve) => setImmediate(resolve));

    // Simulate progress output followed by final result
    proc.stdout.emit('data', '{"status": "downloading"}\n');
    proc.stdout.emit('data', '{"status": "complete", "path": "/path/to/model"}\n');

    handlers['close']?.(0);

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect((result.data as { status: string }).status).toBe('complete');
  });

  it('calls spawn with correct arguments', async () => {
    const { proc, handlers } = createMockProcess();
    vi.mocked(spawn).mockReturnValue(proc);

    const resultPromise = runPythonCommand('search', ['llama', '--limit', '5']);

    // Wait a tick for getPythonPath() to resolve
    await new Promise((resolve) => setImmediate(resolve));

    expect(spawn).toHaveBeenCalledWith(
      '/mocked/venv/bin/python3',
      expect.arrayContaining(['search', 'llama', '--limit', '5'])
    );

    handlers['close']?.(0);
    await resultPromise;
  });
});

describe('runInferenceStreaming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('streams tokens via callback', async () => {
    const { proc, handlers } = createMockProcess();
    vi.mocked(spawn).mockReturnValue(proc);

    const tokens: StreamToken[] = [];
    const resultPromise = runInferenceStreaming(
      'mlx-community/Llama-3.2-1B-Instruct-4bit',
      'Hello',
      256,
      0.7,
      (token) => tokens.push(token)
    );

    // Wait for getPythonPath() to resolve before emitting events
    await new Promise((resolve) => setImmediate(resolve));

    // Simulate streaming tokens
    proc.stdout.emit('data', '{"type": "status", "message": "Loading..."}\n');
    proc.stdout.emit('data', '{"type": "token", "content": "Hello"}\n');
    proc.stdout.emit('data', '{"type": "token", "content": " world"}\n');
    proc.stdout.emit('data', '{"type": "done", "tokens_generated": 2, "tokens_per_sec": 100}\n');

    handlers['close']?.(0);

    const result = await resultPromise;
    expect(result.success).toBe(true);
    expect(tokens).toHaveLength(4);
    expect(tokens[0].type).toBe('status');
    expect(tokens[1].content).toBe('Hello');
    expect(tokens[2].content).toBe(' world');
    expect(tokens[3].type).toBe('done');
  });

  it('handles partial JSON lines in buffer', async () => {
    const { proc, handlers } = createMockProcess();
    vi.mocked(spawn).mockReturnValue(proc);

    const tokens: StreamToken[] = [];
    const resultPromise = runInferenceStreaming(
      'test/model',
      'Test',
      100,
      0.5,
      (token) => tokens.push(token)
    );

    // Wait for getPythonPath() to resolve before emitting events
    await new Promise((resolve) => setImmediate(resolve));

    // Simulate data split across chunks
    proc.stdout.emit('data', '{"type": "token", "con');
    proc.stdout.emit('data', 'tent": "Hi"}\n{"type": "done"}\n');

    handlers['close']?.(0);

    await resultPromise;
    expect(tokens).toHaveLength(2);
    expect(tokens[0].content).toBe('Hi');
  });

  it('returns error on failed inference', async () => {
    const { proc, handlers } = createMockProcess();
    vi.mocked(spawn).mockReturnValue(proc);

    const resultPromise = runInferenceStreaming(
      'nonexistent/model',
      'Test',
      100,
      0.7,
      () => {}
    );

    // Wait for getPythonPath() to resolve before emitting events
    await new Promise((resolve) => setImmediate(resolve));

    proc.stderr.emit('data', 'Model not found locally');
    handlers['close']?.(1);

    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('Model not found');
  });

  it('passes correct arguments to spawn', async () => {
    const { proc, handlers } = createMockProcess();
    vi.mocked(spawn).mockReturnValue(proc);

    const resultPromise = runInferenceStreaming(
      'mlx-community/Test',
      'Hello world',
      512,
      0.3,
      () => {}
    );

    // Wait a tick for getPythonPath() to resolve
    await new Promise((resolve) => setImmediate(resolve));

    expect(spawn).toHaveBeenCalledWith(
      '/mocked/venv/bin/python3',
      expect.arrayContaining([
        'infer',
        'mlx-community/Test',
        '--prompt', 'Hello world',
        '--max-tokens', '512',
        '--temperature', '0.3',
      ])
    );

    // Emit 'done' token to allow promise to resolve
    proc.stdout.emit('data', '{"type": "done"}\n');
    handlers['close']?.(0);
    await resultPromise;
  });
});
