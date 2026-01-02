/**
 * Python Runner - executes mlx_runner.py commands and parses results.
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { getPythonPath } from './env-setup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PYTHON_SCRIPT = join(__dirname, '..', 'python', 'mlx_runner.py');

export interface PythonResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface StreamToken {
  type: 'token' | 'status' | 'done';
  content?: string;
  message?: string;
  tokens_generated?: number;
  tokens_per_sec?: number;
}

/**
 * Run a Python command and return the JSON result.
 */
export async function runPythonCommand(
  command: string,
  args: string[]
): Promise<PythonResult> {
  const pythonPath = await getPythonPath();
  return new Promise((resolve) => {
    const proc = spawn(pythonPath, [PYTHON_SCRIPT, command, ...args]);

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        try {
          const result = JSON.parse(stdout.trim().split('\n').pop() || '{}');
          resolve({ success: false, error: result.error || stderr || 'Unknown error' });
        } catch {
          resolve({ success: false, error: stderr || 'Unknown error' });
        }
        return;
      }

      try {
        // Get the last line of output (final result)
        const lines = stdout.trim().split('\n');
        const result = JSON.parse(lines[lines.length - 1]);

        if (result.error) {
          resolve({ success: false, error: result.error });
        } else {
          resolve({ success: true, data: result });
        }
      } catch (e) {
        resolve({ success: false, error: `Failed to parse output: ${stdout}` });
      }
    });

    proc.on('error', (error) => {
      resolve({ success: false, error: `Failed to spawn Python: ${error.message}` });
    });
  });
}

/**
 * Run inference with streaming output.
 * Calls the callback for each token/status update.
 */
export async function runInferenceStreaming(
  modelId: string,
  prompt: string,
  maxTokens: number,
  temperature: number,
  onToken: (token: StreamToken) => void,
  systemPrompt?: string
): Promise<PythonResult> {
  const pythonPath = await getPythonPath();
  return new Promise((resolve) => {
    const args = [
      PYTHON_SCRIPT,
      'infer',
      modelId,
      '--prompt', prompt,
      '--max-tokens', maxTokens.toString(),
      '--temperature', temperature.toString(),
    ];

    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    const proc = spawn(pythonPath, args);

    let buffer = '';
    let lastError = '';

    proc.stdout.on('data', (data) => {
      buffer += data.toString();

      // Process complete JSON lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as StreamToken;
          onToken(parsed);

          if (parsed.type === 'done') {
            resolve({ success: true, data: parsed });
          }
        } catch {
          // Ignore malformed lines
        }
      }
    });

    proc.stderr.on('data', (data) => {
      lastError += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({ success: false, error: lastError || 'Inference failed' });
      }
    });

    proc.on('error', (error) => {
      resolve({ success: false, error: `Failed to spawn Python: ${error.message}` });
    });
  });
}
