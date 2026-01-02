/**
 * Integration tests for DaemonClient.
 *
 * These tests verify the DaemonClient behavior without requiring actual MLX models.
 * Focus on edge cases, error handling, and socket path utilities.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { DaemonClient } from '../daemon-client.js';
import {
  getSocketPath,
  getPidPath,
  getDaemonDir,
  modelIdToSocketName,
} from '../socket-utils.js';

describe('Integration: DaemonClient', () => {
  const testModelId = 'mlx-community/test-model';

  afterEach(async () => {
    // Cleanup any test artifacts
    const socketPath = getSocketPath(testModelId);
    const pidPath = getPidPath(testModelId);
    try {
      fs.unlinkSync(socketPath);
    } catch {
      // Ignore if doesn't exist
    }
    try {
      fs.unlinkSync(pidPath);
    } catch {
      // Ignore if doesn't exist
    }
  });

  describe('constructor and path methods', () => {
    it('creates a client for a model ID', () => {
      const client = new DaemonClient(testModelId);
      expect(client).toBeInstanceOf(DaemonClient);
    });

    it('returns correct socket path for model', () => {
      const client = new DaemonClient(testModelId);
      const socketPath = client.getSocketPath();
      expect(socketPath).toBe(getSocketPath(testModelId));
      expect(socketPath).toContain('test-model.sock');
    });

    it('returns correct pid path for model', () => {
      const client = new DaemonClient(testModelId);
      const pidPath = client.getPidPath();
      expect(pidPath).toBe(getPidPath(testModelId));
      expect(pidPath).toContain('test-model.pid');
    });

    it('handles different model ID formats', () => {
      const models = [
        'mlx-community/Llama-3.2-1B-Instruct-4bit',
        'my-org/Custom-Model',
        'simple-model',
      ];

      for (const modelId of models) {
        const client = new DaemonClient(modelId);
        expect(client.getSocketPath()).toContain('.sock');
        expect(client.getPidPath()).toContain('.pid');
      }
    });
  });

  describe('generateRequestId', () => {
    it('generates unique request IDs', () => {
      const client = new DaemonClient(testModelId);
      const ids = new Set<string>();

      for (let i = 0; i < 100; i++) {
        ids.add(client.generateRequestId());
      }

      // All IDs should be unique
      expect(ids.size).toBe(100);
    });

    it('generates UUIDs in correct format', () => {
      const client = new DaemonClient(testModelId);
      const id = client.generateRequestId();

      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });
  });

  describe('isDaemonRunning', () => {
    it('returns false when no socket file exists', () => {
      const client = new DaemonClient('nonexistent/model-xyz');
      expect(client.isDaemonRunning()).toBe(false);
    });

    it('returns false when socket exists but no pid file', () => {
      const client = new DaemonClient(testModelId);
      const socketPath = client.getSocketPath();

      // Ensure daemon directory exists
      const daemonDir = getDaemonDir();
      if (!fs.existsSync(daemonDir)) {
        fs.mkdirSync(daemonDir, { recursive: true });
      }

      // Create socket file but no pid
      fs.writeFileSync(socketPath, '');

      expect(client.isDaemonRunning()).toBe(false);

      // Cleanup
      fs.unlinkSync(socketPath);
    });

    it('returns false when socket and pid exist but process is dead', () => {
      const client = new DaemonClient(testModelId);
      const socketPath = client.getSocketPath();
      const pidPath = client.getPidPath();

      // Ensure daemon directory exists
      const daemonDir = getDaemonDir();
      if (!fs.existsSync(daemonDir)) {
        fs.mkdirSync(daemonDir, { recursive: true });
      }

      // Create socket and pid files with invalid pid
      fs.writeFileSync(socketPath, '');
      fs.writeFileSync(pidPath, '999999999'); // Very unlikely to be a real process

      expect(client.isDaemonRunning()).toBe(false);

      // Cleanup
      fs.unlinkSync(socketPath);
      fs.unlinkSync(pidPath);
    });

    it('returns false when pid file contains invalid data', () => {
      const client = new DaemonClient(testModelId);
      const socketPath = client.getSocketPath();
      const pidPath = client.getPidPath();

      // Ensure daemon directory exists
      const daemonDir = getDaemonDir();
      if (!fs.existsSync(daemonDir)) {
        fs.mkdirSync(daemonDir, { recursive: true });
      }

      // Create socket and pid files with non-numeric content
      fs.writeFileSync(socketPath, '');
      fs.writeFileSync(pidPath, 'not-a-number');

      expect(client.isDaemonRunning()).toBe(false);

      // Cleanup
      fs.unlinkSync(socketPath);
      fs.unlinkSync(pidPath);
    });
  });

  describe('connect error handling', () => {
    it('rejects when connecting to non-existent daemon and auto-start fails', async () => {
      // Create a client with a model that won't have a daemon script
      const client = new DaemonClient('nonexistent/test-model-for-connect');

      // Mock startDaemon to fail (since we don't have the actual Python script)
      const startDaemonSpy = vi
        .spyOn(client as any, 'startDaemon')
        .mockRejectedValue(new Error('Daemon failed to start within 10000ms'));

      await expect(client.connect()).rejects.toThrow();

      startDaemonSpy.mockRestore();
    });

    it('handles socket connection errors gracefully', async () => {
      const client = new DaemonClient(testModelId);
      const socketPath = client.getSocketPath();
      const pidPath = client.getPidPath();

      // Ensure daemon directory exists
      const daemonDir = getDaemonDir();
      if (!fs.existsSync(daemonDir)) {
        fs.mkdirSync(daemonDir, { recursive: true });
      }

      // Create fake socket and pid to bypass auto-start
      fs.writeFileSync(socketPath, '');
      fs.writeFileSync(pidPath, String(process.pid)); // Use our own pid so it "exists"

      // isDaemonRunning will return true but connection will fail
      // because the socket file isn't a real Unix socket
      await expect(client.connect()).rejects.toThrow();

      // Cleanup
      fs.unlinkSync(socketPath);
      fs.unlinkSync(pidPath);
    });
  });

  describe('close', () => {
    it('handles close on unconnected client gracefully', async () => {
      const client = new DaemonClient(testModelId);

      // Should not throw
      await expect(client.close()).resolves.toBeUndefined();
    });

    it('can be called multiple times safely', async () => {
      const client = new DaemonClient(testModelId);

      await client.close();
      await client.close();
      await client.close();

      // No error should be thrown
      expect(true).toBe(true);
    });
  });

  describe('infer without connection', () => {
    it('throws when connection fails during infer', async () => {
      const client = new DaemonClient(testModelId);

      // Mock isDaemonRunning to return false and startDaemon to fail
      vi.spyOn(client, 'isDaemonRunning').mockReturnValue(false);
      vi.spyOn(client as any, 'startDaemon').mockRejectedValue(
        new Error('Daemon failed to start')
      );

      // Currently infer() doesn't catch connection errors (connect is outside try-catch)
      // This test documents the current behavior
      await expect(client.infer({ prompt: 'test' })).rejects.toThrow(
        'Daemon failed to start'
      );

      vi.restoreAllMocks();
    });
  });

  describe('ping without daemon', () => {
    it('returns false when daemon is not running', async () => {
      const client = new DaemonClient('nonexistent/model');

      // Mock connect to reject
      const connectSpy = vi
        .spyOn(client, 'connect')
        .mockRejectedValue(new Error('Connection failed'));

      const result = await client.ping();

      expect(result).toBe(false);

      connectSpy.mockRestore();
    });
  });
});

describe('Integration: Socket path utilities', () => {
  describe('modelIdToSocketName', () => {
    it('strips mlx-community prefix', () => {
      const result = modelIdToSocketName('mlx-community/Llama-3.2');
      expect(result).not.toContain('mlx-community');
      expect(result).toBe('llama-3-2');
    });

    it('converts to lowercase', () => {
      const result = modelIdToSocketName('MyModel-ABC');
      expect(result).toBe('mymodel-abc');
    });

    it('replaces special characters with hyphens', () => {
      const result = modelIdToSocketName('model/with.dots_and_underscores');
      expect(result).toBe('model-with-dots-and-underscores');
    });

    it('collapses multiple hyphens', () => {
      const result = modelIdToSocketName('model---with---hyphens');
      expect(result).toBe('model-with-hyphens');
    });

    it('removes leading and trailing hyphens', () => {
      const result = modelIdToSocketName('-model-name-');
      expect(result).toBe('model-name');
    });
  });

  describe('getDaemonDir', () => {
    it('returns path in home directory', () => {
      const daemonDir = getDaemonDir();
      expect(daemonDir).toContain('.mlx-hub');
      expect(daemonDir).toContain('daemons');
    });
  });

  describe('getSocketPath', () => {
    it('returns .sock file in daemon directory', () => {
      const socketPath = getSocketPath('test-model');
      expect(socketPath).toContain('daemons');
      expect(socketPath).toMatch(/\.sock$/);
    });
  });

  describe('getPidPath', () => {
    it('returns .pid file in daemon directory', () => {
      const pidPath = getPidPath('test-model');
      expect(pidPath).toContain('daemons');
      expect(pidPath).toMatch(/\.pid$/);
    });
  });

  describe('path consistency', () => {
    it('socket and pid paths use same base name', () => {
      const modelId = 'mlx-community/Llama-3.2-1B-Instruct-4bit';
      const socketPath = getSocketPath(modelId);
      const pidPath = getPidPath(modelId);

      const socketBase = path.basename(socketPath, '.sock');
      const pidBase = path.basename(pidPath, '.pid');

      expect(socketBase).toBe(pidBase);
    });
  });
});

describe('Integration: Multiple clients', () => {
  it('different models get different socket paths', () => {
    const client1 = new DaemonClient('model-a');
    const client2 = new DaemonClient('model-b');

    expect(client1.getSocketPath()).not.toBe(client2.getSocketPath());
    expect(client1.getPidPath()).not.toBe(client2.getPidPath());
  });

  it('same model gets same socket path', () => {
    const modelId = 'mlx-community/Llama-3.2-1B-Instruct-4bit';
    const client1 = new DaemonClient(modelId);
    const client2 = new DaemonClient(modelId);

    expect(client1.getSocketPath()).toBe(client2.getSocketPath());
    expect(client1.getPidPath()).toBe(client2.getPidPath());
  });
});
