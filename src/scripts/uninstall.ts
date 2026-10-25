import { removeGlobalMcpConfig } from './mcp-lifecycle.js';

console.log('[Antigravity Argon] Running extension uninstall hook...');
removeGlobalMcpConfig();
console.log('[Antigravity Argon] Cleaned up MCP server configuration.');
