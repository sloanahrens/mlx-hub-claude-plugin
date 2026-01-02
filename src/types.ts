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

// Message format for multi-turn conversations
export const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string(),
});

export const InferInputSchema = z.object({
  model_id: z.string().min(1, 'Model ID is required'),
  // Either prompt OR messages is required (checked at runtime)
  prompt: z.string().min(1).optional(),
  messages: z.array(MessageSchema).min(1).optional(),
  system_prompt: z.string().optional(),
  max_tokens: z.number().int().min(1).max(4096).default(256),
  temperature: z.number().min(0).max(2).default(0.7),
}).refine(
  (data) => data.prompt !== undefined || data.messages !== undefined,
  { message: 'Either prompt or messages is required' }
).refine(
  (data) => !(data.prompt !== undefined && data.messages !== undefined),
  { message: 'Cannot specify both prompt and messages' }
);

export const InfoInputSchema = z.object({
  model_id: z.string().min(1, 'Model ID is required'),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;
export type DownloadInput = z.infer<typeof DownloadInputSchema>;
export type ListInput = z.infer<typeof ListInputSchema>;
export type RemoveInput = z.infer<typeof RemoveInputSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type InferInput = z.infer<typeof InferInputSchema>;
export type InfoInput = z.infer<typeof InfoInputSchema>;
