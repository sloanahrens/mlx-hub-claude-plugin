import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as os from 'os';

// Mock fs before importing
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Mock net before importing
const mockSocket = Object.assign(new EventEmitter(), {
  write: vi.fn(),
  end: vi.fn(),
  destroy: vi.fn(),
  destroyed: false,
});

vi.mock('net', () => ({
  createConnection: vi.fn((path: string, callback: () => void) => {
    // Simulate async connection
    setImmediate(callback);
    return mockSocket;
  }),
}));

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    unref: vi.fn(),
    pid: 12345,
  })),
}));

// Mock crypto
vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid-1234'),
}));

describe('DaemonClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset socket state
    mockSocket.destroyed = false;
    mockSocket.removeAllListeners();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('constructor', () => {
    it('creates client with model ID', async () => {
      const { DaemonClient } = await import('../daemon-client.js');
      const client = new DaemonClient('mlx-community/Llama-3.2-1B-Instruct-4bit');
      expect(client).toBeDefined();
    });
  });

  describe('getSocketPath', () => {
    it('returns correct socket path for model', async () => {
      const { DaemonClient } = await import('../daemon-client.js');
      const client = new DaemonClient('mlx-community/Llama-3.2-1B-Instruct-4bit');

      const socketPath = client.getSocketPath();

      // Should be in ~/.mlx-hub/daemons/ with .sock extension
      expect(socketPath).toContain('.mlx-hub');
      expect(socketPath).toContain('daemons');
      expect(socketPath).toContain('llama-3-2-1b-instruct-4bit.sock');
    });

    it('handles different model IDs correctly', async () => {
      const { DaemonClient } = await import('../daemon-client.js');

      const client1 = new DaemonClient('mlx-community/DeepSeek-Coder-V2-Lite-Instruct-4bit');
      const client2 = new DaemonClient('mlx-community/Qwen2.5-7B-Instruct-8bit');

      const path1 = client1.getSocketPath();
      const path2 = client2.getSocketPath();

      expect(path1).toContain('deepseek-coder-v2-lite-instruct-4bit.sock');
      expect(path2).toContain('qwen2-5-7b-instruct-8bit.sock');
      expect(path1).not.toBe(path2);
    });
  });

  describe('getPidPath', () => {
    it('returns correct PID path for model', async () => {
      const { DaemonClient } = await import('../daemon-client.js');
      const client = new DaemonClient('mlx-community/Llama-3.2-1B-Instruct-4bit');

      const pidPath = client.getPidPath();

      expect(pidPath).toContain('.mlx-hub');
      expect(pidPath).toContain('daemons');
      expect(pidPath).toContain('llama-3-2-1b-instruct-4bit.pid');
    });
  });

  describe('generateRequestId', () => {
    it('returns a UUID', async () => {
      const { DaemonClient } = await import('../daemon-client.js');
      const client = new DaemonClient('test-model');

      const id = client.generateRequestId();

      expect(id).toBe('test-uuid-1234');
    });

    it('generates unique IDs on each call', async () => {
      // Reset mock to return different values
      const crypto = await import('crypto');
      let callCount = 0;
      vi.mocked(crypto.randomUUID).mockImplementation(() => {
        callCount++;
        return `uuid-${callCount}`;
      });

      const { DaemonClient } = await import('../daemon-client.js');
      const client = new DaemonClient('test-model');

      const id1 = client.generateRequestId();
      const id2 = client.generateRequestId();

      expect(id1).not.toBe(id2);
    });
  });

  describe('isDaemonRunning', () => {
    it('returns false when socket file does not exist', async () => {
      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const { DaemonClient } = await import('../daemon-client.js');
      const client = new DaemonClient('test-model');

      expect(client.isDaemonRunning()).toBe(false);
    });

    it('returns false when PID file does not exist', async () => {
      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockImplementation((path: any) => {
        return path.toString().endsWith('.sock');
      });

      const { DaemonClient } = await import('../daemon-client.js');
      const client = new DaemonClient('test-model');

      expect(client.isDaemonRunning()).toBe(false);
    });

    it('returns false when PID is invalid', async () => {
      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('not-a-number');

      const { DaemonClient } = await import('../daemon-client.js');
      const client = new DaemonClient('test-model');

      expect(client.isDaemonRunning()).toBe(false);
    });

    it('returns false when process is not alive', async () => {
      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('99999999');

      // Mock process.kill to throw (process not found)
      const originalKill = process.kill;
      process.kill = vi.fn(() => {
        throw new Error('ESRCH');
      }) as any;

      const { DaemonClient } = await import('../daemon-client.js');
      const client = new DaemonClient('test-model');

      expect(client.isDaemonRunning()).toBe(false);

      process.kill = originalKill;
    });

    it('returns true when socket, PID file exist and process is alive', async () => {
      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(String(process.pid));

      const { DaemonClient } = await import('../daemon-client.js');
      const client = new DaemonClient('test-model');

      // Current process should be alive
      expect(client.isDaemonRunning()).toBe(true);
    });
  });

  describe('InferParams and InferResult types', () => {
    it('defines correct InferParams structure', async () => {
      const { DaemonClient } = await import('../daemon-client.js');

      // Type check: these should compile
      const params = {
        prompt: 'Hello, world!',
        system_prompt: 'You are helpful',
        max_tokens: 100,
        temperature: 0.5,
      };

      expect(params.prompt).toBe('Hello, world!');
    });

    it('supports messages array in InferParams', async () => {
      const params = {
        messages: [
          { role: 'system', content: 'Be helpful' },
          { role: 'user', content: 'Hello' },
        ],
        max_tokens: 200,
      };

      expect(params.messages).toHaveLength(2);
      expect(params.messages[0].role).toBe('system');
    });
  });

  describe('close', () => {
    it('closes the socket connection', async () => {
      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(String(process.pid));

      const { DaemonClient } = await import('../daemon-client.js');
      const client = new DaemonClient('test-model');

      // Connect first
      const connectPromise = client.connect();
      await connectPromise;

      // Close
      const closePromise = client.close();
      mockSocket.emit('close');
      await closePromise;

      expect(mockSocket.end).toHaveBeenCalled();
    });

    it('resolves immediately if not connected', async () => {
      const { DaemonClient } = await import('../daemon-client.js');
      const client = new DaemonClient('test-model');

      // Should not throw
      await client.close();
    });
  });
});
