import path from 'path';
import fs from 'fs';
import { chromium, BrowserContext } from 'playwright';
import {
  PROFILES_DIR,
  ensureDirsExist,
  AccountMetadata,
} from '../config.js';
import { UsageStore } from '../telemetry/usage-store.js';
import { applyStealthEvasions } from '../bridge/stealth.js';

export class SessionManager {
  private usageStore: UsageStore;

  constructor() {
    ensureDirsExist();
    this.usageStore = new UsageStore();
  }

  getProfileDir(accountId: string): string {
    const dir = path.join(PROFILES_DIR, accountId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Launches an interactive non-headless Chromium window for the user
   * to sign in with their Google account (2FA, passkeys, carrier SSO supported).
   */
  /**
   * Launches an interactive non-headless Chromium window for the user
   * to sign in with their Google account (2FA, passkeys, carrier SSO supported).
   * If targetAccountId is passed, re-authenticates that specific account in-place.
   */
  async loginInteractive(alias?: string, targetAccountId?: string): Promise<AccountMetadata> {
    const isRelogin = !!targetAccountId;
    const tempId = targetAccountId || `acc_${Date.now()}`;
    const profileDir = this.getProfileDir(tempId);

    console.log(`[SessionManager] Opening interactive browser for Google sign-in (${isRelogin ? 'Re-login' : 'New Account'})...`);
    console.log(`[SessionManager] Profile directory: ${profileDir}`);

    const context: BrowserContext = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      viewport: { width: 1280, height: 800 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-infobars',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });

    await applyStealthEvasions(context);

    const page = context.pages()[0] || (await context.newPage());

    try {
      await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });

      console.log('[SessionManager] Please complete sign-in in the open browser window.');
      console.log('[SessionManager] Waiting for successful login to gemini.google.com/app...');

      const startTime = Date.now();
      const timeoutMs = 5 * 60 * 1000;
      let email = 'unknown@gmail.com';
      let plan: 'PRO' | 'ULTRA' | 'FREE' | 'UNKNOWN' = 'PRO';

      while (Date.now() - startTime < timeoutMs) {
        await page.waitForTimeout(2000);
        const url = page.url();

        if (url.includes('gemini.google.com/app') || url.includes('gemini.google.com')) {
          const cookies = await context.cookies('https://gemini.google.com');
          const hasAuthCookie = cookies.some(
            (c) => c.name === '__Secure-1PSID' || c.name === 'SID'
          );

          if (hasAuthCookie) {
            const hasChatInput = await page
              .locator('div[contenteditable="true"], textarea, rich-textarea')
              .first()
              .isVisible()
              .catch(() => false);

            if (hasChatInput) {
              try {
                // Check account button or avatar for email
                const profileBtn = page.locator('button[aria-label*="Google Account"], a[aria-label*="Google Account"], [aria-label*="@"]').first();
                if (await profileBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                  const ariaLabel = (await profileBtn.getAttribute('aria-label')) || '';
                  const emailMatch = ariaLabel.match(/([a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/);
                  if (emailMatch) {
                    email = emailMatch[1];
                  }
                }

                if (email === 'unknown@gmail.com') {
                  const detectedEmail = await page.evaluate(() => {
                    const el = document.querySelector('[aria-label*="@"], img[alt*="@"], [data-email]');
                    if (el) {
                      const txt = el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('data-email') || '';
                      const m = txt.match(/([a-zA-Z0-9._+-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/);
                      return m ? m[1] : null;
                    }
                    return null;
                  });
                  if (detectedEmail) email = detectedEmail;
                }
              } catch {
                // DOM inspect fallback
              }

              const pageText = await page.textContent('body').catch(() => '');
              if (pageText?.includes('Pro') || pageText?.includes('PRO')) {
                plan = 'PRO';
              } else if (pageText?.includes('Ultra') || pageText?.includes('ULTRA')) {
                plan = 'ULTRA';
              }

              break;
            }
          }
        }
      }

      await context.close();

      if (isRelogin && targetAccountId) {
        const existing = this.usageStore.getAccountsData().accounts.find((a) => a.id === targetAccountId);
        const resolvedEmail = email !== 'unknown@gmail.com' ? email : (existing?.email || `${targetAccountId}@gmail.com`);
        const account: AccountMetadata = {
          id: targetAccountId,
          email: resolvedEmail,
          alias: alias || existing?.alias || resolvedEmail,
          plan,
          createdAt: existing?.createdAt || new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
          isActive: true,
          status: 'active',
        };

        this.usageStore.addOrUpdateAccount(account);
        this.usageStore.setActiveAccount(account.id);
        console.log(`[SessionManager] Successfully re-authenticated: ${account.email} (${account.plan})`);
        return account;
      }

      const sanitizedEmailId = email.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      const finalAccountId = sanitizedEmailId !== 'unknown_gmail_com' ? sanitizedEmailId : tempId;

      const finalProfileDir = this.getProfileDir(finalAccountId);
      if (finalAccountId !== tempId && fs.existsSync(profileDir)) {
        if (fs.existsSync(finalProfileDir)) {
          fs.rmSync(finalProfileDir, { recursive: true, force: true });
        }
        fs.renameSync(profileDir, finalProfileDir);
      }

      const account: AccountMetadata = {
        id: finalAccountId,
        email: email !== 'unknown@gmail.com' ? email : `${finalAccountId}@gmail.com`,
        alias: alias || (email !== 'unknown@gmail.com' ? email : 'Default Account'),
        plan,
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        isActive: true,
        status: 'active',
      };

      this.usageStore.addOrUpdateAccount(account);
      this.usageStore.setActiveAccount(account.id);

      console.log(`[SessionManager] Successfully logged in as: ${account.email} (${account.plan})`);
      return account;
    } catch (err) {
      await context.close().catch(() => {});
      throw err;
    }
  }

  async reloginInteractive(accountId: string): Promise<AccountMetadata> {
    const existing = this.usageStore.getAccountsData().accounts.find((a) => a.id === accountId);
    return this.loginInteractive(existing?.alias, accountId);
  }

  getActiveAccount(): AccountMetadata | null {
    return this.usageStore.getActiveAccount();
  }

  listAccounts(): AccountMetadata[] {
    const data = this.usageStore.getAccountsData();
    const now = new Date();

    // Check if any cooldown has expired
    for (const acc of data.accounts) {
      if (acc.status === 'rate-limited' && acc.cooldownUntil) {
        if (now >= new Date(acc.cooldownUntil)) {
          acc.status = 'active';
          delete acc.cooldownUntil;
          this.usageStore.addOrUpdateAccount(acc);
        }
      }
    }

    return data.accounts;
  }

  markAccountRateLimited(accountId: string, cooldownUntil?: string): void {
    const data = this.usageStore.getAccountsData();
    const target = data.accounts.find((a) => a.id === accountId);
    if (target) {
      target.status = 'rate-limited';
      // Default cooldown: 3 hours if not specified
      target.cooldownUntil = cooldownUntil || new Date(Date.now() + 3 * 3600 * 1000).toISOString();
      this.usageStore.addOrUpdateAccount(target);
    }
  }

  markAccountNeedsLogin(accountId: string): void {
    const data = this.usageStore.getAccountsData();
    const target = data.accounts.find((a) => a.id === accountId);
    if (target) {
      target.status = 'needs_login';
      this.usageStore.addOrUpdateAccount(target);
    }
  }

  /**
   * Finds the next available non-rate-limited account to rotate to.
   */
  findAvailableAccount(): AccountMetadata | null {
    const accounts = this.listAccounts();
    return accounts.find((a) => a.status === 'active') || null;
  }

  /**
   * Finds the account with the earliest cooldown expiration.
   */
  getEarliestResetAccount(): { account: AccountMetadata; cooldownUntil: string } | null {
    const accounts = this.listAccounts();
    const rateLimited = accounts.filter((a) => a.status === 'rate-limited' && a.cooldownUntil);
    if (rateLimited.length === 0) return null;

    rateLimited.sort(
      (a, b) => new Date(a.cooldownUntil!).getTime() - new Date(b.cooldownUntil!).getTime()
    );

    return {
      account: rateLimited[0],
      cooldownUntil: rateLimited[0].cooldownUntil!,
    };
  }

  switchAccount(accountId: string): boolean {
    return this.usageStore.setActiveAccount(accountId);
  }

  logout(accountId: string): boolean {
    const profileDir = path.join(PROFILES_DIR, accountId);
    if (fs.existsSync(profileDir)) {
      try {
        fs.rmSync(profileDir, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    }
    return this.usageStore.removeAccount(accountId);
  }
}
