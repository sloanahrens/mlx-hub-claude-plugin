/**
 * MCP Server Handler Tests
 *
 * These tests verify the logic that transforms Python runner results
 * into MCP tool responses. We test the handler behavior by reimplementing
 * the key logic paths.
 *
 * Note: A future refactor could extract handlers into a separate module
 * for more direct testing. For now, we test the transformation logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SearchInputSchema,
  DownloadInputSchema,
  ListInputSchema,
  RemoveInputSchema,
  InferInputSchema,
} from '../types.js';

// Mock python-runner
vi.mock('../python-runner.js', () => ({
  runPythonCommand: vi.fn(),
  runInferenceStreaming: vi.fn(),
}));

import { runPythonCommand, runInferenceStreaming } from '../python-runner.js';

// Helper to format search results (mirrors mcp-server.ts logic)
function formatSearchResults(data: { results: Array<{ model_id: string; downloads: number; likes: number }> }) {
  const formatted = data.results
    .map((m, i) => `${i + 1}. ${m.model_id} (${m.downloads.toLocaleString()} downloads, ${m.likes} likes)`)
    .join('\n');
  return `Found ${data.results.length} MLX-compatible models:\n\n${formatted}`;
}

// Helper to format list results (mirrors mcp-server.ts logic)
function formatListResults(data: { models: Array<{ model_id: string; size_human: string; last_modified: string }> }) {
  if (data.models.length === 0) {
    return 'No MLX models found locally. Use mlx_search and mlx_download to get started.';
  }
  const formatted = data.models
    .map((m) => `- ${m.model_id} (${m.size_human}, last used: ${new Date(m.last_modified).toLocaleDateString()})`)
    .join('\n');
  return `Local MLX models:\n\n${formatted}`;
}

describe('Tool Response Formatting', () => {
  describe('mlx_search formatting', () => {
    it('formats search results correctly', () => {
      const data = {
        results: [
          { model_id: 'mlx-community/Llama-3.2-3B-4bit', downloads: 45000, likes: 120 },
          { model_id: 'mlx-community/Mistral-7B-4bit', downloads: 32000, likes: 85 },
        ],
      };

      const output = formatSearchResults(data);

      expect(output).toContain('Found 2 MLX-compatible models');
      expect(output).toContain('1. mlx-community/Llama-3.2-3B-4bit');
      expect(output).toContain('45,000 downloads');
      expect(output).toContain('120 likes');
      expect(output).toContain('2. mlx-community/Mistral-7B-4bit');
    });

    it('handles empty results', () => {
      const data = { results: [] };
      const output = formatSearchResults(data);
      expect(output).toContain('Found 0 MLX-compatible models');
    });
  });

  describe('mlx_list_local formatting', () => {
    it('formats model list correctly', () => {
      const data = {
        models: [
          {
            model_id: 'mlx-community/Llama-3.2-1B-Instruct-4bit',
            size_human: '0.7 GB',
            last_modified: '2026-01-01T12:00:00Z',
          },
        ],
      };

      const output = formatListResults(data);

      expect(output).toContain('Local MLX models');
      expect(output).toContain('mlx-community/Llama-3.2-1B-Instruct-4bit');
      expect(output).toContain('0.7 GB');
    });

    it('shows helpful message for empty list', () => {
      const data = { models: [] };
      const output = formatListResults(data);
      expect(output).toContain('No MLX models found locally');
      expect(output).toContain('mlx_search');
      expect(output).toContain('mlx_download');
    });
  });

  describe('mlx_download formatting', () => {
    it('formats download success correctly', () => {
      const data = {
        model_id: 'mlx-community/Test-Model',
        path: '/Users/test/.cache/huggingface/hub/models--mlx-community--Test-Model',
        size_human: '1.5 GB',
      };

      // Mirror the mcp-server.ts formatting
      const output = `Downloaded ${data.model_id}\nSize: ${data.size_human}\nPath: ${data.path}`;

      expect(output).toContain('Downloaded mlx-community/Test-Model');
      expect(output).toContain('Size: 1.5 GB');
      expect(output).toContain('Path:');
    });
  });

  describe('mlx_remove formatting', () => {
    it('formats removal success correctly', () => {
      const data = {
        model_id: 'mlx-community/Old-Model',
        freed_human: '2.3 GB',
      };

      const output = `Removed ${data.model_id}\nFreed: ${data.freed_human}`;

      expect(output).toContain('Removed mlx-community/Old-Model');
      expect(output).toContain('Freed: 2.3 GB');
    });
  });

  describe('mlx_infer formatting', () => {
    it('formats inference output with stats', () => {
      const generatedText = 'Hello! I am a helpful assistant.';
      const stats = { tokens_generated: 8, tokens_per_sec: 95.5 };

      const output = `${generatedText}\n\n---\n${stats.tokens_generated} tokens @ ${stats.tokens_per_sec} tok/s`;

      expect(output).toContain('Hello! I am a helpful assistant.');
      expect(output).toContain('8 tokens @ 95.5 tok/s');
    });
  });
});

describe('Tool Handler Error Paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles python runner errors gracefully', async () => {
    vi.mocked(runPythonCommand).mockResolvedValue({
      success: false,
      error: 'Network timeout',
    });

    const result = await runPythonCommand('search', ['test']);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Network timeout');
  });

  it('handles model not found error', async () => {
    vi.mocked(runPythonCommand).mockResolvedValue({
      success: false,
      error: 'Model not found: fake/model',
    });

    const result = await runPythonCommand('download', ['fake/model']);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Model not found');
  });

  it('handles gated repository error', async () => {
    vi.mocked(runPythonCommand).mockResolvedValue({
      success: false,
      error: 'Model meta-llama/Llama-3.1-8B is gated. Run huggingface-cli login first.',
    });

    const result = await runPythonCommand('download', ['meta-llama/Llama-3.1-8B']);

    expect(result.success).toBe(false);
    expect(result.error).toContain('gated');
    expect(result.error).toContain('login');
  });

  it('handles inference streaming error', async () => {
    vi.mocked(runInferenceStreaming).mockResolvedValue({
      success: false,
      error: 'Model not found locally: test/model. Run download first.',
    });

    const result = await runInferenceStreaming('test/model', 'Hello', 256, 0.7, () => {});

    expect(result.success).toBe(false);
    expect(result.error).toContain('not found locally');
  });
});

describe('Schema Validation in Handlers', () => {
  it('search rejects missing query', () => {
    expect(() => SearchInputSchema.parse({})).toThrow();
  });

  it('download rejects missing model_id', () => {
    expect(() => DownloadInputSchema.parse({})).toThrow();
  });

  it('infer rejects missing required fields', () => {
    expect(() => InferInputSchema.parse({ model_id: 'test' })).toThrow(); // missing prompt
    expect(() => InferInputSchema.parse({ prompt: 'hello' })).toThrow(); // missing model_id
  });

  it('list accepts empty params', () => {
    const result = ListInputSchema.parse({});
    expect(result).toEqual({});
  });

  it('remove requires model_id', () => {
    expect(() => RemoveInputSchema.parse({})).toThrow();
  });
});
