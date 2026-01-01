import { describe, it, expect } from 'vitest';
import {
  SearchInputSchema,
  DownloadInputSchema,
  ListInputSchema,
  RemoveInputSchema,
  InferInputSchema,
} from '../types.js';

describe('SearchInputSchema', () => {
  it('accepts valid query with defaults', () => {
    const result = SearchInputSchema.parse({ query: 'llama' });
    expect(result.query).toBe('llama');
    expect(result.limit).toBe(10); // default
  });

  it('accepts custom limit', () => {
    const result = SearchInputSchema.parse({ query: 'mistral', limit: 25 });
    expect(result.limit).toBe(25);
  });

  it('rejects empty query', () => {
    expect(() => SearchInputSchema.parse({ query: '' })).toThrow();
  });

  it('rejects limit below 1', () => {
    expect(() => SearchInputSchema.parse({ query: 'test', limit: 0 })).toThrow();
  });

  it('rejects limit above 50', () => {
    expect(() => SearchInputSchema.parse({ query: 'test', limit: 100 })).toThrow();
  });
});

describe('DownloadInputSchema', () => {
  it('accepts model_id only', () => {
    const result = DownloadInputSchema.parse({ model_id: 'mlx-community/Llama-3.2-3B-4bit' });
    expect(result.model_id).toBe('mlx-community/Llama-3.2-3B-4bit');
    expect(result.quantization).toBeUndefined();
  });

  it('accepts model_id with quantization', () => {
    const result = DownloadInputSchema.parse({
      model_id: 'mlx-community/Llama-3.2-3B',
      quantization: '4bit',
    });
    expect(result.quantization).toBe('4bit');
  });

  it('rejects invalid quantization value', () => {
    expect(() =>
      DownloadInputSchema.parse({
        model_id: 'test/model',
        quantization: '16bit',
      })
    ).toThrow();
  });

  it('rejects empty model_id', () => {
    expect(() => DownloadInputSchema.parse({ model_id: '' })).toThrow();
  });
});

describe('ListInputSchema', () => {
  it('accepts empty object', () => {
    const result = ListInputSchema.parse({});
    expect(result).toEqual({});
  });
});

describe('RemoveInputSchema', () => {
  it('accepts valid model_id', () => {
    const result = RemoveInputSchema.parse({ model_id: 'mlx-community/Test-Model' });
    expect(result.model_id).toBe('mlx-community/Test-Model');
  });

  it('rejects empty model_id', () => {
    expect(() => RemoveInputSchema.parse({ model_id: '' })).toThrow();
  });
});

describe('InferInputSchema', () => {
  it('accepts required fields with defaults', () => {
    const result = InferInputSchema.parse({
      model_id: 'mlx-community/Llama-3.2-1B-Instruct-4bit',
      prompt: 'Hello world',
    });
    expect(result.model_id).toBe('mlx-community/Llama-3.2-1B-Instruct-4bit');
    expect(result.prompt).toBe('Hello world');
    expect(result.max_tokens).toBe(256); // default
    expect(result.temperature).toBe(0.7); // default
  });

  it('accepts custom max_tokens and temperature', () => {
    const result = InferInputSchema.parse({
      model_id: 'test/model',
      prompt: 'Test',
      max_tokens: 1024,
      temperature: 0.3,
    });
    expect(result.max_tokens).toBe(1024);
    expect(result.temperature).toBe(0.3);
  });

  it('rejects max_tokens above 4096', () => {
    expect(() =>
      InferInputSchema.parse({
        model_id: 'test/model',
        prompt: 'Test',
        max_tokens: 5000,
      })
    ).toThrow();
  });

  it('rejects temperature above 2', () => {
    expect(() =>
      InferInputSchema.parse({
        model_id: 'test/model',
        prompt: 'Test',
        temperature: 3,
      })
    ).toThrow();
  });

  it('rejects empty prompt', () => {
    expect(() =>
      InferInputSchema.parse({
        model_id: 'test/model',
        prompt: '',
      })
    ).toThrow();
  });

  it('accepts temperature of 0 (greedy decoding)', () => {
    const result = InferInputSchema.parse({
      model_id: 'test/model',
      prompt: 'Test',
      temperature: 0,
    });
    expect(result.temperature).toBe(0);
  });
});
