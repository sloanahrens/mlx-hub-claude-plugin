#!/usr/bin/env node
/**
 * MCP Server for mlx-hub.
 * Provides tools to search, download, and run MLX models locally.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  SearchInputSchema,
  DownloadInputSchema,
  ListInputSchema,
  RemoveInputSchema,
  InferInputSchema,
} from './types.js';

// Create MCP Server
const server = new Server(
  {
    name: 'mlx-hub',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register Tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'mlx_search',
        description: 'Search Hugging Face Hub for MLX-compatible models. Returns models from mlx-community and those tagged with mlx.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', minLength: 1, description: 'Search query (e.g., "llama 8b", "code", "mistral")' },
            limit: { type: 'number', minimum: 1, maximum: 50, default: 10, description: 'Max results to return' },
          },
          required: ['query'],
        },
      },
      {
        name: 'mlx_download',
        description: 'Download an MLX model from Hugging Face Hub to local cache.',
        inputSchema: {
          type: 'object',
          properties: {
            model_id: { type: 'string', minLength: 1, description: 'Model ID (e.g., mlx-community/Llama-3.2-3B-4bit)' },
            quantization: { type: 'string', enum: ['4bit', '8bit'], description: 'Quantization level (optional)' },
          },
          required: ['model_id'],
        },
      },
      {
        name: 'mlx_list_local',
        description: 'List all MLX models downloaded to local cache. Shows model ID, size, and last used date.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'mlx_remove',
        description: 'Remove a downloaded model from local cache to free disk space.',
        inputSchema: {
          type: 'object',
          properties: {
            model_id: { type: 'string', minLength: 1, description: 'Model ID to remove' },
          },
          required: ['model_id'],
        },
      },
      {
        name: 'mlx_infer',
        description: 'Run inference on a local MLX model. Streams tokens as they are generated.',
        inputSchema: {
          type: 'object',
          properties: {
            model_id: { type: 'string', minLength: 1, description: 'Model ID (must be downloaded first)' },
            prompt: { type: 'string', minLength: 1, description: 'Input prompt for the model' },
            max_tokens: { type: 'number', minimum: 1, maximum: 4096, default: 256, description: 'Maximum tokens to generate' },
            temperature: { type: 'number', minimum: 0, maximum: 2, default: 0.7, description: 'Sampling temperature' },
          },
          required: ['model_id', 'prompt'],
        },
      },
    ],
  };
});

// Handle Tool Calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // TODO: Implement tool handlers
  return {
    content: [{ type: 'text', text: `Tool ${name} not yet implemented` }],
    isError: true,
  };
});

// Main
async function main() {
  console.error('mlx-hub MCP server running via stdio');
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});
