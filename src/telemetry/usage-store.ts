import fs from 'fs';
import {
  ACCOUNTS_FILE,
  USAGE_FILE,
  ensureDirsExist,
  AccountMetadata,
  OfficialUsageLimits,
  LocalTokenMetrics,
} from '../config.js';

export interface AccountsData {
  activeAccountId: string | null;
  accounts: AccountMetadata[];
}

export interface AccountUsageRecord {
  accountId: string;
  officialLimits?: OfficialUsageLimits;
  metrics: LocalTokenMetrics;
  history: Array<{
    timestamp: string;
    inputTokens: number;
    outputTokens: number;
    thinkingLevel: string;
  }>;
}

export interface UsageStoreData {
  records: Record<string, AccountUsageRecord>;
}

export class UsageStore {
  constructor() {
    ensureDirsExist();
  }

  // --- Account Management Persistence ---

  getAccountsData(): AccountsData {
    if (!fs.existsSync(ACCOUNTS_FILE)) {
      return { activeAccountId: null, accounts: [] };
    }
    try {
      const raw = fs.readFileSync(ACCOUNTS_FILE, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return { activeAccountId: null, accounts: [] };
    }
  }

  saveAccountsData(data: AccountsData): void {
    ensureDirsExist();
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  }

  getActiveAccount(): AccountMetadata | null {
    const data = this.getAccountsData();
    if (!data.activeAccountId || data.accounts.length === 0) return null;
    return data.accounts.find((a) => a.id === data.activeAccountId) || data.accounts[0] || null;
  }

  setActiveAccount(accountId: string): boolean {
    const data = this.getAccountsData();
    const target = data.accounts.find((a) => a.id === accountId || a.email === accountId);
    if (!target) return false;

    for (const acc of data.accounts) {
      acc.isActive = acc.id === target.id;
    }
    data.activeAccountId = target.id;
    this.saveAccountsData(data);
    return true;
  }

  addOrUpdateAccount(account: AccountMetadata): void {
    const data = this.getAccountsData();
    const existingIndex = data.accounts.findIndex(
      (a) => a.id === account.id || a.email.toLowerCase() === account.email.toLowerCase()
    );

    if (existingIndex >= 0) {
      data.accounts[existingIndex] = {
        ...data.accounts[existingIndex],
        ...account,
      };
    } else {
      if (data.accounts.length === 0) {
        account.isActive = true;
        data.activeAccountId = account.id;
      }
      data.accounts.push(account);
    }

    if (!data.activeAccountId && data.accounts.length > 0) {
      data.activeAccountId = data.accounts[0].id;
      data.accounts[0].isActive = true;
    }

    this.saveAccountsData(data);
  }

  removeAccount(accountId: string): boolean {
    const data = this.getAccountsData();
    const idx = data.accounts.findIndex((a) => a.id === accountId || a.email === accountId);
    if (idx === -1) return false;

    data.accounts.splice(idx, 1);
    if (data.activeAccountId === accountId) {
      data.activeAccountId = data.accounts.length > 0 ? data.accounts[0].id : null;
      if (data.activeAccountId) {
        data.accounts[0].isActive = true;
      }
    }
    this.saveAccountsData(data);
    return true;
  }

  // --- Usage & Token Telemetry ---

  getUsageData(): UsageStoreData {
    if (!fs.existsSync(USAGE_FILE)) {
      return { records: {} };
    }
    try {
      const raw = fs.readFileSync(USAGE_FILE, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return { records: {} };
    }
  }

  saveUsageData(data: UsageStoreData): void {
    ensureDirsExist();
    fs.writeFileSync(USAGE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  }

  getAccountUsage(accountId: string): AccountUsageRecord {
    const data = this.getUsageData();
    const today = new Date().toISOString().split('T')[0];

    if (!data.records[accountId]) {
      data.records[accountId] = {
        accountId,
        metrics: {
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTurns: 0,
          todayInputTokens: 0,
          todayOutputTokens: 0,
          todayTurns: 0,
          todayDate: today,
        },
        history: [],
      };
    }

    // Reset daily counters if day has changed
    const record = data.records[accountId];
    if (record.metrics.todayDate !== today) {
      record.metrics.todayDate = today;
      record.metrics.todayInputTokens = 0;
      record.metrics.todayOutputTokens = 0;
      record.metrics.todayTurns = 0;
    }

    return record;
  }

  recordTurn(
    accountId: string,
    inputTokens: number,
    outputTokens: number,
    thinkingLevel: string
  ): void {
    const data = this.getUsageData();
    const record = this.getAccountUsage(accountId);

    record.metrics.totalInputTokens += inputTokens;
    record.metrics.totalOutputTokens += outputTokens;
    record.metrics.totalTurns += 1;

    record.metrics.todayInputTokens += inputTokens;
    record.metrics.todayOutputTokens += outputTokens;
    record.metrics.todayTurns += 1;

    record.history.push({
      timestamp: new Date().toISOString(),
      inputTokens,
      outputTokens,
      thinkingLevel,
    });

    // Keep history to last 100 turns
    if (record.history.length > 100) {
      record.history = record.history.slice(-100);
    }

    data.records[accountId] = record;
    this.saveUsageData(data);
  }

  updateOfficialLimits(accountId: string, limits: OfficialUsageLimits): void {
    const data = this.getUsageData();
    const record = this.getAccountUsage(accountId);
    record.officialLimits = limits;
    data.records[accountId] = record;
    this.saveUsageData(data);
  }
}
