import { invoke } from '@tauri-apps/api/core';

export type ClientSettingValue = boolean | number | string | null;
export type ClientSynSettings = Record<string, ClientSettingValue>;

let settings: ClientSynSettings = {};
const listeners = new Set<() => void>();
let pendingUpdate: Promise<void> = Promise.resolve();

function notify(): void {
  listeners.forEach((listener) => listener());
}

function cloneSettings(): ClientSynSettings {
  return { ...settings };
}

function normalizeSettings(value: unknown): ClientSynSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const result: ClientSynSettings = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (
      typeof entry === 'boolean' ||
      typeof entry === 'number' ||
      typeof entry === 'string' ||
      entry === null
    ) {
      result[key] = entry;
    }
  }

  return result;
}

export async function loadClientSettings(): Promise<ClientSynSettings> {
  await pendingUpdate;
  try {
    const loaded = await invoke<unknown>('load_client_settings_syn');
    settings = normalizeSettings(loaded);
  } catch (error) {
    console.error('Failed to load settings.syn:', error);
    settings = {};
  }

  notify();
  return cloneSettings();
}

export function getClientSettings(): ClientSynSettings {
  return cloneSettings();
}

export async function saveClientSettings(nextSettings: ClientSynSettings): Promise<void> {
  settings = { ...nextSettings };
  notify();

  try {
    await invoke('save_client_settings_syn', { settings });

  } catch (error) {
    console.error('Failed to save settings.syn:', error);
  }
}

export async function updateClientSynSetting(key: string, value: ClientSettingValue): Promise<void> {
  const update = pendingUpdate.then(async () => {
    const saved = await invoke<unknown>('update_client_setting_syn', { key, value });
    settings = normalizeSettings(saved);

    notify();
  });
  pendingUpdate = update.catch(() => {});
  await update;
}

export function subscribeToClientSettings(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}
