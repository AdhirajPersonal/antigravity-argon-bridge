#!/usr/bin/env node

import { Command } from 'commander';
import { SessionManager } from '../auth/session-manager.js';
import { GeminiClient } from '../bridge/gemini-client.js';
import { UsageStore } from '../telemetry/usage-store.js';
import { ThinkingLevel, ThinkingModeSetting, getSettings, saveSettings } from '../config.js';
import { TerminalFormatter, ANSI } from '../utils/terminal-formatter.js';

const program = new Command();
const sessionManager = new SessionManager();
const usageStore = new UsageStore();
const geminiClient = new GeminiClient();

program
  .name('agy-argon')
  .description('AGY Argon Bridge & Multi-Account Manager CLI')
  .version('1.0.0');

// Login command
program
  .command('login')
  .description('Open interactive browser to sign into Google / Gemini Pro account')
  .option('-a, --alias <name>', 'Account display name / alias')
  .action(async (options) => {
    try {
      console.log(`\n${ANSI.bold}${ANSI.brightCyan}🔐 Google Sign-In (Interactive)${ANSI.reset}`);
      console.log(`${ANSI.dim}An isolated Chromium browser window will open. Complete login at gemini.google.com/app.${ANSI.reset}\n`);
      const account = await sessionManager.loginInteractive(options.alias);
      console.log(`\n${ANSI.bold}${ANSI.brightGreen}✓ SUCCESS: Logged in as ${account.email} (${account.plan})${ANSI.reset}`);
      console.log(`${ANSI.dim}Account ID: ${account.id} is now ACTIVE.${ANSI.reset}\n`);
      process.exit(0);
    } catch (err: any) {
      console.error(`\n${ANSI.brightRed}✗ Login failed: ${err.message}${ANSI.reset}\n`);
      process.exit(1);
    }
  });

// Status command
program
  .command('status')
  .description('Check active account, official Gemini Web limits, and local token metrics')
  .action(async () => {
    const active = sessionManager.getActiveAccount();
    if (!active) {
      console.log(`${ANSI.yellow}No active account found. Run "agy-argon login" first.${ANSI.reset}`);
      process.exit(0);
    }

    const settings = getSettings();
    console.log(`\n${ANSI.bold}${ANSI.brightCyan}╔══════════════════════════════════════════════════════════════╗${ANSI.reset}`);
    console.log(`${ANSI.bold}${ANSI.brightCyan}║              AGY ARGON BRIDGE: SYSTEM STATUS                 ║${ANSI.reset}`);
    console.log(`${ANSI.bold}${ANSI.brightCyan}╚══════════════════════════════════════════════════════════════╝${ANSI.reset}`);
    console.log(`  ${ANSI.bold}Active Account:${ANSI.reset}        ${ANSI.brightWhite}${active.email}${ANSI.reset} (${ANSI.dim}${active.alias}${ANSI.reset})`);
    console.log(`  ${ANSI.bold}Plan:${ANSI.reset}                  ${ANSI.brightGreen}${active.plan}${ANSI.reset}`);
    console.log(`  ${ANSI.bold}Status:${ANSI.reset}                ${active.status === 'active' ? ANSI.green : ANSI.red}${active.status.toUpperCase()}${ANSI.reset}`);
    console.log(`  ${ANSI.bold}Thinking Override:${ANSI.reset}     ${ANSI.yellow}${settings.forcedThinkingLevel.toUpperCase()}${ANSI.reset}`);

    try {
      console.log(`\n${ANSI.dim}Fetching live usage limits from gemini.google.com/usage...${ANSI.reset}`);
      const limits = await geminiClient.getUsageLimits();
      await geminiClient.close();

      console.log(`\n${ANSI.bold}${ANSI.brightCyan}📈 Official Gemini Limits (gemini.google.com/usage)${ANSI.reset}`);
      console.log(`  ${ANSI.dim}Current Usage:${ANSI.reset}         ${ANSI.brightWhite}${limits.currentUsagePercent}% used${ANSI.reset} (Resets at: ${limits.currentResetTime})`);
      console.log(`  ${ANSI.dim}Weekly Limit:${ANSI.reset}          ${ANSI.brightWhite}${limits.weeklyLimitPercent}% used${ANSI.reset} (Resets on: ${limits.weeklyResetDate})`);
      console.log(`  ${ANSI.dim}Last Checked:${ANSI.reset}          ${new Date(limits.lastUpdated).toLocaleTimeString()}`);
    } catch (err: any) {
      console.log(`\n${ANSI.yellow}Could not fetch live web limits: ${err.message}${ANSI.reset}`);
    }

    const usage = usageStore.getAccountUsage(active.id);
    const m = usage.metrics;
    console.log(`\n${ANSI.bold}${ANSI.brightCyan}🔢 Local Token Telemetry${ANSI.reset}`);
    console.log(`  ${ANSI.dim}Today's Turns:${ANSI.reset}         ${m.todayTurns}`);
    console.log(`  ${ANSI.dim}Today's Tokens:${ANSI.reset}        ~${m.todayInputTokens + m.todayOutputTokens} (Prompt: ${m.todayInputTokens}, Completion: ${m.todayOutputTokens})`);
    console.log(`  ${ANSI.dim}Lifetime Turns:${ANSI.reset}        ${m.totalTurns}`);
    console.log(`  ${ANSI.dim}Lifetime Tokens:${ANSI.reset}       ~${m.totalInputTokens + m.totalOutputTokens}`);
    console.log(`${ANSI.dim}────────────────────────────────────────────────────────────────${ANSI.reset}\n`);
    process.exit(0);
  });

// Config command
program
  .command('config')
  .description('View or update settings (e.g. lock a hard thinking mode limit)')
  .option('-t, --thinking <level>', 'Thinking mode: auto, low, medium, high')
  .action((options) => {
    const current = getSettings();
    if (options.thinking) {
      const val = options.thinking.toLowerCase() as ThinkingModeSetting;
      if (!['auto', 'low', 'medium', 'high'].includes(val)) {
        console.error(`${ANSI.brightRed}Invalid thinking level. Options: auto, low, medium, high${ANSI.reset}`);
        process.exit(1);
      }
      current.forcedThinkingLevel = val;
      saveSettings(current);
      console.log(`${ANSI.bold}${ANSI.brightGreen}✓ Settings updated:${ANSI.reset} Thinking mode is now ${ANSI.yellow}${val.toUpperCase()}${ANSI.reset}`);
      if (val === 'auto') {
        console.log(`${ANSI.dim}The agent will pick thinking depth dynamically based on task complexity.${ANSI.reset}`);
      } else {
        console.log(`${ANSI.dim}Hard limit active: all consultations will use ${val.toUpperCase()} thinking.${ANSI.reset}`);
      }
    } else {
      console.log(`\n${ANSI.bold}${ANSI.brightCyan}Current Configuration:${ANSI.reset}`);
      console.log(`  Thinking Mode: ${ANSI.yellow}${current.forcedThinkingLevel.toUpperCase()}${ANSI.reset}`);
      console.log(`\n${ANSI.dim}To change: agy-argon config --thinking <auto|low|medium|high>${ANSI.reset}\n`);
    }
    process.exit(0);
  });

// Accounts command
program
  .command('accounts')
  .description('List all registered Google accounts')
  .action(() => {
    const accounts = sessionManager.listAccounts();
    if (accounts.length === 0) {
      console.log(`${ANSI.yellow}No accounts found. Use "agy-argon login" to add an account.${ANSI.reset}`);
      process.exit(0);
    }

    console.log(`\n${ANSI.bold}${ANSI.brightCyan}👥 Registered Google Accounts (${accounts.length}):${ANSI.reset}`);
    for (const acc of accounts) {
      const activeMark = acc.isActive ? ` ${ANSI.bold}${ANSI.brightGreen}[ACTIVE]${ANSI.reset}` : '';
      const rateLimitMark = acc.status === 'rate-limited' && acc.cooldownUntil
        ? ` ${ANSI.brightRed}(Rate-Limited until ${new Date(acc.cooldownUntil).toLocaleTimeString()})${ANSI.reset}`
        : '';
      console.log(`  • ${ANSI.brightWhite}${acc.email}${ANSI.reset} | Alias: "${acc.alias}" | Plan: ${acc.plan} | ID: \`${acc.id}\`${activeMark}${rateLimitMark}`);
    }
    console.log('');
    process.exit(0);
  });

// Switch command
program
  .command('switch <accountId>')
  .description('Switch the active Google account')
  .action((accountId) => {
    const success = sessionManager.switchAccount(accountId);
    if (success) {
      const current = sessionManager.getActiveAccount();
      console.log(`${ANSI.green}✓ Active account switched to:${ANSI.reset} ${current?.email} (${current?.id})`);
    } else {
      console.error(`${ANSI.red}✗ Account "${accountId}" not found. Run "agy-argon accounts" to list available accounts.${ANSI.reset}`);
      process.exit(1);
    }
  });

// Logout command
program
  .command('logout <accountId>')
  .description('Remove an account profile and clear session data')
  .action((accountId) => {
    const success = sessionManager.logout(accountId);
    if (success) {
      console.log(`${ANSI.green}✓ Account "${accountId}" removed successfully.${ANSI.reset}`);
    } else {
      console.error(`${ANSI.red}✗ Account "${accountId}" not found.${ANSI.reset}`);
      process.exit(1);
    }
  });

// Ask command
program
  .command('ask <prompt>')
  .description('Send a query to 4 Argon and print the formatted response')
  .option('-c, --context <text>', 'Additional context')
  .option('-t, --thinking <level>', 'Thinking depth: low, medium, high', 'high')
  .option('-n, --new', 'Start a fresh conversation thread instead of continuing')
  .option('-s, --session <id>', 'Session identifier for project thread continuity', 'cli-default')
  .action(async (prompt, options) => {
    try {
      const thinking = (options.thinking as ThinkingLevel) || 'high';
      const continueThread = !options.new;
      const sessionId = options.session || 'cli-default';

      console.log(`\n${ANSI.bold}${ANSI.brightCyan}🚀 4 Argon Consultation${ANSI.reset}`);
      console.log(`  ${ANSI.dim}Model:${ANSI.reset}          4 Argon (Thinking: ${thinking.toUpperCase()})`);
      console.log(`  ${ANSI.dim}Thread:${ANSI.reset}         ${continueThread ? 'Continuing existing thread' : 'Starting fresh thread'}`);
      console.log(`  ${ANSI.dim}Session ID:${ANSI.reset}     ${sessionId}\n`);

      const result = await geminiClient.query(prompt, options.context, thinking, continueThread, sessionId);
      await geminiClient.close();

      // Render Thinking Process
      if (result.thinkingProcess) {
        console.log(`\n${ANSI.bold}${ANSI.brightMagenta}🧠 ARGON THINKING BREAKDOWN${ANSI.reset}`);
        console.log(`${ANSI.dim}────────────────────────────────────────────────────────────────${ANSI.reset}`);
        console.log(ANSI.dim + result.thinkingProcess + ANSI.reset);
        console.log(`${ANSI.dim}────────────────────────────────────────────────────────────────${ANSI.reset}\n`);
      }

      // Render Formatted Response
      console.log(`\n${ANSI.bold}${ANSI.brightCyan}✨ 4 ARGON RESPONSE${ANSI.reset}`);
      console.log(`${ANSI.dim}────────────────────────────────────────────────────────────────${ANSI.reset}`);
      console.log(TerminalFormatter.formatMarkdown(result.response));

      // Render Telemetry Card
      console.log(
        TerminalFormatter.renderTelemetryCard({
          tokens: result.estimatedTokens,
          accountEmail: result.accountEmail,
          thinkingLevel: result.thinkingLevel,
          threadUrl: result.threadUrl,
        })
      );

      process.exit(0);
    } catch (err: any) {
      await geminiClient.close().catch(() => {});
      console.error(`\n${ANSI.brightRed}✗ Query failed: ${err.message}${ANSI.reset}\n`);
      process.exit(1);
    }
  });

program.parse(process.argv);
