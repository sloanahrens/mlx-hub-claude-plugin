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
  InfoInputSchema,
} from './types.js';
import {
  runPythonCommand,
  runInferenceStreaming,
  StreamToken,
} from './python-runner.js';

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
      {
        name: 'mlx_info',
        description: 'Get detailed information about an MLX model from Hugging Face Hub. Shows parameters, context length, quantization, and local status.',
        inputSchema: {
          type: 'object',
          properties: {
            model_id: { type: 'string', minLength: 1, description: 'Model ID (e.g., mlx-community/Llama-3.2-3B-Instruct-4bit)' },
          },
          required: ['model_id'],
        },
      },
    ],
  };
});

// Handle Tool Calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    if (name === 'mlx_search') {
      const params = SearchInputSchema.parse(args);
      const result = await runPythonCommand('search', [
        params.query,
        '--limit', params.limit.toString(),
      ]);

      if (!result.success) {
        return {
          content: [{ type: 'text', text: `Error: ${result.error}` }],
          isError: true,
        };
      }

      const data = result.data as { results: Array<{ model_id: string; downloads: number; likes: number }> };
      const formatted = data.results
        .map((m, i) => `${i + 1}. ${m.model_id} (${m.downloads.toLocaleString()} downloads, ${m.likes} likes)`)
        .join('\n');

      return {
        content: [{ type: 'text', text: `Found ${data.results.length} MLX-compatible models:\n\n${formatted}` }],
      };
    }

    if (name === 'mlx_download') {
      const params = DownloadInputSchema.parse(args);
      const cmdArgs = [params.model_id];
      if (params.quantization) {
        cmdArgs.push('--quantize', params.quantization);
      }

      const result = await runPythonCommand('download', cmdArgs);

      if (!result.success) {
        return {
          content: [{ type: 'text', text: `Error: ${result.error}` }],
          isError: true,
        };
      }

      // Handle new format with type: "complete" or legacy format
      const data = result.data as {
        type?: string;
        status?: string;
        model_id: string;
        path: string;
        size_bytes?: number;
        size_human: string;
      };

      return {
        content: [{ type: 'text', text: `Downloaded ${data.model_id}\nSize: ${data.size_human}\nPath: ${data.path}` }],
      };
    }

    if (name === 'mlx_list_local') {
      ListInputSchema.parse(args);
      const result = await runPythonCommand('list', []);

      if (!result.success) {
        return {
          content: [{ type: 'text', text: `Error: ${result.error}` }],
          isError: true,
        };
      }

      const data = result.data as { models: Array<{ model_id: string; size_human: string; last_modified: string }> };

      if (data.models.length === 0) {
        return {
          content: [{ type: 'text', text: 'No MLX models found locally. Use mlx_search and mlx_download to get started.' }],
        };
      }

      const formatted = data.models
        .map((m) => `- ${m.model_id} (${m.size_human}, last used: ${new Date(m.last_modified).toLocaleDateString()})`)
        .join('\n');

      return {
        content: [{ type: 'text', text: `Local MLX models:\n\n${formatted}` }],
      };
    }

    if (name === 'mlx_remove') {
      const params = RemoveInputSchema.parse(args);
      const result = await runPythonCommand('remove', [params.model_id]);

      if (!result.success) {
        return {
          content: [{ type: 'text', text: `Error: ${result.error}` }],
          isError: true,
        };
      }

      const data = result.data as { model_id: string; freed_human: string };
      return {
        content: [{ type: 'text', text: `Removed ${data.model_id}\nFreed: ${data.freed_human}` }],
      };
    }

    if (name === 'mlx_infer') {
      const params = InferInputSchema.parse(args);

      let output = '';
      const result = await runInferenceStreaming(
        params.model_id,
        params.prompt,
        params.max_tokens,
        params.temperature,
        (token: StreamToken) => {
          if (token.type === 'token' && token.content) {
            output += token.content;
          }
        }
      );

      if (!result.success) {
        return {
          content: [{ type: 'text', text: `Error: ${result.error}` }],
          isError: true,
        };
      }

      const data = result.data as { tokens_generated: number; tokens_per_sec: number };
      return {
        content: [{
          type: 'text',
          text: `${output}\n\n---\n${data.tokens_generated} tokens @ ${data.tokens_per_sec} tok/s`
        }],
      };
    }

    if (name === 'mlx_info') {
      const params = InfoInputSchema.parse(args);
      const result = await runPythonCommand('info', [params.model_id]);

      if (!result.success) {
        return {
          content: [{ type: 'text', text: `Error: ${result.error}` }],
          isError: true,
        };
      }

      const data = result.data as {
        model_id: string;
        downloads: number;
        likes: number;
        context_length?: number;
        params_human?: string;
        quantization?: string;
        quantization_bits?: number;
        is_local: boolean;
        local_size_human?: string;
        pipeline_tag?: string;
      };

      // Format the output nicely
      const lines = [
        `Model: ${data.model_id}`,
        data.params_human ? `Parameters: ${data.params_human}${data.quantization_bits ? ` (${data.quantization_bits}-bit)` : ''}` : null,
        data.context_length ? `Context: ${data.context_length.toLocaleString()} tokens` : null,
        data.pipeline_tag ? `Type: ${data.pipeline_tag}` : null,
        `Downloads: ${data.downloads.toLocaleString()}`,
        `Likes: ${data.likes}`,
        `Local: ${data.is_local ? `Yes (${data.local_size_human})` : 'No'}`,
      ].filter(Boolean);

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
      };
    }

    return {
      content: [{ type: 'text', text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
      isError: true,
    };
  }
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
