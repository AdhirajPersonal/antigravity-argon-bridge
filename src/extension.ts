import * as vscode from 'vscode';
import path from 'path';
import fs from 'fs';
import { SessionManager } from './auth/session-manager.js';
import { GeminiClient } from './bridge/gemini-client.js';
import { UsageStore } from './telemetry/usage-store.js';
import { ThreadStore } from './telemetry/thread-store.js';
import { ArgonSidebarProvider } from './webview/sidebar-provider.js';
import { getSettings, saveSettings, ThinkingModeSetting, BASE_DATA_DIR, getBrowserStatus } from './config.js';
import { ensureGlobalMcpConfig, removeGlobalMcpConfig } from './scripts/mcp-lifecycle.js';

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  console.log('[AGY Argon Extension] Activating Argon Bridge Extension...');

  // Automatically register & sync MCP server in global mcp_config.json
  const distIndexPath = path.join(context.extensionPath, 'dist', 'index.js');
  ensureGlobalMcpConfig(distIndexPath);

  const sessionManager = new SessionManager();
  const geminiClient = new GeminiClient();
  const usageStore = new UsageStore();
  const threadStore = new ThreadStore();

  // Status Bar Item in IDE bottom bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'agy-argon.openPanel';
  context.subscriptions.push(statusBarItem);

  const updateStatusBar = () => {
    const active = sessionManager.getActiveAccount();
    if (!active) {
      statusBarItem.text = `$(account) Argon: Offline`;
      statusBarItem.tooltip = 'Argon Bridge: No account connected. Click to log in.';
      statusBarItem.show();
      return;
    }

    const usage = usageStore.getAccountUsage(active.id);
    const percent = usage.officialLimits?.currentUsagePercent ?? 0;
    const settings = getSettings();
    const modeTag = settings.forcedThinkingLevel !== 'auto' ? ` [${settings.forcedThinkingLevel.toUpperCase()}]` : '';

    if (active.status === 'rate-limited') {
      statusBarItem.text = `$(warning) Argon: Limit Reached${modeTag}`;
      statusBarItem.tooltip = `Argon: Rate limit reached. Click to switch account or check reset time.`;
    } else {
      statusBarItem.text = `$(sparkle) Argon: ${active.plan} (${percent}%)${modeTag}`;
      statusBarItem.tooltip = `Argon Model Bridge: Active (${active.email})\nCurrent Usage: ${percent}%\nClick to open Control Panel`;
    }
    statusBarItem.show();
  };

  updateStatusBar();

  // Register Webview Sidebar View
  const sidebarProvider = new ArgonSidebarProvider(
    context.extensionUri,
    sessionManager,
    geminiClient,
    usageStore,
    threadStore,
    () => updateStatusBar()
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ArgonSidebarProvider.viewType,
      sidebarProvider,
      {
        webviewOptions: { retainContextWhenHidden: true },
      }
    )
  );

  // Real-Time Sync: Watch for changes in usage.json, accounts.json, and settings.json
  // Ensures any background MCP tool call or CLI command immediately updates the UI live without reload
  let debounceSyncTimer: NodeJS.Timeout | undefined;
  try {
    if (fs.existsSync(BASE_DATA_DIR)) {
      const dirWatcher = fs.watch(BASE_DATA_DIR, (_eventType, filename) => {
        if (filename && filename.endsWith('.json')) {
          if (debounceSyncTimer) clearTimeout(debounceSyncTimer);
          debounceSyncTimer = setTimeout(() => {
            updateStatusBar();
            sidebarProvider.syncState(false);
          }, 250);
        }
      });
      context.subscriptions.push({ dispose: () => dirWatcher.close() });
    }
  } catch (err) {
    console.error('[AGY Argon] Live watcher initialization error:', err);
  }

  // Command: Open Control Panel
  context.subscriptions.push(
    vscode.commands.registerCommand('agy-argon.openPanel', () => {
      vscode.commands.executeCommand('workbench.view.extension.agy-argon-sidebar');
    })
  );

  // Command: Reset Thread
  context.subscriptions.push(
    vscode.commands.registerCommand('agy-argon.resetThread', () => {
      const sessionId = vscode.workspace.name || 'default';
      geminiClient.resetThread(sessionId);
      sidebarProvider.syncState(false);
      vscode.window.showInformationMessage(`Argon: Conversation thread for "${sessionId}" reset.`);
    })
  );

  // Command: Add Account
  context.subscriptions.push(
    vscode.commands.registerCommand('agy-argon.login', async () => {
      const alias = await vscode.window.showInputBox({
        prompt: 'Enter an alias for this Google Account (optional)',
        placeHolder: 'e.g., Work Pro, Jio Offer Account',
      });

      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Argon: Opening Google Login window in browser...',
          cancellable: false,
        },
        async () => {
          try {
            const acc = await sessionManager.loginInteractive(alias);
            await geminiClient.close();
            updateStatusBar();
            sidebarProvider.syncState(true);
            vscode.window.showInformationMessage(`Argon: Connected ${acc.email} (${acc.plan})`);
          } catch (err: any) {
            const message: string = err?.message || String(err);
            // Playwright browser missing or version-drifted after an extension
            // update: offer the one-click download instead of a dead-end error.
            if (/Executable doesn't exist|Argon requires a Playwright Chromium download/i.test(message)) {
              const action = await vscode.window.showErrorMessage(
                'Argon Login failed: the Playwright Chromium download is missing (it is not bundled with the extension).',
                'Download Chromium'
              );
              if (action === 'Download Chromium') {
                await vscode.commands.executeCommand('agy-argon.installBrowser');
              }
              return;
            }
            vscode.window.showErrorMessage(`Argon Login failed: ${message}`);
          }
        }
      );
    })
  );

  // Command: Switch Account QuickPick
  context.subscriptions.push(
    vscode.commands.registerCommand('agy-argon.switchAccount', async () => {
      const accounts = sessionManager.listAccounts();
      if (accounts.length === 0) {
        vscode.window.showInformationMessage('No accounts registered yet. Run "Argon: Add Google Account".');
        return;
      }

      const items = accounts.map((acc) => ({
        label: acc.email,
        description: `${acc.alias} (${acc.plan})`,
        detail: acc.isActive ? 'Current Active Account' : undefined,
        id: acc.id,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select active Google Account for Argon',
      });

      if (selected) {
        sessionManager.switchAccount(selected.id);
        await geminiClient.close();
        updateStatusBar();
        sidebarProvider.syncState(false);
        vscode.window.setStatusBarMessage(`Switched active account to ${selected.label}`, 3000);
      }
    })
  );

  // Command: Set Thinking Mode QuickPick
  context.subscriptions.push(
    vscode.commands.registerCommand('agy-argon.setThinkingLevel', async () => {
      const current = getSettings().forcedThinkingLevel;
      const options = [
        { label: 'Auto (Recommended)', description: 'Agent dynamically decides thinking depth based on complexity', value: 'auto' },
        { label: 'Low', description: 'Fast and efficient (best for quick checks)', value: 'low' },
        { label: 'Medium', description: 'Balanced depth (best for reviews)', value: 'medium' },
        { label: 'High', description: 'Extra thorough (best for architecture and proofs)', value: 'high' },
      ];

      const selected = await vscode.window.showQuickPick(options, {
        placeHolder: `Current Thinking Mode: ${current.toUpperCase()}`,
      });

      if (selected) {
        const settings = getSettings();
        settings.forcedThinkingLevel = selected.value as ThinkingModeSetting;
        saveSettings(settings);
        updateStatusBar();
        sidebarProvider.syncState(false);
        vscode.window.setStatusBarMessage(`Argon Thinking Mode: ${selected.label}`, 3000);
      }
    })
  );

  // Command: Refresh Quota
  context.subscriptions.push(
    vscode.commands.registerCommand('agy-argon.refreshQuota', async () => {
      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: 'Refreshing Argon live limits...',
        },
        async () => {
          try {
            await geminiClient.getUsageLimits();
            await geminiClient.close();
            updateStatusBar();
            sidebarProvider.syncState(false);
            vscode.window.setStatusBarMessage('Argon quota limits refreshed.', 3000);
          } catch (err: any) {
            vscode.window.showErrorMessage(`Could not refresh Argon limits: ${err.message}`);
          }
        }
      );
    })
  );

  // Command: Install / Repair the Playwright Chromium browser.
  // The browser is not shipped in the VSIX and is pinned to the exact revision
  // required by the bundled playwright-core, so it must be downloaded once per
  // Playwright version (fresh install or extension upgrade).
  context.subscriptions.push(
    vscode.commands.registerCommand('agy-argon.installBrowser', async () => {
      const status = getBrowserStatus(false);
      if (status.installed) {
        vscode.window.showInformationMessage('Argon: Playwright Chromium is already installed.');
        return;
      }

      const cliPath = path.join(context.extensionPath, 'node_modules', 'playwright-core', 'cli.js');
      if (!fs.existsSync(cliPath)) {
        vscode.window.showErrorMessage(
          `Argon: Cannot find the bundled Playwright CLI at ${cliPath}. Reinstall the extension.`
        );
        return;
      }

      const terminal = vscode.window.createTerminal({ name: 'Argon: Install Chromium' });
      terminal.show();
      // Quote both paths: the extension directory often contains spaces
      // (e.g. "~/Library/Application Support/...").
      terminal.sendText(
        `"${process.execPath}" "${cliPath}" install chromium; echo "\\n[Argon] Chromium download finished. Now run: Argon: Add Google Account"`
      );

      const answer = await vscode.window.showInformationMessage(
        'Argon: downloading Playwright Chromium in the terminal (approx. 150 MB, one-off). Run "Argon: Add Google Account" once it completes.',
        'Re-check now'
      );
      if (answer === 'Re-check now') {
        if (getBrowserStatus(false).installed) {
          vscode.window.showInformationMessage(
            'Argon: Chromium installed. You can now run "Argon: Add Google Account".'
          );
        } else {
          vscode.window.showWarningMessage(
            'Argon: Chromium is not installed yet — waiting for the terminal download to finish.'
          );
        }
      }
    })
  );

  // Command: Remove MCP Registration (Manual cleanup if needed)
  context.subscriptions.push(
    vscode.commands.registerCommand('agy-argon.removeMCP', () => {
      removeGlobalMcpConfig();
      vscode.window.showInformationMessage('Argon: Removed MCP server from global configuration.');
    })
  );
}

export function deactivate() {
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}
