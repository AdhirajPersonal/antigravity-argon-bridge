import { chromium, BrowserContext, Page } from 'playwright';
import {
  ThinkingLevel,
  OfficialUsageLimits,
  getSettings,
} from '../config.js';
import { SessionManager } from '../auth/session-manager.js';
import { UsageStore } from '../telemetry/usage-store.js';
import { TokenCounter } from '../telemetry/token-counter.js';
import { ThreadStore } from '../telemetry/thread-store.js';
import { applyStealthEvasions, humanClick } from './stealth.js';

export interface QueryResult {
  response: string;
  thinkingProcess?: string;
  estimatedTokens: {
    input: number;
    output: number;
    total: number;
  };
  accountId: string;
  accountEmail: string;
  thinkingLevel: string;
  threadUrl: string;
}

export class GeminiClient {
  private sessionManager: SessionManager;
  private usageStore: UsageStore;
  private threadStore: ThreadStore;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private currentAccountId: string | null = null;

  constructor() {
    this.sessionManager = new SessionManager();
    this.usageStore = new UsageStore();
    this.threadStore = new ThreadStore();
  }

  async ensureBrowser(headless: boolean = true): Promise<Page> {
    let activeAccount = this.sessionManager.getActiveAccount();
    if (!activeAccount) {
      throw new Error(
        'No active account found. Please log in first using the "argon_login" tool or run "npm run cli login".'
      );
    }

    // If current active account is rate-limited, attempt auto-rotation
    if (activeAccount.status === 'rate-limited') {
      const backup = this.sessionManager.findAvailableAccount();
      if (backup) {
        console.log(`[GeminiClient] Active account ${activeAccount.email} is rate-limited. Auto-switching to backup: ${backup.email}...`);
        this.sessionManager.switchAccount(backup.id);
        activeAccount = backup;
      }
    }

    if (this.context && this.page && this.currentAccountId === activeAccount.id) {
      if (!this.page.isClosed()) {
        return this.page;
      }
    }

    await this.close();

    const profileDir = this.sessionManager.getProfileDir(activeAccount.id);
    this.currentAccountId = activeAccount.id;

    // Launch with stealth arguments & genuine desktop user-agent
    this.context = await chromium.launchPersistentContext(profileDir, {
      headless,
      viewport: { width: 1366, height: 768 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-infobars',
        '--disable-features=IsolateOrigins,site-per-process,EnableAutomation',
      ],
    });

    // Apply comprehensive stealth evasions (navigator.webdriver, chrome runtime, plugins)
    await applyStealthEvasions(this.context);

    this.page = this.context.pages()[0] || (await this.context.newPage());
    return this.page;
  }

  async close(): Promise<void> {
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
      this.page = null;
      this.currentAccountId = null;
    }
  }

  /**
   * Selects '4 Argon' model and sets the requested thinking level (low, medium, high).
   */
  async setupArgonModel(page: Page, thinkingLevel: ThinkingLevel = 'high'): Promise<void> {
    const modePicker = page.locator('button[aria-label*="mode picker"], button:has-text("Argon"), button:has-text("Flash")').first();
    let currentLabel = '';
    if (await modePicker.isVisible().catch(() => false)) {
      currentLabel = (await modePicker.getAttribute('aria-label')) || (await modePicker.textContent()) || '';
    }

    if (!currentLabel.includes('Argon')) {
      console.log(`[GeminiClient] Current model is not Argon. Opening model picker...`);
      await modePicker.click();
      await page.waitForTimeout(600);

      const argonItem = page.locator('div[role="menuitem"]:has-text("Argon"), :text("4 Argon")').first();
      if (await argonItem.isVisible().catch(() => false)) {
        await argonItem.click();
        await page.waitForTimeout(600);
      }
    }

    // Configure Thinking Level
    try {
      const menuOpen = await page.locator(':text("Thinking level")').first().isVisible().catch(() => false);
      if (!menuOpen) {
        const btn = page.locator('button[aria-label*="mode picker"], button:has-text("Argon")').first();
        if (await btn.isVisible()) {
          await btn.click();
          await page.waitForTimeout(400);
        }
      }

      const thinkingTrigger = page.locator(':text("Thinking level")').first();
      if (await thinkingTrigger.isVisible().catch(() => false)) {
        await thinkingTrigger.hover();
        await page.waitForTimeout(300);

        const levelMap = {
          low: 'Low',
          medium: 'Medium',
          high: 'High',
        };
        const targetText = levelMap[thinkingLevel];
        const levelItem = page.locator(`:text("${targetText}")`).first();
        if (await levelItem.isVisible().catch(() => false)) {
          await levelItem.click();
          console.log(`[GeminiClient] Thinking level set to: ${targetText}`);
        }
      }

      await page.keyboard.press('Escape').catch(() => {});
    } catch {
      // Non-fatal
    }
  }

  /**
   * Verifies that the browser is authenticated to Google Gemini.
   */
  async verifyAuthenticated(page: Page): Promise<boolean> {
    const hasSignInPrompt = await page
      .locator(':text("Sign in to save activity"), :text("Sign in with Google")')
      .first()
      .isVisible()
      .catch(() => false);
    if (hasSignInPrompt) {
      return false;
    }

    const accountBtn = page.locator('button[aria-label*="Google Account"], a[aria-label*="Google Account"]').first();
    if (await accountBtn.isVisible().catch(() => false)) {
      return true;
    }

    const cookies = (await this.context?.cookies('https://gemini.google.com')) || [];
    return cookies.some((c) => c.name === '__Secure-1PSID' || c.name === 'SID');
  }

  /**
   * Checks if page shows rate limit indicators.
   */
  async checkRateLimit(page: Page): Promise<{ isRateLimited: boolean; message?: string }> {
    const text = (await page.textContent('body')) || '';
    const rateLimitKeywords = [
      "reached your limit with this model",
      "reached the limit for this model",
      "temporarily unavailable",
      "too many requests",
      "try again later",
    ];

    for (const kw of rateLimitKeywords) {
      if (text.toLowerCase().includes(kw)) {
        return { isRateLimited: true, message: kw };
      }
    }

    return { isRateLimited: false };
  }

  /**
   * Queries Argon with thinking level, context, and multi-day thread persistence.
   * Auto-rotates across accounts if rate limit is reached.
   */
  async query(
    prompt: string,
    context?: string,
    requestedThinkingLevel: ThinkingLevel = 'high',
    continueThread: boolean = true,
    sessionId: string = 'default'
  ): Promise<QueryResult> {
    // 1. Determine effective thinking level (Agent choice vs User hard setting override)
    const settings = getSettings();
    let effectiveThinking: ThinkingLevel = requestedThinkingLevel;
    if (settings.forcedThinkingLevel !== 'auto') {
      effectiveThinking = settings.forcedThinkingLevel as ThinkingLevel;
      console.log(`[GeminiClient] User hard limit override applied: Thinking level locked to "${effectiveThinking.toUpperCase()}"`);
    }

    // 2. Multi-Account Execution with Auto-Failover Loop
    let attempts = 0;
    const maxAttempts = Math.max(1, this.sessionManager.listAccounts().length);

    while (attempts < maxAttempts) {
      attempts++;
      const activeAccount = this.sessionManager.getActiveAccount();
      if (!activeAccount) {
        throw new Error('No active account found. Please log in first using "npm run cli login".');
      }

      const page = await this.ensureBrowser(true);

      // Check multi-day session persistence (isolated per Google account)
      const savedThread = this.threadStore.getThread(sessionId, activeAccount.id);
      if (continueThread && savedThread && savedThread.threadUrl.includes('gemini.google.com/app/')) {
        if (page.url() !== savedThread.threadUrl) {
          console.log(`[GeminiClient] Resuming persistent project thread for ${activeAccount.email}: ${savedThread.threadUrl}`);
          await page.goto(savedThread.threadUrl, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(2000);
        }
      } else {
        if (!page.url().endsWith('/app') && !page.url().endsWith('/app/')) {
          await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(2000);
        }
      }

      // Verify genuine Google authentication (prevent unauthenticated guest sessions)
      const isAuthenticated = await this.verifyAuthenticated(page);
      if (!isAuthenticated) {
        console.warn(`[GeminiClient] Account "${activeAccount.email}" is NOT authenticated (Guest Mode detected).`);
        this.sessionManager.markAccountNeedsLogin(activeAccount.id);

        const nextAccount = this.sessionManager.findAvailableAccount();
        if (nextAccount) {
          console.log(`[GeminiClient] Auto-switching to authenticated account: ${nextAccount.email}...`);
          this.sessionManager.switchAccount(nextAccount.id);
          await this.close();
          continue;
        }

        throw new Error(
          `[AUTH_REQUIRED] Google account "${activeAccount.email}" is signed out or session has expired. Unauthenticated guest sessions cannot access 4 Argon or save chat history. Please re-login via the extension UI or CLI.`
        );
      }

      // Check if page already shows rate-limited state
      const preCheck = await this.checkRateLimit(page);
      if (preCheck.isRateLimited) {
        console.warn(`[GeminiClient] Account ${activeAccount.email} is rate-limited: "${preCheck.message}"`);
        this.sessionManager.markAccountRateLimited(activeAccount.id);

        const nextAccount = this.sessionManager.findAvailableAccount();
        if (nextAccount) {
          console.log(`[GeminiClient] Auto-failing over to next available account: ${nextAccount.email}...`);
          this.sessionManager.switchAccount(nextAccount.id);
          await this.close();
          continue;
        } else {
          // All accounts exhausted!
          const earliest = this.sessionManager.getEarliestResetAccount();
          const resetTimeStr = earliest?.cooldownUntil
            ? new Date(earliest.cooldownUntil).toLocaleTimeString()
            : 'in approximately 2-3 hours';

          throw new Error(
            `[ALL_ACCOUNTS_EXHAUSTED] All registered Pro accounts have reached their Argon quota. Earliest reset is at ${resetTimeStr}. Please fall back to internal reasoning (Gemini 3.8) or wait.`
          );
        }
      }

      // Set model & thinking depth
      await this.setupArgonModel(page, effectiveThinking);

      // Format prompt
      let fullPrompt = prompt;
      if (context && context.trim().length > 0) {
        fullPrompt = `=== CONTEXT ===\n${context.trim()}\n\n=== TASK ===\n${prompt.trim()}`;
      }

      const inputTokens = TokenCounter.estimateInput(prompt, context);

      // Focus input container
      const input = page.locator('rich-textarea p, div[contenteditable="true"]').first();
      await input.waitFor({ state: 'visible', timeout: 15000 });
      await input.click();
      await page.waitForTimeout(150 + Math.floor(Math.random() * 100));

      // Natural input event emulation
      await page.evaluate(({ text }) => {
        const activeEl = document.activeElement;
        if (activeEl) {
          document.execCommand('insertText', false, text);
          activeEl.dispatchEvent(new Event('input', { bubbles: true }));
          activeEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, { text: fullPrompt });

      await page.waitForTimeout(300 + Math.floor(Math.random() * 200));

      // Click Send using humanClick
      const clicked = await humanClick(page, 'button[aria-label*="Send message"], button[aria-label*="Send"], button.send-button');
      if (!clicked) {
        await page.keyboard.press('Enter');
      }

      console.log(`[GeminiClient] Prompt sent to 4 Argon (Thinking: ${effectiveThinking}). Waiting for generation...`);

      // Detect generation start
      const stopBtn = page.locator('button[aria-label*="Stop"]').first();
      try {
        await stopBtn.waitFor({ state: 'visible', timeout: 8000 });
        console.log('[GeminiClient] Argon reasoning has started.');
      } catch {
        // Fast answer or short reasoning
      }

      // Generation loop with live heartbeats
      const startTime = Date.now();
      const maxWaitMs = 180000;
      let lastLogTime = Date.now();

      while (Date.now() - startTime < maxWaitMs) {
        const isGenerating = await stopBtn.isVisible().catch(() => false);
        if (!isGenerating) {
          const elapsedSec = Math.round((Date.now() - startTime) / 1000);
          console.log(`[GeminiClient] Argon finished generation in ${elapsedSec}s.`);
          await page.waitForTimeout(1500);
          break;
        }

        if (Date.now() - lastLogTime >= 3000) {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          console.log(`[GeminiClient] Argon is reasoning & thinking... (${elapsed}s elapsed)`);
          lastLogTime = Date.now();
        }

        await page.waitForTimeout(1000);
      }

      // Check if response hit rate-limit during generation
      const postCheck = await this.checkRateLimit(page);
      if (postCheck.isRateLimited) {
        console.warn(`[GeminiClient] Rate-limit hit after query: "${postCheck.message}"`);
        this.sessionManager.markAccountRateLimited(activeAccount.id);

        const nextAccount = this.sessionManager.findAvailableAccount();
        if (nextAccount) {
          console.log(`[GeminiClient] Switching to backup account: ${nextAccount.email} and retrying...`);
          this.sessionManager.switchAccount(nextAccount.id);
          await this.close();
          continue;
        }
      }

      // Save persistent thread URL for this project session
      const currentUrl = page.url();
      if (currentUrl.includes('/app/')) {
        this.threadStore.setThread(sessionId, currentUrl, activeAccount.id);
      }

      // Extract response
      const responseData = await page.evaluate(() => {
        const containers = document.querySelectorAll(
          'structured-content-container.model-response-text, .response-container-content, model-response'
        );

        if (containers.length === 0) {
          return { text: '', thinking: '' };
        }

        const lastContainer = containers[containers.length - 1];

        let thinkingText = '';
        const thoughtEl = lastContainer.querySelector('.thought-container, details, [class*="thought"]');
        if (thoughtEl) {
          thinkingText = (thoughtEl as HTMLElement).innerText?.trim() || '';
        }

        const clone = lastContainer.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('.model-response-label-announcer, .cdk-visually-hidden, button').forEach(el => el.remove());

        const cleanText = clone.innerText?.trim() || '';
        return {
          text: cleanText,
          thinking: thinkingText,
        };
      });

      let responseText = responseData.text;
      if (!responseText || responseText.length === 0) {
        responseText = (await page.locator('.response-content, model-response').last().innerText().catch(() => '')) || 'No response captured.';
      }

      responseText = responseText.replace(/^Gemini said\s*/i, '').trim();
      const outputTokens = TokenCounter.estimateOutput(responseText);

      this.usageStore.recordTurn(activeAccount.id, inputTokens, outputTokens, effectiveThinking);

      return {
        response: responseText,
        thinkingProcess: responseData.thinking || undefined,
        estimatedTokens: {
          input: inputTokens,
          output: outputTokens,
          total: inputTokens + outputTokens,
        },
        accountId: activeAccount.id,
        accountEmail: activeAccount.email,
        thinkingLevel: effectiveThinking,
        threadUrl: currentUrl,
      };
    }

    throw new Error('Failed to query Argon across all registered accounts.');
  }

  /**
   * Resets active thread context for a specific session.
   */
  resetThread(sessionId: string = 'default'): void {
    this.threadStore.resetThread(sessionId);
  }

  /**
   * Scrapes live limits from https://gemini.google.com/usage
   */
  async getUsageLimits(): Promise<OfficialUsageLimits> {
    const page = await this.ensureBrowser(true);
    const activeAccount = this.sessionManager.getActiveAccount()!;

    console.log('[GeminiClient] Fetching official usage from https://gemini.google.com/usage...');
    await page.goto('https://gemini.google.com/usage', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=used, text=Current usage, [class*="usage"]', { timeout: 6000 }).catch(() => {});
    await page.waitForTimeout(1000);

    const bodyText = (await page.textContent('body')) || '';
    const existing = this.usageStore.getAccountUsage(activeAccount.id).officialLimits;

    let currentUsagePercent = existing?.currentUsagePercent ?? 0;
    let currentResetTime = existing?.currentResetTime ?? 'Unknown';
    let weeklyLimitPercent = existing?.weeklyLimitPercent ?? 0;
    let weeklyResetDate = existing?.weeklyResetDate ?? 'Unknown';
    let plan = existing?.plan ?? 'PRO';

    if (bodyText.includes('PRO')) plan = 'PRO';
    else if (bodyText.includes('ULTRA')) plan = 'ULTRA';

    // 1. Try parsing official JSON payload embedded in the page (handling both raw and escaped JSON)
    const poolsMatch = bodyText.match(/\\?"pools\\?":\s*(\[[\s\S]*?\])/);
    if (poolsMatch) {
      try {
        const cleanJson = poolsMatch[1].replace(/\\"/g, '"');
        const pools = JSON.parse(cleanJson);
        for (const pool of pools) {
          if (pool.poolType === 'GXU_FIVE_HOURLY') {
            currentUsagePercent = Math.round((pool.percentageUsed || 0) * 100);
            if (pool.gxu?.windowRefreshesAt) {
              const d = new Date(pool.gxu.windowRefreshesAt);
              currentResetTime = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
            }
          } else if (pool.poolType === 'GXU_WEEKLY') {
            weeklyLimitPercent = Math.round((pool.percentageUsed || 0) * 100);
            if (pool.gxu?.windowRefreshesAt) {
              const d = new Date(pool.gxu.windowRefreshesAt);
              weeklyResetDate = d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' at ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
            }
          }
        }
      } catch {
        // Fallback to text parsing
      }
    }

    // 2. DOM leaf node extraction (prevents time & percentage string concatenation)
    const domUsage = await page.evaluate(() => {
      const leafElements = Array.from(document.querySelectorAll('*')).filter(
        (el) => el.children.length === 0 && (el.textContent || '').trim().length > 0
      );

      const percentages: number[] = [];
      let resetAt = '';
      let resetOn = '';

      for (const el of leafElements) {
        const text = (el.textContent || '').trim();
        const pctMatch = text.match(/^(\d{1,3})%\s*used$/i) || text.match(/\b(\d{1,3})%\s*used\b/i);
        if (pctMatch) {
          percentages.push(parseInt(pctMatch[1], 10));
        }

        const atMatch = text.match(/Resets at\s*([0-9:]+)/i);
        if (atMatch && !resetAt) {
          resetAt = atMatch[1];
        }

        const onMatch = text.match(/Resets on\s*(.+)/i);
        if (onMatch && !resetOn) {
          resetOn = onMatch[1].trim();
        }
      }

      return { percentages, resetAt, resetOn };
    }).catch(() => ({ percentages: [], resetAt: '', resetOn: '' }));

    if (domUsage.percentages.length > 0) {
      currentUsagePercent = domUsage.percentages[0];
    }
    if (domUsage.percentages.length > 1) {
      weeklyLimitPercent = domUsage.percentages[1];
    }
    if (domUsage.resetAt) {
      currentResetTime = domUsage.resetAt;
    }
    if (domUsage.resetOn) {
      weeklyResetDate = domUsage.resetOn;
    }

    const limits: OfficialUsageLimits = {
      plan,
      currentUsagePercent,
      currentResetTime,
      weeklyLimitPercent,
      weeklyResetDate,
      lastUpdated: new Date().toISOString(),
    };

    this.usageStore.updateOfficialLimits(activeAccount.id, limits);
    return limits;
  }
}
