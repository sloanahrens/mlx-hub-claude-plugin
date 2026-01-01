import { z } from 'zod';

// Input schemas for tools
export const SearchInputSchema = z.object({
  query: z.string().min(1, 'Query is required'),
  limit: z.number().int().min(1).max(50).default(10),
});

export const DownloadInputSchema = z.object({
  model_id: z.string().min(1, 'Model ID is required'),
  quantization: z.enum(['4bit', '8bit']).optional(),
});

export const ListInputSchema = z.object({});

export const RemoveInputSchema = z.object({
  model_id: z.string().min(1, 'Model ID is required'),
});

export const InferInputSchema = z.object({
  model_id: z.string().min(1, 'Model ID is required'),
  prompt: z.string().min(1, 'Prompt is required'),
  max_tokens: z.number().int().min(1).max(4096).default(256),
  temperature: z.number().min(0).max(2).default(0.7),
});

export const InfoInputSchema = z.object({
  model_id: z.string().min(1, 'Model ID is required'),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;
export type DownloadInput = z.infer<typeof DownloadInputSchema>;
export type ListInput = z.infer<typeof ListInputSchema>;
export type RemoveInput = z.infer<typeof RemoveInputSchema>;
export type InferInput = z.infer<typeof InferInputSchema>;
export type InfoInput = z.infer<typeof InfoInputSchema>;
