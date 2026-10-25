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
