// Redirect console.log to console.error to keep stdout pure JSON-RPC for MCP transport
console.log = (...args: any[]) => console.error(...args);

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  handleConsultArgon,
  handleResetThread,
  handleGetArgonUsage,
} from './tools/index.js';

const server = new Server(
  {
    name: 'agy-argon-bridge',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Register list of tools (Strictly agent-facing; administrative actions like login/logout/switch belong to the Human UI)
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'consult_argon',
        description:
          'Consults Google Gemini Web 4 Argon reasoning model for deep architectural design, complex algorithmic proofs, subtle bug diagnosis, or qualitative code analysis. Automatically handles multi-account failover if quota is reached, and maintains persistent conversation thread memory across days.',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'The core question, problem statement, or code review request for Argon.',
            },
            context: {
              type: 'string',
              description:
                'Optional background information, relevant source code files, diffs, or API references.',
            },
            thinking_level: {
              type: 'string',
              enum: ['low', 'medium', 'high'],
              description:
                'Desired thinking depth setting: "low" (fastest), "medium" (balanced), "high" (extra thorough reasoning). Ignored if the user has configured a hard override setting.',
            },
            continue_thread: {
              type: 'boolean',
              description:
                'Whether to continue the current multi-turn conversation thread (so Argon remembers previous turns in this project). Defaults to true.',
            },
            session_id: {
              type: 'string',
              description:
                'Unique identifier for the project or conversation session (e.g. workspace path or Antigravity conversation ID) to persist multi-day thread memory. Defaults to "default".',
            },
          },
          required: ['prompt'],
        },
      },
      {
        name: 'get_argon_usage',
        description:
          'Retrieves live usage limits from gemini.google.com/usage (Current % used, Weekly limit %, reset timestamps) plus local token metrics (today/all-time input and output tokens) and thinking settings.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'reset_argon_thread',
        description:
          'Resets the active conversation thread for a project/session so the next Argon consultation starts with a clean slate.',
        inputSchema: {
          type: 'object',
          properties: {
            session_id: {
              type: 'string',
              description: 'The project/session ID to reset. Defaults to "default".',
            },
          },
        },
      },
    ],
  };
});

// Dispatch tool executions
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'consult_argon':
        return await handleConsultArgon(args as any);
      case 'reset_argon_thread':
        return await handleResetThread(args as any);
      case 'get_argon_usage':
        return await handleGetArgonUsage();
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err: any) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `[Argon MCP Error] ${err.message || String(err)}`,
        },
      ],
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[AGY Argon Bridge] MCP Server running on Stdio');
}

main().catch((err) => {
  console.error('[AGY Argon Bridge] Fatal error:', err);
  process.exit(1);
});
