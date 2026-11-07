import { listen } from '@tauri-apps/api/event';

export type ConsoleLogLevel = 'info' | 'warning' | 'error' | 'success' | 'status';

export interface ConsoleLogEntry {
  id: string;
  level: ConsoleLogLevel;
  message: string;
  timestamp: Date;
  username?: string;
}

interface ConsoleLogPayload {
  level?: string;
  message?: string;
  username?: string;
}

let logs: ConsoleLogEntry[] = [];
const listeners = new Set<() => void>();
const sessions = new Map<string, { username: string; pid?: number }>();
let accounts: string[] = [];
export function getConsoleAccounts(): string[] { return accounts; }
export function getConsoleUsernameForPid(pid: number): string | undefined { return [...sessions.values()].find(session => session.pid === pid)?.username; }

let initialization: Promise<void> | null = null;

function notify(): void {
  listeners.forEach((listener) => listener());
}

function normalizeLevel(level?: string): ConsoleLogLevel {
  if (level === 'warning' || level === 'error' || level === 'success' || level === 'status') {
    return level;
  }
  return 'info';
}

function nextId(): string {
  return `console_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export async function initializeConsoleListener(): Promise<void> {
  if (!initialization) {
    initialization = (async () => {
      await listen<{ clientId: string; username?: string; pid?: number; connected: boolean }>('console-session', (event) => {
        const { clientId, username, pid, connected } = event.payload;
        if (connected && username) sessions.set(clientId, { username, pid });
        else if (!connected) sessions.delete(clientId);
        accounts = [...new Set([...sessions.values()].map(session => session.username))].sort((a, b) => a.localeCompare(b));
        notify();
      });
      await listen<ConsoleLogPayload>('console-log', (event) => appendConsoleLog({
        level: normalizeLevel(event.payload?.level), message: event.payload?.message ?? '',
        username: event.payload?.username || undefined,
      }));
    })().catch((error) => { initialization = null; throw error; });
  }
  await initialization;
}

export function appendConsoleLog(entry: Omit<ConsoleLogEntry, 'id' | 'timestamp'>): void {
  logs = [
    ...logs,
    {
      id: nextId(),
      timestamp: new Date(),
      ...entry,
    },
  ].slice(-500);

  notify();
}

export function clearConsoleLogs(): void {
  if (logs.length === 0) return;
  logs = [];
  notify();
}

export function getConsoleLogs(): ConsoleLogEntry[] {
  return [...logs];
}

export function subscribeToConsoleLogs(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
