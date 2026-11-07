import { fetchDisplayPage } from './paginateScripts';
import { invoke } from '@tauri-apps/api/core';
import type { Script } from './scriptbloxApi';

interface RScript {
  id: string;
  title: string;
  slug: string;
  description?: string | null;
  views?: number;
  imageUrl?: string;
  isKeySystem?: boolean;
  isPaid?: boolean;
  isPatched?: boolean;
  script?: string;
  createdAt?: string;
  game?: { placeId: string; title: string; thumbnailUrl?: string };
  creator?: { isVerified?: boolean };
}

function imageUrl(path?: string) {
  return path ? new URL(path, 'https://rscripts.net').href : '';
}

export async function fetchRScripts(query: string, page: number, sort: string, pageSize = 32) {
  const result = await fetchDisplayPage(page, async sourcePage => {
    const response = await invoke<{ success: boolean; data: RScript[]; meta: { totalPages: number } }>('fetch_rscripts', { query, page: sourcePage, sort });
    if (!response.success || !Array.isArray(response.data)) throw new Error('Unexpected response from RScripts.');
    return { scripts: response.data, totalPages: response.meta.totalPages };
  }, 200, pageSize);
  const scripts: Script[] = result.scripts.map((item) => ({
    _id: item.id, slug: item.slug, title: item.title, views: item.views ?? 0,
    script: item.script ?? '', image: imageUrl(item.imageUrl), description: item.description ?? undefined,
    game: { _id: item.game?.placeId ?? '', name: item.game?.title ?? '', imageUrl: imageUrl(item.game?.thumbnailUrl) },
    verified: !!item.creator?.isVerified, key: !!item.isKeySystem, isPatched: !!item.isPatched,
    scriptType: item.isPaid ? 'paid' : 'free', isUniversal: false, createdAt: item.createdAt ?? '',
  }));
  return { scripts, totalPages: result.totalPages };
}

