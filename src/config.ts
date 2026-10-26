import path from 'path';
import os from 'os';
import fs from 'fs';

// Base directory for persistent profiles and data: ~/.gemini/argon-extension
export const BASE_DATA_DIR = path.join(os.homedir(), '.gemini', 'argon-extension');
export const PROFILES_DIR = path.join(BASE_DATA_DIR, 'profiles');
export const ACCOUNTS_FILE = path.join(BASE_DATA_DIR, 'accounts.json');
export const USAGE_FILE = path.join(BASE_DATA_DIR, 'usage.json');
export const THREADS_FILE = path.join(BASE_DATA_DIR, 'threads.json');
export const SETTINGS_FILE = path.join(BASE_DATA_DIR, 'settings.json');

// Ensure necessary data directories exist
export function ensureDirsExist() {
  if (!fs.existsSync(BASE_DATA_DIR)) {
    fs.mkdirSync(BASE_DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
  }
}

export interface BrowserStatus {
  /** True when the browser build pinned by playwright-core is present on disk. */
  installed: boolean;
  /** Absolute path Playwright will launch (may not exist yet). */
  executablePath: string;
  /** Pinned Chromium revision, e.g. "1248". */
  revision: string;
  /** Chrome for Testing version, e.g. "156.0.8078.4". */
  version: string;
  /** Command that provisions the exact pinned build (uses the bundled CLI). */
  installCommand: string;
}

let cachedBrowserStatus: BrowserStatus | null = null;

/**
 * Resolves the Playwright browser pinned by the bundled playwright-core.
 *
 * Why this exists: the browser binary is NOT shipped inside the VSIX. It is
 * pinned to an exact revision in `playwright-core/browsers.json`
 * (e.g. chromium-1248) and must be downloaded to the Playwright cache
 * (`~/Library/Caches/ms-playwright` on macOS) after install. VS Code / Antigravity
 * only unpack a VSIX and never run `npm install`, so the `postinstall:
 * playwright install chromium` hook never fires from the marketplace. Every
 * Playwright bump also changes the revision, so an existing cache silently stops
 * matching and `launchPersistentContext` dies with a raw
 * "Executable doesn't exist at .../chromium-<rev>/...".
 *
 * The install command deliberately targets the *bundled* CLI, not a global
 * `npx playwright`, so the downloaded revision always matches this build.
 */
export function getBrowserStatus(useCache = true): BrowserStatus {
  if (useCache && cachedBrowserStatus) return cachedBrowserStatus;

  const extensionRoot = path.resolve(__dirname, '..');
  let executablePath = '';
  let revision = '';
  let version = '';
  let cliPath = '';

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const { chromium } = require('playwright') as typeof import('playwright');
    executablePath = chromium.executablePath() || '';
  } catch {
    // Handled by the caller as "Playwright could not be loaded".
  }

  try {
    cliPath = require.resolve('playwright-core/cli.js', { paths: [extensionRoot] });
  } catch {
    try {
      const pkgJson = require.resolve('playwright-core/package.json', { paths: [extensionRoot] });
      cliPath = path.join(path.dirname(pkgJson), 'cli.js');
    } catch {
      cliPath = '';
    }
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const browsersJson = require(path.join(path.dirname(cliPath), 'browsers.json'));
    const entry = browsersJson?.browsers?.find((b: any) => b.name === 'chromium');
    if (entry) {
      revision = String(entry.revision);
      version = String(entry.browserVersion);
    }
  } catch {
    // best-effort metadata only
  }

  const installCommand = cliPath
    ? `"${process.execPath}" "${cliPath}" install chromium`
    : 'npx playwright install chromium';

  cachedBrowserStatus = {
    installed: !!executablePath && fs.existsSync(executablePath),
    executablePath,
    revision,
    version,
    installCommand,
  };
  return cachedBrowserStatus;
}

/**
 * Fails fast with an actionable message when the Playwright browser is missing,
 * instead of surfacing the raw Playwright launch error.
 */
export function assertBrowserInstalled(): void {
  const status = getBrowserStatus(false);
  if (status.installed) return;

  throw new Error(
    [
      `Argon requires a Playwright Chromium download that is missing${
        status.revision ? ` (chromium-${status.revision}${status.version ? `, Chrome for Testing ${status.version}` : ''})` : ''
      }.`,
      'It is not bundled in the VSIX and must be downloaded once per Playwright version.',
      status.executablePath ? `Expected at: ${status.executablePath}` : '',
      '',
      'Fix it by running either:',
      '  - Command Palette: "Argon: Install / Repair Chromium Browser" (one click)',
      `  - Terminal: ${status.installCommand}`,
    ]
      .filter(Boolean)
      .join('\n')
  );
}

export type ThinkingLevel = 'low' | 'medium' | 'high';
export type ThinkingModeSetting = 'auto' | 'low' | 'medium' | 'high';

export interface SettingsData {
  forcedThinkingLevel: ThinkingModeSetting;
}

export function getSettings(): SettingsData {
  ensureDirsExist();
  if (!fs.existsSync(SETTINGS_FILE)) {
    const defaultSettings: SettingsData = { forcedThinkingLevel: 'auto' };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaultSettings, null, 2), 'utf-8');
    return defaultSettings;
  }
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
  } catch {
    return { forcedThinkingLevel: 'auto' };
  }
}

export function saveSettings(settings: SettingsData): void {
  ensureDirsExist();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
}

export interface AccountMetadata {
  id: string;             // Unique identifier e.g. 'acc_1', or sanitized email
  email: string;          // Google account email
  alias: string;          // User-friendly display name (e.g. "Work Pro", "Jio Pro")
  plan: 'PRO' | 'ULTRA' | 'FREE' | 'UNKNOWN';
  createdAt: string;
  lastUsedAt: string;
  isActive: boolean;
  status: 'active' | 'rate-limited' | 'expired' | 'unverified' | 'needs_login' | 'logged_out';
  cooldownUntil?: string; // ISO date timestamp if account is currently rate-limited
}

export interface OfficialUsageLimits {
  plan: string;
  currentUsagePercent: number;
  currentResetTime: string;
  weeklyLimitPercent: number;
  weeklyResetDate: string;
  lastUpdated: string;
}

export interface LocalTokenMetrics {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTurns: number;
  todayInputTokens: number;
  todayOutputTokens: number;
  todayTurns: number;
  todayDate: string; // YYYY-MM-DD
}
