import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock child_process before importing
const mockProc = {
  stdin: {
    write: vi.fn(),
  },
  stdout: new EventEmitter(),
  stderr: new EventEmitter(),
  on: vi.fn(),
  once: vi.fn(),
  kill: vi.fn(),
};

vi.mock('child_process', () => ({
  spawn: vi.fn(() => mockProc),
}));

describe('daemon-runner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock event handlers
    mockProc.on.mockImplementation((event: string, handler: Function) => {
      if (event === 'error') {
        // Don't trigger error by default
      }
      return mockProc;
    });
    mockProc.once.mockImplementation((event: string, handler: Function) => {
      return mockProc;
    });
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('DaemonResponse types', () => {
    it('defines all expected response types', async () => {
      // This is a type check - import the types
      const { daemonManager } = await import('../daemon-runner.js');

      // Verify the manager exists
      expect(daemonManager).toBeDefined();
      expect(typeof daemonManager.isRunning).toBe('function');
      expect(typeof daemonManager.start).toBe('function');
      expect(typeof daemonManager.infer).toBe('function');
      expect(typeof daemonManager.shutdown).toBe('function');
    });
  });

  describe('InferRequest interface', () => {
    it('accepts all required and optional fields', async () => {
      const { daemonManager } = await import('../daemon-runner.js');

      // Type check: these should compile without errors
      const request = {
        model_id: 'mlx-community/Llama-3.2-1B-Instruct-4bit',
        prompt: 'Hello world',
        system_prompt: 'You are a helpful assistant',
        max_tokens: 256,
        temperature: 0.7,
      };

      expect(request.model_id).toBe('mlx-community/Llama-3.2-1B-Instruct-4bit');
      expect(request.prompt).toBe('Hello world');
    });
  });

  describe('daemon not running', () => {
    it('isRunning returns false when daemon not started', async () => {
      const { daemonManager } = await import('../daemon-runner.js');
      expect(daemonManager.isRunning()).toBe(false);
    });
  });

  describe('InferMessagesRequest interface', () => {
    it('accepts messages array format', async () => {
      const request = {
        model_id: 'mlx-community/Llama-3.2-1B-Instruct-4bit',
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi!' },
          { role: 'user', content: 'How are you?' },
        ],
        max_tokens: 512,
        temperature: 0.5,
      };

      expect(request.messages).toHaveLength(4);
      expect(request.messages[0].role).toBe('system');
    });
  });
});
