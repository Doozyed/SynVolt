import { invoke } from '@tauri-apps/api/core';

let favorites: Set<string> = new Set();
let listeners: Set<() => void> = new Set();
let initialized = false;
let pendingSave = Promise.resolve();

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

let loadingFavorites: Promise<void> | null = null;
export async function loadFavorites(): Promise<void> {
  if (initialized) return;
  if (!loadingFavorites) loadingFavorites = (async () => {
    try {
      const data = await invoke<string[]>('load_favorites');
      if (Array.isArray(data)) favorites = new Set(data);
      initialized = true;
      notifyListeners();
    } catch { initialized = true; }
  })();
  await loadingFavorites;
}

async function saveFavorites(): Promise<void> {
  const snapshot = Array.from(favorites);
  pendingSave = pendingSave.then(async () => {
  try {
    await invoke('save_favorites', { favorites: snapshot });
  } catch {}
  });
  await pendingSave;
}

export function isFavorite(identifier: string): boolean {
  return favorites.has(identifier);
}

export function isFavoriteByPath(filePath: string): boolean {
  return favorites.has(filePath);
}

export function toggleFavorite(identifier: string): void {
  if (favorites.has(identifier)) {
    favorites.delete(identifier);
  } else {
    favorites.add(identifier);
  }
  notifyListeners();
  saveFavorites();
}

export function toggleFavoriteByPath(filePath: string): void {
  if (favorites.has(filePath)) {
    favorites.delete(filePath);
  } else {
    favorites.add(filePath);
  }
  notifyListeners();
  saveFavorites();
}

export function getFavorites(): string[] {
  return Array.from(favorites);
}

export function moveFavorite(oldPath: string, newPath: string): void {
  const match = Array.from(favorites).find(path => path.toLowerCase() === oldPath.toLowerCase());
  if (!match) return;
  favorites.delete(match);
  favorites.add(newPath);
  notifyListeners();
  void saveFavorites();
}

export function subscribeToFavorites(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function isFavoritesInitialized(): boolean {
  return initialized;
}
