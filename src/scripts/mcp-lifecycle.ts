import path from 'path';
import os from 'os';
import fs from 'fs';

const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');

/**
 * Automatically ensures the agy-argon MCP server is registered in global mcp_config.json.
 */
export function ensureGlobalMcpConfig(distIndexPath: string): void {
  try {
    const configDir = path.dirname(GLOBAL_CONFIG_PATH);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    let config: { mcpServers: Record<string, any> } = { mcpServers: {} };
    if (fs.existsSync(GLOBAL_CONFIG_PATH)) {
      try {
        config = JSON.parse(fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf-8'));
      } catch {
        config = { mcpServers: {} };
      }
    }

    if (!config.mcpServers) {
      config.mcpServers = {};
    }

    // Normalize forward slashes for Windows compatibility
    const normalizedPath = distIndexPath.replace(/\\/g, '/');

    // Register or update agy-argon
    config.mcpServers['agy-argon'] = {
      command: 'node',
      args: [normalizedPath],
    };

    fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    console.log('[MCP Lifecycle] agy-argon server registered in global mcp_config.json');
  } catch (err) {
    console.error('[MCP Lifecycle] Failed to update global mcp_config.json:', err);
  }
}

/**
 * Automatically removes agy-argon MCP server from global mcp_config.json upon uninstall.
 */
export function removeGlobalMcpConfig(): void {
  try {
    if (!fs.existsSync(GLOBAL_CONFIG_PATH)) return;

    const raw = fs.readFileSync(GLOBAL_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw);

    if (config.mcpServers && config.mcpServers['agy-argon']) {
      delete config.mcpServers['agy-argon'];
      fs.writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
      console.log('[MCP Lifecycle] agy-argon server removed from global mcp_config.json');
    }
  } catch (err) {
    console.error('[MCP Lifecycle] Failed to remove agy-argon from global mcp_config.json:', err);
  }
}
