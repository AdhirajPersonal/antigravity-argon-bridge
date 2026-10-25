import fs from 'fs';
import { THREADS_FILE, ensureDirsExist } from '../config.js';

export interface ThreadRecord {
  threadUrl: string;
  accountId: string;
  lastUsedAt: string;
}

export interface ThreadStoreData {
  threads: Record<string, ThreadRecord>;
}

export class ThreadStore {
  constructor() {
    ensureDirsExist();
  }

  private getData(): ThreadStoreData {
    if (!fs.existsSync(THREADS_FILE)) {
      return { threads: {} };
    }
    try {
      return JSON.parse(fs.readFileSync(THREADS_FILE, 'utf-8'));
    } catch {
      return { threads: {} };
    }
  }

  private saveData(data: ThreadStoreData): void {
    ensureDirsExist();
    fs.writeFileSync(THREADS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  }

  getThread(sessionId: string, accountId?: string): ThreadRecord | null {
    const data = this.getData();
    if (accountId) {
      const compoundKey = `${sessionId}__${accountId}`;
      if (data.threads[compoundKey]) return data.threads[compoundKey];
      if (data.threads[sessionId]?.accountId === accountId) return data.threads[sessionId];
      return null;
    }
    return data.threads[sessionId] || null;
  }

  getMostRecentThread(accountId?: string): { sessionId: string; thread: ThreadRecord } | null {
    const data = this.getData();
    let mostRecent: { sessionId: string; thread: ThreadRecord } | null = null;
    let latestTime = 0;
    for (const [key, rec] of Object.entries(data.threads)) {
      if (accountId && rec.accountId !== accountId) continue;
      const t = new Date(rec.lastUsedAt).getTime();
      if (t > latestTime) {
        latestTime = t;
        const cleanSessionId = key.includes('__') ? key.split('__')[0] : key;
        mostRecent = { sessionId: cleanSessionId, thread: rec };
      }
    }
    return mostRecent;
  }

  setThread(sessionId: string, threadUrl: string, accountId: string): void {
    const data = this.getData();
    const compoundKey = `${sessionId}__${accountId}`;
    const rec: ThreadRecord = {
      threadUrl,
      accountId,
      lastUsedAt: new Date().toISOString(),
    };
    data.threads[compoundKey] = rec;
    data.threads[sessionId] = rec;
    this.saveData(data);
  }

  resetThread(sessionId: string, accountId?: string): void {
    const data = this.getData();
    if (accountId) {
      delete data.threads[`${sessionId}__${accountId}`];
      if (data.threads[sessionId]?.accountId === accountId) {
        delete data.threads[sessionId];
      }
    } else {
      delete data.threads[sessionId];
      for (const k of Object.keys(data.threads)) {
        if (k.startsWith(`${sessionId}__`)) {
          delete data.threads[k];
        }
      }
    }
    this.saveData(data);
  }

  clearAll(): void {
    this.saveData({ threads: {} });
  }
}
