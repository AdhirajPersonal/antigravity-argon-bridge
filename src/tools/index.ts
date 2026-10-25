import { GeminiClient } from '../bridge/gemini-client.js';
import { SessionManager } from '../auth/session-manager.js';
import { UsageStore } from '../telemetry/usage-store.js';
import { ThinkingLevel, ThinkingModeSetting, getSettings, saveSettings } from '../config.js';

const geminiClient = new GeminiClient();
const sessionManager = new SessionManager();
const usageStore = new UsageStore();

export async function handleConsultArgon(args: {
  prompt: string;
  context?: string;
  thinking_level?: ThinkingLevel;
  continue_thread?: boolean;
  session_id?: string;
}) {
  const thinkingLevel: ThinkingLevel = args.thinking_level || 'high';
  const continueThread = args.continue_thread !== false;
  const sessionId = args.session_id || 'default';

  try {
    const result = await geminiClient.query(
      args.prompt,
      args.context,
      thinkingLevel,
      continueThread,
      sessionId
    );

    let output = result.response;
    if (result.thinkingProcess) {
      output = `> **[Argon Thinking Process]**\n> ${result.thinkingProcess.replace(/\n/g, '\n> ')}\n\n${output}`;
    }

    output += `\n\n---\n*Argon Telemetry: ~${result.estimatedTokens.total} tokens (in: ${result.estimatedTokens.input}, out: ${result.estimatedTokens.output}) | Account: ${result.accountEmail} | Thinking: ${result.thinkingLevel.toUpperCase()} | Session: ${sessionId}*`;

    return {
      content: [
        {
          type: 'text',
          text: output,
        },
      ],
    };
  } catch (err: any) {
    // If all accounts are rate-limited, provide actionable instruction to the AI agent
    if (err.message?.includes('[ALL_ACCOUNTS_EXHAUSTED]')) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `⚠️ **[ARGON QUOTA EXHAUSTED]**\n${err.message}\n\n**Action Required for Agent (Gemini 3.8):** All connected Google Pro accounts have temporarily reached their Argon limits. Do not retry calling consult_argon. Instead, use your own internal reasoning to answer the user's question, and advise the user of the upcoming quota reset time.`,
          },
        ],
      };
    }
    throw err;
  }
}

export async function handleResetThread(args: { session_id?: string }) {
  const sessionId = args.session_id || 'default';
  geminiClient.resetThread(sessionId);
  return {
    content: [
      {
        type: 'text',
        text: `Argon conversation thread for session "${sessionId}" has been reset. The next consultation will start in a clean new chat.`,
      },
    ],
  };
}

export async function handleSetSettings(args: { forced_thinking_level: ThinkingModeSetting }) {
  const current = getSettings();
  current.forcedThinkingLevel = args.forced_thinking_level;
  saveSettings(current);
  return {
    content: [
      {
        type: 'text',
        text: `Argon thinking mode updated to: "${args.forced_thinking_level.toUpperCase()}". ${
          args.forced_thinking_level === 'auto'
            ? 'The agent will decide thinking level dynamically based on complexity.'
            : `Locked as a hard limit: all consultations will use ${args.forced_thinking_level.toUpperCase()} thinking.`
        }`,
      },
    ],
  };
}

export async function handleGetSettings() {
  const settings = getSettings();
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(settings, null, 2),
      },
    ],
  };
}

export async function handleGetArgonUsage() {
  const activeAccount = sessionManager.getActiveAccount();
  if (!activeAccount) {
    return {
      content: [
        {
          type: 'text',
          text: 'No active Google account configured. Run "npm run cli login" or use the "argon_login" tool.',
        },
      ],
    };
  }

  const usageRecord = usageStore.getAccountUsage(activeAccount.id);
  let officialLimits = usageRecord.officialLimits;

  try {
    officialLimits = await geminiClient.getUsageLimits();
  } catch (err) {
    console.warn('[handleGetArgonUsage] Could not fetch live web limits:', err);
  }

  const m = usageRecord.metrics;
  const settings = getSettings();

  let report = `# Argon Usage & Quota Report\n\n`;
  report += `**Active Account:** ${activeAccount.email} (${activeAccount.plan})\n`;
  report += `**Account Status:** ${activeAccount.status.toUpperCase()}\n`;
  report += `**Thinking Mode Setting:** ${settings.forcedThinkingLevel.toUpperCase()}\n\n`;

  if (officialLimits) {
    report += `### Official Gemini Limits (from https://gemini.google.com/usage)\n`;
    report += `- **Current Usage:** ${officialLimits.currentUsagePercent}% used (Resets at: ${officialLimits.currentResetTime})\n`;
    report += `- **Weekly Limit:** ${officialLimits.weeklyLimitPercent}% used (Resets on: ${officialLimits.weeklyResetDate})\n`;
    report += `- **Last Synced:** ${new Date(officialLimits.lastUpdated).toLocaleTimeString()}\n\n`;
  }

  report += `### Local Token Telemetry (Calculated)\n`;
  report += `- **Today's Turns:** ${m.todayTurns}\n`;
  report += `- **Today's Estimated Tokens:** ~${m.todayInputTokens + m.todayOutputTokens} (Prompt: ${m.todayInputTokens}, Completion: ${m.todayOutputTokens})\n`;
  report += `- **All-Time Turns:** ${m.totalTurns}\n`;
  report += `- **All-Time Estimated Tokens:** ~${m.totalInputTokens + m.totalOutputTokens}\n`;

  return {
    content: [
      {
        type: 'text',
        text: report,
      },
    ],
  };
}

export async function handleListAccounts() {
  const accounts = sessionManager.listAccounts();
  if (accounts.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'No accounts registered yet. Use "argon_login" to add an account.',
        },
      ],
    };
  }

  let text = `# Registered Google Accounts (${accounts.length})\n\n`;
  for (const acc of accounts) {
    const activeBadge = acc.isActive ? ' **[ACTIVE]**' : '';
    const rateLimitBadge =
      acc.status === 'rate-limited' && acc.cooldownUntil
        ? ` *(Rate-Limited until ${new Date(acc.cooldownUntil).toLocaleTimeString()})*`
        : '';
    text += `- **${acc.email}** (${acc.alias}) - Plan: ${acc.plan} | ID: \`${acc.id}\`${activeBadge}${rateLimitBadge}\n`;
  }

  return {
    content: [{ type: 'text', text }],
  };
}

export async function handleSwitchAccount(args: { account_id: string }) {
  const success = sessionManager.switchAccount(args.account_id);
  if (!success) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Account "${args.account_id}" not found. Use "argon_list_accounts" to view registered accounts.`,
        },
      ],
    };
  }

  await geminiClient.close();
  const current = sessionManager.getActiveAccount();
  return {
    content: [
      {
        type: 'text',
        text: `Switched active account to: ${current?.email} (${current?.alias})`,
      },
    ],
  };
}

export async function handleLogin(args: { alias?: string }) {
  try {
    const acc = await sessionManager.loginInteractive(args.alias);
    await geminiClient.close();
    return {
      content: [
        {
          type: 'text',
          text: `Successfully logged in as ${acc.email} (${acc.plan}). Account is now ACTIVE for Argon MCP.`,
        },
      ],
    };
  } catch (err: any) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Login failed: ${err.message}`,
        },
      ],
    };
  }
}

export async function handleLogout(args: { account_id: string }) {
  const success = sessionManager.logout(args.account_id);
  await geminiClient.close();
  return {
    content: [
      {
        type: 'text',
        text: success
          ? `Account "${args.account_id}" removed and logged out successfully.`
          : `Account "${args.account_id}" was not found.`,
      },
    ],
  };
}
