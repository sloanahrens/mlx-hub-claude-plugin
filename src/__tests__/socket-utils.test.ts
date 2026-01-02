import { describe, it, expect } from 'vitest';
import {
  modelIdToSocketName,
  getSocketPath,
  getPidPath,
  getDaemonDir,
} from '../socket-utils.js';
import { homedir } from 'os';
import { join } from 'path';

describe('socket-utils', () => {
  describe('modelIdToSocketName', () => {
    it('converts mlx-community model ID to socket name', () => {
      const result = modelIdToSocketName('mlx-community/DeepSeek-Coder-V2-Lite-Instruct-4bit');
      expect(result).toBe('deepseek-coder-v2-lite-instruct-4bit');
    });

    it('strips mlx-community/ prefix', () => {
      const result = modelIdToSocketName('mlx-community/Llama-3.2-1B-Instruct-4bit');
      expect(result).toBe('llama-3-2-1b-instruct-4bit');
    });

    it('lowercases the entire name', () => {
      const result = modelIdToSocketName('mlx-community/UPPERCASE-Model');
      expect(result).toBe('uppercase-model');
    });

    it('replaces non-alphanumeric characters with hyphens', () => {
      const result = modelIdToSocketName('mlx-community/Model_with.special@chars');
      expect(result).toBe('model-with-special-chars');
    });

    it('handles model IDs without mlx-community prefix', () => {
      const result = modelIdToSocketName('some-org/Some-Model-4bit');
      expect(result).toBe('some-org-some-model-4bit');
    });

    it('collapses multiple consecutive hyphens', () => {
      const result = modelIdToSocketName('mlx-community/Model__with---multiple___chars');
      expect(result).toBe('model-with-multiple-chars');
    });

    it('removes leading and trailing hyphens', () => {
      const result = modelIdToSocketName('mlx-community/-Model-Name-');
      expect(result).toBe('model-name');
    });

    it('handles empty string after prefix strip', () => {
      const result = modelIdToSocketName('mlx-community/');
      expect(result).toBe('');
    });

    it('handles completely empty string', () => {
      const result = modelIdToSocketName('');
      expect(result).toBe('');
    });

    it('handles numeric model IDs', () => {
      const result = modelIdToSocketName('mlx-community/123-Model-456');
      expect(result).toBe('123-model-456');
    });

    it('handles model ID that is all special characters', () => {
      const result = modelIdToSocketName('mlx-community/___');
      expect(result).toBe('');
    });
  });

  describe('getDaemonDir', () => {
    it('returns ~/.mlx-hub/daemons path', () => {
      const result = getDaemonDir();
      expect(result).toBe(join(homedir(), '.mlx-hub', 'daemons'));
    });
  });

  describe('getSocketPath', () => {
    it('returns full socket path for model ID', () => {
      const result = getSocketPath('mlx-community/Llama-3.2-1B-Instruct-4bit');
      const expected = join(homedir(), '.mlx-hub', 'daemons', 'llama-3-2-1b-instruct-4bit.sock');
      expect(result).toBe(expected);
    });

    it('handles complex model names', () => {
      const result = getSocketPath('mlx-community/DeepSeek-Coder-V2-Lite-Instruct-4bit');
      const expected = join(homedir(), '.mlx-hub', 'daemons', 'deepseek-coder-v2-lite-instruct-4bit.sock');
      expect(result).toBe(expected);
    });
  });

  describe('getPidPath', () => {
    it('returns full pid path for model ID', () => {
      const result = getPidPath('mlx-community/Llama-3.2-1B-Instruct-4bit');
      const expected = join(homedir(), '.mlx-hub', 'daemons', 'llama-3-2-1b-instruct-4bit.pid');
      expect(result).toBe(expected);
    });

    it('handles complex model names', () => {
      const result = getPidPath('mlx-community/DeepSeek-Coder-V2-Lite-Instruct-4bit');
      const expected = join(homedir(), '.mlx-hub', 'daemons', 'deepseek-coder-v2-lite-instruct-4bit.pid');
      expect(result).toBe(expected);
    });
  });
});
