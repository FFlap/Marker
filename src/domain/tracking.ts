import { bookmarkKey, mergeBookmark, normalizeBookmarkStore } from './bookmarks';
import type { EpisodeBookmark } from './types';
import { BOOKMARKS_STORAGE_KEY } from '../messages';

export interface LocalStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export async function persistDetectedEpisode(
  storage: LocalStorageArea,
  bookmark: EpisodeBookmark,
): Promise<boolean> {
  const stored = await storage.get(BOOKMARKS_STORAGE_KEY);
  const current = normalizeBookmarkStore(stored[BOOKMARKS_STORAGE_KEY]);
  const previous =
    current.bookmarks[bookmarkKey(bookmark)] ??
    current.bookmarks[bookmark.seriesId];

  if (
    previous?.episodeId === bookmark.episodeId &&
    previous.seasonNumber === bookmark.seasonNumber &&
    previous.episodeNumber === bookmark.episodeNumber
  ) {
    return false;
  }

  await storage.set({
    [BOOKMARKS_STORAGE_KEY]: mergeBookmark(current, bookmark),
  });
  return true;
}
