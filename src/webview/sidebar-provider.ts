import * as vscode from 'vscode';
import { SessionManager } from '../auth/session-manager.js';
import { GeminiClient } from '../bridge/gemini-client.js';
import { UsageStore } from '../telemetry/usage-store.js';
import { ThreadStore } from '../telemetry/thread-store.js';
import { getSettings, saveSettings, ThinkingModeSetting } from '../config.js';

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export class ArgonSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'agy-argon.mainView';
  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly sessionManager: SessionManager,
    private readonly geminiClient: GeminiClient,
    private readonly usageStore: UsageStore,
    private readonly threadStore: ThreadStore,
    private readonly onStateChanged?: () => void
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      try {
        switch (data.type) {
          case 'ready': {
            await this.syncState(false);
            break;
          }
          case 'refresh': {
            await this.syncState(true);
            break;
          }
          case 'switchAccount': {
            this.sessionManager.switchAccount(data.accountId);
            await this.geminiClient.close();
            vscode.window.setStatusBarMessage(`Switched active account to ${data.accountId}`, 3000);
            this.notifyStateChanged();
            await this.syncState(false);
            const usage = this.usageStore.getAccountUsage(data.accountId);
            if (!usage.officialLimits || usage.officialLimits.currentResetTime === 'Unknown') {
              this.syncState(true);
            }
            break;
          }
          case 'login': {
            vscode.window.withProgress(
              {
                location: vscode.ProgressLocation.Notification,
                title: 'Argon: Opening Google Login window...',
                cancellable: false,
              },
              async () => {
                try {
                  const acc = await this.sessionManager.loginInteractive(data.alias);
                  await this.geminiClient.close();
                  vscode.window.showInformationMessage(`Argon: Successfully connected ${acc.email} (${acc.plan})`);
                  this.notifyStateChanged();
                  await this.syncState(true);
                } catch (err: any) {
                  vscode.window.showErrorMessage(`Argon Login failed: ${err.message}`);
                }
              }
            );
            break;
          }
          case 'relogin': {
            vscode.window.withProgress(
              {
                location: vscode.ProgressLocation.Notification,
                title: 'Argon: Re-authenticating Google account...',
                cancellable: false,
              },
              async () => {
                try {
                  const acc = await this.sessionManager.reloginInteractive(data.accountId);
                  await this.geminiClient.close();
                  vscode.window.showInformationMessage(`Argon: Successfully re-authenticated ${acc.email} (${acc.plan})`);
                  this.notifyStateChanged();
                  await this.syncState(true);
                } catch (err: any) {
                  vscode.window.showErrorMessage(`Argon Re-login failed: ${err.message}`);
                }
              }
            );
            break;
          }
          case 'logout': {
            const confirm = await vscode.window.showWarningMessage(
              `Remove account "${data.accountId}"?`,
              { modal: true },
              'Remove'
            );
            if (confirm === 'Remove') {
              this.sessionManager.logout(data.accountId);
              await this.geminiClient.close();
              this.notifyStateChanged();
              await this.syncState(false);
            }
            break;
          }
          case 'resetThread': {
            const workspaceSession = vscode.workspace.name || 'default';
            const recent = this.threadStore.getMostRecentThread();
            const targetSession = this.threadStore.getThread(workspaceSession)
              ? workspaceSession
              : recent?.sessionId || workspaceSession;
            this.geminiClient.resetThread(targetSession);
            vscode.window.showInformationMessage(`Argon: Conversation thread for "${targetSession}" reset.`);
            await this.syncState(false);
            break;
          }
          case 'setThinkingMode': {
            const settings = getSettings();
            settings.forcedThinkingLevel = data.mode as ThinkingModeSetting;
            saveSettings(settings);
            vscode.window.setStatusBarMessage(`Argon Thinking Mode: ${data.mode.toUpperCase()}`, 3000);
            this.notifyStateChanged();
            await this.syncState(false);
            break;
          }
          case 'askQuery': {
            this._handleQuery(data.prompt, data.thinkingLevel);
            break;
          }
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(`Argon Error: ${err.message}`);
      }
    });

    this.syncState(false);
    setTimeout(() => {
      const active = this.sessionManager.getActiveAccount();
      if (active) {
        const usage = this.usageStore.getAccountUsage(active.id);
        if (!usage.officialLimits || usage.officialLimits.currentResetTime === 'Unknown') {
          this.syncState(true);
          return;
        }
      }
      this.syncState(false);
    }, 400);
  }

  private notifyStateChanged() {
    if (this.onStateChanged) {
      this.onStateChanged();
    }
  }

  public async syncState(fetchLiveLimits: boolean = false) {
    if (!this._view) return;

    const active = this.sessionManager.getActiveAccount();
    const accounts = this.sessionManager.listAccounts();
    const settings = getSettings();
    const sessionId = vscode.workspace.name || 'default';
    const thread = active ? this.threadStore.getThread(sessionId, active.id) : undefined;

    let officialLimits = undefined;
    let localMetrics = {
      todayTurns: 0,
      todayTokens: 0,
      totalTurns: 0,
      totalTokens: 0,
    };

    if (active) {
      const usage = this.usageStore.getAccountUsage(active.id);
      officialLimits = usage.officialLimits;
      localMetrics = {
        todayTurns: usage.metrics.todayTurns,
        todayTokens: usage.metrics.todayInputTokens + usage.metrics.todayOutputTokens,
        totalTurns: usage.metrics.totalTurns,
        totalTokens: usage.metrics.totalInputTokens + usage.metrics.totalOutputTokens,
      };

      if (fetchLiveLimits) {
        try {
          officialLimits = await this.geminiClient.getUsageLimits();
          await this.geminiClient.close();
        } catch {
          // Keep cached
        }
      }
    }

    this._view.webview.postMessage({
      type: 'stateUpdate',
      data: {
        activeAccount: active,
        accounts,
        settings,
        officialLimits,
        localMetrics,
        thread,
        sessionId,
      },
    });
  }

  private async _handleQuery(prompt: string, thinkingLevel?: string) {
    if (!this._view) return;

    this._view.webview.postMessage({ type: 'queryStart' });

    try {
      const sessionId = vscode.workspace.name || 'default';
      const effectiveLevel = thinkingLevel || 'low';
      const result = await this.geminiClient.query(
        prompt,
        undefined,
        effectiveLevel as any,
        true,
        sessionId
      );
      await this.geminiClient.close();

      this._view.webview.postMessage({
        type: 'querySuccess',
        result,
      });

      this.notifyStateChanged();
      await this.syncState(false);
    } catch (err: any) {
      this._view.webview.postMessage({
        type: 'queryError',
        error: err.message,
      });
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();

    const active = this.sessionManager.getActiveAccount();
    const accounts = this.sessionManager.listAccounts();
    const settings = getSettings();
    const sessionId = vscode.workspace.name || 'default';
    const thread = active ? this.threadStore.getThread(sessionId, active.id) : undefined;

    let officialLimits = undefined;
    let localMetrics = {
      todayTurns: 0,
      todayTokens: 0,
      totalTurns: 0,
      totalTokens: 0,
    };

    if (active) {
      const usage = this.usageStore.getAccountUsage(active.id);
      officialLimits = usage.officialLimits;
      localMetrics = {
        todayTurns: usage.metrics.todayTurns,
        todayTokens: usage.metrics.todayInputTokens + usage.metrics.todayOutputTokens,
        totalTurns: usage.metrics.totalTurns,
        totalTokens: usage.metrics.totalInputTokens + usage.metrics.totalOutputTokens,
      };
    }

    const initialState = {
      activeAccount: active,
      accounts,
      settings,
      officialLimits,
      localMetrics,
      thread,
      sessionId,
    };
    const initialStateJson = JSON.stringify(initialState).replace(/</g, '\\u003c');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} data: https:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Argon Bridge</title>
  <style>
    :root {
      --bg: var(--vscode-sideBar-background, #121316);
      --card-bg: var(--vscode-editor-background, #18191e);
      --card-border: var(--vscode-widget-border, #2a2c34);
      --text: var(--vscode-foreground, #e2e4e9);
      --text-muted: var(--vscode-descriptionForeground, #9497a1);
      --accent-blue: #4285F4;
      --accent-purple: #9B72CB;
      --accent-coral: #D96570;
      --green: #34A853;
      --amber: #FBBC04;
      --red: #EA4335;
      --font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    /* Ultra-sleek custom scrollbar */
    ::-webkit-scrollbar {
      width: 4px;
      height: 4px;
    }

    ::-webkit-scrollbar-track {
      background: transparent;
    }

    ::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.12);
      border-radius: 4px;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: rgba(255, 255, 255, 0.28);
    }

    ::-webkit-scrollbar-corner {
      background: transparent;
    }

    ::-webkit-scrollbar-button {
      display: none;
      width: 0;
      height: 0;
    }

    html {
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.12) transparent;
    }

    body {
      background-color: var(--bg);
      color: var(--text);
      font-family: var(--font);
      font-size: 12px;
      line-height: 1.5;
      padding: 12px;
    }

    .icon {
      width: 14px;
      height: 14px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
      display: inline-block;
      vertical-align: middle;
    }

    .icon-sm { width: 12px; height: 12px; }
    .icon-lg { width: 18px; height: 18px; }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--card-border);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .title {
      font-weight: 700;
      font-size: 13px;
      background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .badge-status {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.5px;
      padding: 2.5px 8px;
      border-radius: 999px;
      background: rgba(16, 185, 129, 0.08);
      color: #10b981;
      border: 1px solid rgba(16, 185, 129, 0.22);
      backdrop-filter: blur(6px);
      transition: all 0.25s ease;
    }

    .status-dot-container {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 6px;
      height: 6px;
    }

    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: #10b981;
      box-shadow: 0 0 6px rgba(16, 185, 129, 0.8);
    }

    .status-dot-ping {
      position: absolute;
      top: 0;
      left: 0;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: #10b981;
      opacity: 0.75;
      animation: status-ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;
    }

    @keyframes status-ping {
      0% { transform: scale(1); opacity: 0.8; }
      75%, 100% { transform: scale(2.4); opacity: 0; }
    }

    .badge-status.rate-limited {
      background: rgba(245, 158, 11, 0.08);
      color: #f59e0b;
      border-color: rgba(245, 158, 11, 0.25);
    }
    .badge-status.rate-limited .status-dot {
      background-color: #f59e0b;
      box-shadow: 0 0 6px rgba(245, 158, 11, 0.8);
    }
    .badge-status.rate-limited .status-dot-ping {
      background-color: #f59e0b;
    }

    .badge-status.needs-login {
      background: rgba(239, 68, 68, 0.08);
      color: #ef4444;
      border-color: rgba(239, 68, 68, 0.25);
    }
    .badge-status.needs-login .status-dot {
      background-color: #ef4444;
      box-shadow: 0 0 6px rgba(239, 68, 68, 0.8);
    }
    .badge-status.needs-login .status-dot-ping {
      background-color: #ef4444;
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 10px;
      margin-bottom: 12px;
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }

    .card-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      background: var(--vscode-button-background, #3a3f4e);
      color: var(--vscode-button-foreground, #ffffff);
      border: 1px solid transparent;
      padding: 5px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      width: 100%;
    }

    .btn:hover {
      background: var(--vscode-button-hoverBackground, #484e60);
    }

    .btn-secondary {
      background: transparent;
      border: 1px solid var(--card-border);
      color: var(--text);
    }

    .btn-icon {
      width: 24px;
      height: 24px;
      padding: 0;
      border-radius: 5px;
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .btn-icon:hover {
      color: var(--text);
      background: rgba(255, 255, 255, 0.08);
    }

    .progress-box {
      margin-top: 6px;
      margin-bottom: 8px;
    }

    .progress-label {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      margin-bottom: 3px;
    }

    .progress-bar-bg {
      height: 6px;
      background: rgba(255, 255, 255, 0.08);
      border-radius: 3px;
      overflow: hidden;
    }

    .progress-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--accent-blue), var(--accent-purple));
      border-radius: 3px;
      transition: width 0.4s ease;
    }

    .progress-bar-fill.warn {
      background: linear-gradient(90deg, var(--amber), var(--red));
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
      margin-top: 8px;
    }

    .metric-tile {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 6px;
      padding: 6px 8px;
    }

    .metric-val {
      font-size: 13px;
      font-weight: 700;
      color: var(--text);
    }

    .metric-lbl {
      font-size: 10px;
      color: var(--text-muted);
    }

    .segmented {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      padding: 2px;
      gap: 2px;
      margin-top: 6px;
    }

    .seg-item {
      padding: 5px 2px;
      text-align: center;
      font-size: 10px;
      font-weight: 600;
      border-radius: 4px;
      cursor: pointer;
      color: var(--text-muted);
    }

    .seg-item.active {
      background: var(--vscode-button-background, #3a3f4e);
      color: #ffffff;
    }

    .account-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.05);
      margin-bottom: 6px;
      cursor: pointer;
    }

    .account-item:hover {
      background: rgba(255, 255, 255, 0.05);
    }

    .account-item.active {
      border-color: var(--accent-blue);
      background: rgba(66, 133, 244, 0.08);
    }

    .acc-info {
      display: flex;
      align-items: center;
      gap: 8px;
      overflow: hidden;
    }

    .avatar {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--accent-blue), var(--accent-purple));
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 10px;
      color: #ffffff;
      flex-shrink: 0;
    }

    .acc-email {
      font-weight: 600;
      font-size: 11px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 140px;
    }

    .acc-sub {
      font-size: 10px;
      color: var(--text-muted);
    }

    .query-textarea {
      width: 100%;
      height: 60px;
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      color: var(--text);
      padding: 6px 8px;
      font-family: var(--font);
      font-size: 11px;
      resize: vertical;
      margin-bottom: 6px;
    }

    .query-textarea:focus {
      outline: none;
      border-color: var(--accent-blue);
    }

    .response-box {
      margin-top: 8px;
      padding: 8px;
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      font-size: 11px;
      white-space: pre-wrap;
      max-height: 200px;
      overflow-y: auto;
    }

    .thinking-box {
      margin-top: 6px;
      padding: 6px;
      background: rgba(155, 114, 203, 0.08);
      border-left: 2px solid var(--accent-purple);
      border-radius: 0 4px 4px 0;
      font-size: 10px;
      color: var(--accent-purple);
      max-height: 120px;
      overflow-y: auto;
    }

    /* === 1. ARGON BRIDGE EMBLEM STYLES === */
    .argon-icon-container {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      background: radial-gradient(circle at 50% 50%, rgba(56, 189, 248, 0.12), rgba(13, 21, 32, 0.85));
      border: 1px solid rgba(56, 189, 248, 0.22);
      border-radius: 7px;
      box-shadow: inset 0 0 8px rgba(56, 189, 248, 0.08);
      transition: all 0.25s ease;
      flex-shrink: 0;
    }

    .argon-icon-container:hover {
      border-color: rgba(56, 189, 248, 0.5);
      box-shadow: 0 0 10px rgba(56, 189, 248, 0.25), inset 0 0 8px rgba(168, 85, 247, 0.15);
    }

    .argon-bridge-logo {
      overflow: visible;
    }

    .ab-middle-shell {
      transform-origin: 16px 16px;
      animation: ab-orbital-rotate 18s linear infinite;
    }

    .argon-icon-container:hover .ab-middle-shell {
      animation-duration: 5s;
    }

    .ab-core-spark {
      transform-origin: 16px 16px;
      animation: ab-spark-pulse 3.5s ease-in-out infinite;
    }

    @keyframes ab-orbital-rotate {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    @keyframes ab-spark-pulse {
      0%, 100% {
        transform: scale(1);
        filter: drop-shadow(0 0 2px rgba(56, 189, 248, 0.7));
      }
      50% {
        transform: scale(1.15);
        filter: drop-shadow(0 0 5px rgba(168, 85, 247, 0.9));
      }
    }

    /* === 2. QUANTUM SYNC REFRESH BUTTON === */
    .quantum-sync-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      padding: 0;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(56, 189, 248, 0.18);
      border-radius: 6px;
      cursor: pointer;
      color: #38bdf8;
      transition: all 0.2s cubic-bezier(0.22, 1, 0.36, 1);
    }

    .quantum-sync-btn:hover {
      border-color: rgba(56, 189, 248, 0.45);
      background: rgba(56, 189, 248, 0.08);
      box-shadow: 0 0 8px rgba(56, 189, 248, 0.2);
    }

    .quantum-sync-icon {
      overflow: visible;
    }

    .qs-orbit-outer,
    .qs-orbit-inner,
    .qs-nucleus {
      transform-origin: 12px 12px;
      transition: transform 0.45s cubic-bezier(0.22, 1, 0.36, 1);
    }

    .quantum-sync-btn:not(.is-syncing):hover .qs-orbit-outer {
      transform: rotate(45deg);
    }

    .quantum-sync-btn:not(.is-syncing):hover .qs-orbit-inner {
      transform: rotate(-60deg);
    }

    .quantum-sync-btn.is-syncing {
      border-color: rgba(16, 185, 129, 0.45);
      box-shadow: 0 0 10px rgba(56, 189, 248, 0.25), inset 0 0 6px rgba(16, 185, 129, 0.12);
    }

    .quantum-sync-btn.is-syncing .qs-orbit-outer {
      animation: qs-spin-cw 1.6s cubic-bezier(0.65, 0, 0.35, 1) infinite;
    }

    .quantum-sync-btn.is-syncing .qs-orbit-inner {
      animation: qs-spin-ccw 1.2s linear infinite;
    }

    .quantum-sync-btn.is-syncing .qs-nucleus {
      animation: qs-core-flux 0.8s ease-in-out infinite alternate;
    }

    .quantum-sync-btn.is-syncing .qs-particle-cyan {
      filter: drop-shadow(0 0 3px #38bdf8);
    }

    .quantum-sync-btn.is-syncing .qs-particle-purple {
      filter: drop-shadow(0 0 3px #a855f7);
    }

    @keyframes qs-spin-cw {
      0% { transform: rotate(0deg) scale(1); }
      50% { transform: rotate(180deg) scale(1.04); }
      100% { transform: rotate(360deg) scale(1); }
    }

    @keyframes qs-spin-ccw {
      from { transform: rotate(0deg); }
      to { transform: rotate(-360deg); }
    }

    @keyframes qs-core-flux {
      0% { transform: scale(0.92); filter: drop-shadow(0 0 2px #38bdf8); }
      100% { transform: scale(1.18); filter: drop-shadow(0 0 5px #10b981); }
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="header">
    <div class="brand">
      <div class="argon-icon-container" title="Argon Bridge — Gemini 4 Reasoning Engine">
        <svg class="argon-bridge-logo" viewBox="0 0 32 32" width="22" height="22" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="ab-shell-grad" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#38bdf8" />
              <stop offset="55%" stop-color="#a855f7" />
              <stop offset="100%" stop-color="#10b981" />
            </linearGradient>
            <linearGradient id="ab-bridge-grad" x1="2" y1="16" x2="30" y2="16" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#10b981" />
              <stop offset="50%" stop-color="#38bdf8" />
              <stop offset="100%" stop-color="#a855f7" />
            </linearGradient>
            <radialGradient id="ab-core-glow" cx="16" cy="16" r="8" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.45" />
              <stop offset="60%" stop-color="#a855f7" stop-opacity="0.15" />
              <stop offset="100%" stop-color="#0d1520" stop-opacity="0" />
            </radialGradient>
          </defs>
          <!-- Ambient Core Backlight -->
          <circle cx="16" cy="16" r="8" fill="url(#ab-core-glow)" />
          <!-- Shell 3: Noble Hexagonal Containment -->
          <path d="M16 2.5L27.69 9.25V22.75L16 29.5L4.31 22.75V9.25L16 2.5Z" stroke="url(#ab-shell-grad)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.85" />
          <!-- Shell 2: Dual Broken Quantum Orbitals -->
          <g class="ab-middle-shell">
            <path d="M16 6.5A9.5 9.5 0 0 1 25.17 13.5M16 25.5A9.5 9.5 0 0 1 6.83 18.5" stroke="#38bdf8" stroke-width="1.25" stroke-linecap="round" stroke-opacity="0.7" />
            <path d="M23.5 21.8A9.5 9.5 0 0 1 18.5 25.17M8.5 10.2A9.5 9.5 0 0 1 13.5 6.83" stroke="#a855f7" stroke-width="1.25" stroke-linecap="round" stroke-opacity="0.7" />
            <circle cx="16" cy="6.5" r="1.2" fill="#38bdf8" />
            <circle cx="16" cy="25.5" r="1.2" fill="#a855f7" />
          </g>
          <!-- The Bridge: Multi-Account Neural Gateway Arcs -->
          <path d="M4.5 16C9 11.5 23 11.5 27.5 16" stroke="url(#ab-bridge-grad)" stroke-width="1.4" stroke-linecap="round" />
          <path d="M4.5 16C9 20.5 23 20.5 27.5 16" stroke="url(#ab-bridge-grad)" stroke-width="1.4" stroke-linecap="round" stroke-opacity="0.65" />
          <circle cx="4.3" cy="16" r="1.8" fill="#0d1520" stroke="#10b981" stroke-width="1.4" />
          <circle cx="27.7" cy="16" r="1.8" fill="#0d1520" stroke="#a855f7" stroke-width="1.4" />
          <!-- Shell 1: Inner K-Shell + Gemini 4 Reasoning Spark -->
          <circle cx="16" cy="16" r="4.2" stroke="#38bdf8" stroke-width="1" stroke-dasharray="2 2" stroke-opacity="0.6" />
          <path class="ab-core-spark" d="M16 11.2C16 13.85 18.15 16 20.8 16C18.15 16 16 18.15 16 20.8C16 18.15 13.85 16 11.2 16C13.85 16 16 13.85 16 11.2Z" fill="url(#ab-shell-grad)" />
          <circle cx="16" cy="16" r="1.1" fill="#ffffff" />
        </svg>
      </div>
      <div>
        <div class="title">Argon Bridge</div>
      </div>
    </div>
    <div style="display: flex; align-items: center; gap: 6px;">
      <span id="statusBadge" class="badge-status">
        <span class="status-dot-container">
          <span class="status-dot-ping"></span>
          <span class="status-dot"></span>
        </span>
        <span id="statusText">READY</span>
      </span>
      <button class="quantum-sync-btn" id="btnRefreshQuota" title="Quantum Sync Live Limits">
        <svg class="quantum-sync-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="qs-outer-arc" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#38bdf8" />
              <stop offset="100%" stop-color="#a855f7" stop-opacity="0.25" />
            </linearGradient>
            <linearGradient id="qs-inner-arc" x1="21" y1="3" x2="3" y2="21" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stop-color="#10b981" />
              <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.25" />
            </linearGradient>
          </defs>
          <g class="qs-orbit-outer">
            <path d="M4.93 9.17A8.5 8.5 0 0 1 19.65 8.25" stroke="url(#qs-outer-arc)" stroke-width="1.6" stroke-linecap="round" />
            <path d="M19.07 14.83A8.5 8.5 0 0 1 4.35 15.75" stroke="url(#qs-outer-arc)" stroke-width="1.6" stroke-linecap="round" />
            <circle cx="19.65" cy="8.25" r="1.65" fill="#38bdf8" class="qs-particle-cyan" />
            <circle cx="4.35" cy="15.75" r="1.65" fill="#a855f7" class="qs-particle-purple" />
          </g>
          <g class="qs-orbit-inner">
            <path d="M15.8 7.6A5.2 5.2 0 0 0 7.1 10.2" stroke="url(#qs-inner-arc)" stroke-width="1.4" stroke-linecap="round" />
            <path d="M8.2 16.4A5.2 5.2 0 0 0 16.9 13.8" stroke="url(#qs-inner-arc)" stroke-width="1.4" stroke-linecap="round" />
            <circle cx="7.1" cy="10.2" r="1.15" fill="#10b981" />
            <circle cx="16.9" cy="13.8" r="1.15" fill="#38bdf8" />
          </g>
          <g class="qs-nucleus">
            <circle cx="12" cy="12" r="2.1" fill="#0d1520" stroke="#38bdf8" stroke-width="1.2" />
            <circle cx="12" cy="12" r="0.9" fill="#10b981" />
          </g>
        </svg>
      </button>
    </div>
  </div>

  <!-- Live Quota Card -->
  <div class="card">
    <div class="card-header">
      <span class="card-title">
        <svg viewBox="0 0 24 24" class="icon"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        Usage Quota
      </span>
      <span id="planBadge" style="font-weight: 700; color: var(--accent-blue);">PRO</span>
    </div>

    <div class="progress-box">
      <div class="progress-label">
        <span>Current Usage</span>
        <span id="currentUsageTxt" style="font-weight: 600;">0%</span>
      </div>
      <div class="progress-bar-bg">
        <div id="currentUsageBar" class="progress-bar-fill" style="width: 0%;"></div>
      </div>
      <div id="currentResetTxt" style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">Resets at: --:--</div>
    </div>

    <div class="progress-box" style="margin-bottom: 4px;">
      <div class="progress-label">
        <span>Weekly Limit</span>
        <span id="weeklyUsageTxt" style="font-weight: 600;">0%</span>
      </div>
      <div class="progress-bar-bg">
        <div id="weeklyUsageBar" class="progress-bar-fill" style="width: 0%;"></div>
      </div>
      <div id="weeklyResetTxt" style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">Resets on: --</div>
    </div>

    <div class="metrics-grid">
      <div class="metric-tile">
        <div class="metric-val" id="todayTurns">0</div>
        <div class="metric-lbl">Today's Turns</div>
      </div>
      <div class="metric-tile">
        <div class="metric-val" id="todayTokens">~0</div>
        <div class="metric-lbl">Today's Tokens</div>
      </div>
    </div>
  </div>

  <!-- Thinking Depth Settings -->
  <div class="card">
    <div class="card-header">
      <span class="card-title">
        <svg viewBox="0 0 24 24" class="icon"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        Thinking Mode
      </span>
      <span id="thinkingDesc" style="font-size: 10px; color: var(--text-muted);">Dynamic</span>
    </div>

    <div class="segmented" id="thinkingSegmented">
      <div class="seg-item active" data-mode="auto">AUTO</div>
      <div class="seg-item" data-mode="low">LOW</div>
      <div class="seg-item" data-mode="medium">MED</div>
      <div class="seg-item" data-mode="high">HIGH</div>
    </div>
    <div id="thinkingNote" style="font-size: 10px; color: var(--text-muted); margin-top: 6px;">
      Auto: Agent dynamically picks thinking depth based on complexity.
    </div>
  </div>

  <!-- Conversation Memory & Thread Control -->
  <div class="card">
    <div class="card-header">
      <span class="card-title">
        <svg viewBox="0 0 24 24" class="icon"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        Project Thread
      </span>
      <button class="btn-icon" id="btnResetThread" title="Reset Conversation (Start Fresh)">
        <svg viewBox="0 0 24 24" class="icon"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>
    <div style="font-size: 11px; margin-bottom: 6px;">
      <span style="color: var(--text-muted);">Session:</span> <strong id="threadSessionName">default</strong>
    </div>
    <div style="display: flex; align-items: center; justify-content: space-between; font-size: 10px; color: var(--text-muted);">
      <span id="threadStatus">Memory: Active thread maintained</span>
      <button class="btn btn-secondary" id="btnResetThreadExplicit" style="width: auto; padding: 2px 8px; font-size: 10px;">
        Start Fresh
      </button>
    </div>
  </div>

  <!-- Accounts Manager -->
  <div class="card">
    <div class="card-header">
      <span class="card-title">
        <svg viewBox="0 0 24 24" class="icon"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        Google Accounts
      </span>
      <span id="accCount" style="font-size: 10px; color: var(--text-muted);">0 connected</span>
    </div>

    <div id="accountsList"></div>

    <button class="btn" id="btnAddAccount" style="margin-top: 6px;">
      <svg viewBox="0 0 24 24" class="icon"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      Add Google Pro Account
    </button>
  </div>  <!-- Quick Test Consultation -->
  <div class="card">
    <div class="card-header">
      <span class="card-title">
        <svg viewBox="0 0 24 24" class="icon"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        Quick Test Query
      </span>
      <span style="font-size: 9.5px; font-weight: 600; color: #10b981; background: rgba(16, 185, 129, 0.1); padding: 1px 6px; border-radius: 4px; border: 1px solid rgba(16, 185, 129, 0.25);">LOW MODE</span>
    </div>
    <textarea class="query-textarea" id="queryInput" placeholder="Ask 4 Argon something directly to test your connection..."></textarea>
    <button class="btn" id="btnSubmitQuery">
      <svg viewBox="0 0 24 24" class="icon icon-sm"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
      <span id="btnSubmitQueryTxt">Test Setup (Fast Round-Trip)</span>
    </button>
    <div style="font-size: 10px; color: var(--text-muted); margin-top: 6px; display: flex; align-items: center; gap: 5px;">
      <svg viewBox="0 0 24 24" class="icon icon-sm" style="stroke: #38bdf8; flex-shrink: 0;"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
      <span>Diagnostic test is always executed with <strong>LOW</strong> thinking depth for fast setup verification.</span>
    </div>
    <div id="queryThinking" class="thinking-box" style="display: none;"></div>
    <div id="queryResponse" class="response-box" style="display: none;"></div>
  </div>

  <script nonce="${nonce}">
    try {
      const vscode = acquireVsCodeApi();

      const statusBadge = document.getElementById('statusBadge');
      const statusText = document.getElementById('statusText');
      const planBadge = document.getElementById('planBadge');
      const currentUsageTxt = document.getElementById('currentUsageTxt');
      const currentUsageBar = document.getElementById('currentUsageBar');
      const currentResetTxt = document.getElementById('currentResetTxt');
      const weeklyUsageTxt = document.getElementById('weeklyUsageTxt');
      const weeklyUsageBar = document.getElementById('weeklyUsageBar');
      const weeklyResetTxt = document.getElementById('weeklyResetTxt');
      const todayTurns = document.getElementById('todayTurns');
      const todayTokens = document.getElementById('todayTokens');
      const accountsList = document.getElementById('accountsList');
      const accCount = document.getElementById('accCount');
      const thinkingDesc = document.getElementById('thinkingDesc');
      const thinkingNote = document.getElementById('thinkingNote');
      const threadSessionName = document.getElementById('threadSessionName');
      const threadStatus = document.getElementById('threadStatus');

      const queryInput = document.getElementById('queryInput');
      const btnSubmitQuery = document.getElementById('btnSubmitQuery');
      const btnSubmitQueryTxt = document.getElementById('btnSubmitQueryTxt');
      const queryThinking = document.getElementById('queryThinking');
      const queryResponse = document.getElementById('queryResponse');
      const btnRefreshQuota = document.getElementById('btnRefreshQuota');

      btnRefreshQuota.addEventListener('click', () => {
        btnRefreshQuota.classList.add('is-syncing');
        vscode.postMessage({ type: 'refresh' });
      });

      document.getElementById('btnResetThread').addEventListener('click', () => {
        vscode.postMessage({ type: 'resetThread' });
      });

      document.getElementById('btnResetThreadExplicit').addEventListener('click', () => {
        vscode.postMessage({ type: 'resetThread' });
      });

      document.getElementById('btnAddAccount').addEventListener('click', () => {
        vscode.postMessage({ type: 'login' });
      });

      document.querySelectorAll('.seg-item').forEach(el => {
        el.addEventListener('click', () => {
          const mode = el.getAttribute('data-mode');
          vscode.postMessage({ type: 'setThinkingMode', mode });
        });
      });

      btnSubmitQuery.addEventListener('click', () => {
        const prompt = queryInput.value.trim();
        if (!prompt) return;

        // Diagnostic quick test query is always performed with low thinking depth for rapid round-trip verification
        vscode.postMessage({ type: 'askQuery', prompt, thinkingLevel: 'low' });
      });

      window.addEventListener('message', (event) => {
        const msg = event.data;
        if (!msg) return;

        switch (msg.type) {
          case 'stateUpdate':
            renderState(msg.data);
            btnRefreshQuota.classList.remove('is-syncing');
            break;
          case 'queryStart':
            btnSubmitQuery.disabled = true;
            btnSubmitQueryTxt.textContent = 'Testing (Low Mode)...';
            queryResponse.style.display = 'none';
            queryThinking.style.display = 'none';
            break;
          case 'querySuccess':
            btnSubmitQuery.disabled = false;
            btnSubmitQueryTxt.textContent = 'Test Setup (Fast Round-Trip)';
            if (msg.result.thinkingProcess) {
              queryThinking.style.display = 'block';
              queryThinking.textContent = 'Thought Process:\\n' + msg.result.thinkingProcess;
            }
            queryResponse.style.display = 'block';
            queryResponse.textContent = msg.result.response;
            break;
          case 'queryError':
            btnSubmitQuery.disabled = false;
            btnSubmitQueryTxt.textContent = 'Test Setup (Fast Round-Trip)';
            queryResponse.style.display = 'block';
            queryResponse.textContent = 'Error: ' + msg.error;
            break;
        }
      });

      function renderState(data) {
        if (!data) return;
        const active = data.activeAccount;
        if (active) {
          if (active.status === 'rate-limited') {
            statusText.textContent = 'RATE-LIMITED';
            statusBadge.className = 'badge-status rate-limited';
          } else if (active.status === 'needs_login' || active.status === 'logged_out' || active.status === 'expired') {
            statusText.textContent = 'NEEDS LOGIN';
            statusBadge.className = 'badge-status needs-login';
          } else {
            statusText.textContent = 'READY';
            statusBadge.className = 'badge-status';
          }
          planBadge.textContent = active.plan;
        } else {
          statusText.textContent = 'NO ACCOUNT';
          statusBadge.className = 'badge-status needs-login';
        }

        if (data.officialLimits) {
          const cur = data.officialLimits.currentUsagePercent;
          currentUsageTxt.textContent = cur + '%';
          currentUsageBar.style.width = Math.min(100, cur) + '%';
          currentUsageBar.className = cur > 85 ? 'progress-bar-fill warn' : 'progress-bar-fill';
          currentResetTxt.textContent = 'Resets at: ' + data.officialLimits.currentResetTime;

          const wk = data.officialLimits.weeklyLimitPercent;
          weeklyUsageTxt.textContent = wk + '%';
          weeklyUsageBar.style.width = Math.min(100, wk) + '%';
          weeklyResetTxt.textContent = 'Resets on: ' + data.officialLimits.weeklyResetDate;
        }

        if (data.localMetrics) {
          todayTurns.textContent = data.localMetrics.todayTurns;
          todayTokens.textContent = '~' + data.localMetrics.todayTokens;
        }

        if (data.settings) {
          const currentMode = data.settings.forcedThinkingLevel;
          document.querySelectorAll('.seg-item').forEach(el => {
            el.className = el.getAttribute('data-mode') === currentMode ? 'seg-item active' : 'seg-item';
          });

          if (currentMode === 'auto') {
            thinkingDesc.textContent = 'Dynamic';
            thinkingNote.textContent = 'Auto: Agent dynamically picks thinking depth based on complexity.';
          } else {
            thinkingDesc.textContent = 'Locked: ' + currentMode.toUpperCase();
            thinkingNote.textContent = 'Hard limit active: All consultations will use ' + currentMode.toUpperCase() + ' thinking.';
          }
        }

        if (data.sessionId) {
          threadSessionName.textContent = data.sessionId;
        }
        if (data.thread && data.thread.threadUrl) {
          const shortUrl = data.thread.threadUrl.replace('https://gemini.google.com/app/', '');
          threadStatus.innerHTML = '<span style="color: var(--accent-blue);">Active: </span><a href="' + data.thread.threadUrl + '" style="color: var(--accent-blue); text-decoration: underline;" target="_blank">#' + shortUrl + '</a>';
        } else {
          threadStatus.textContent = 'Fresh conversation ready';
        }

        if (data.accounts) {
          accCount.textContent = data.accounts.length + ' connected';
          accountsList.innerHTML = '';

          data.accounts.forEach(acc => {
            const item = document.createElement('div');
            item.className = acc.isActive ? 'account-item active' : 'account-item';

            const initial = (acc.email || 'A').charAt(0).toUpperCase();
            let statusBadge = '';
            if (acc.status === 'needs_login' || acc.status === 'logged_out' || acc.status === 'expired') {
              statusBadge = '<span style="color: #ef4444; font-size: 10px; background: rgba(239, 68, 68, 0.15); padding: 2px 6px; border-radius: 4px; margin-right: 4px;">Needs Login</span>';
            } else if (acc.status === 'rate-limited') {
              statusBadge = '<span style="color: var(--amber); font-size: 10px; background: rgba(245, 158, 11, 0.15); padding: 2px 6px; border-radius: 4px; margin-right: 4px;">Limit Reached</span>';
            } else if (acc.isActive) {
              statusBadge = '<span style="color: var(--accent-blue); font-weight: 700; font-size: 11px; margin-right: 4px;">Active</span>';
            }

            item.innerHTML = '<div class="acc-info">' +
              '<div class="avatar">' + initial + '</div>' +
              '<div>' +
                '<div class="acc-email">' + acc.email + '</div>' +
                '<div class="acc-sub">' + acc.alias + ' (' + acc.plan + ')</div>' +
              '</div>' +
            '</div>' +
            '<div style="display: flex; align-items: center; gap: 4px;">' +
              statusBadge +
              '<button class="btn-icon btn-remove-acc" data-id="' + acc.id + '" title="Remove account">' +
                '<svg viewBox="0 0 24 24" class="icon icon-sm"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
              '</button>' +
            '</div>';

            item.addEventListener('click', (e) => {
              if (e.target.closest('.btn-remove-acc')) return;
              if (acc.status === 'needs_login' || acc.status === 'logged_out' || acc.status === 'expired') {
                vscode.postMessage({ type: 'relogin', accountId: acc.id });
                return;
              }
              if (!acc.isActive) {
                vscode.postMessage({ type: 'switchAccount', accountId: acc.id });
              }
            });

            const removeBtn = item.querySelector('.btn-remove-acc');
            if (removeBtn) {
              removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                vscode.postMessage({ type: 'logout', accountId: acc.id });
              });
            }

            accountsList.appendChild(item);
          });
        }
      }

      // Immediately render accounts and quota synchronously on mount
      try {
        const initialData = ${initialStateJson};
        renderState(initialData);
      } catch (renderErr) {
        console.error('Initial renderState error:', renderErr);
      }

      // Signal to host that webview DOM and listeners are ready
      vscode.postMessage({ type: 'ready' });
    } catch (err) {
      console.error('Webview initialization error:', err);
    }
  </script>
</body>
</html>`;
  }
}
