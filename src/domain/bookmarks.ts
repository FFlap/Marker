import type { BookmarkStore, EpisodeBookmark } from './types';

export const EMPTY_BOOKMARK_STORE: BookmarkStore = {
  version: 1,
  bookmarks: {},
};

export function bookmarkKey(bookmark: Pick<EpisodeBookmark, 'platform' | 'seriesId'>) {
  return `${bookmark.platform ?? 'crunchyroll'}:${bookmark.seriesId}`;
}

function isBookmark(value: unknown): value is EpisodeBookmark {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.seriesId === 'string' &&
    typeof item.seriesTitle === 'string' &&
    typeof item.seriesUrl === 'string' &&
    typeof item.seasonNumber === 'string' &&
    typeof item.episodeNumber === 'string' &&
    typeof item.episodeTitle === 'string' &&
    typeof item.episodeId === 'string' &&
    typeof item.watchUrl === 'string' &&
    typeof item.updatedAt === 'number'
  );
}

export function normalizeBookmarkStore(value: unknown): BookmarkStore {
  if (!value || typeof value !== 'object') return { ...EMPTY_BOOKMARK_STORE, bookmarks: {} };
  const candidate = value as { version?: unknown; bookmarks?: unknown };
  if (
    candidate.version !== 1 ||
    !candidate.bookmarks ||
    typeof candidate.bookmarks !== 'object' ||
    Array.isArray(candidate.bookmarks)
  ) {
    return { ...EMPTY_BOOKMARK_STORE, bookmarks: {} };
  }

  const bookmarks = Object.fromEntries(
    Object.entries(candidate.bookmarks).filter(([, bookmark]) => isBookmark(bookmark)),
  );
  return { version: 1, bookmarks };
}

export function mergeBookmark(
  store: BookmarkStore,
  bookmark: EpisodeBookmark,
): BookmarkStore {
  const bookmarks = { ...store.bookmarks };
  delete bookmarks[bookmark.seriesId];
  return {
    version: 1,
    bookmarks: {
      ...bookmarks,
      [bookmarkKey(bookmark)]: bookmark,
    },
  };
}

export function sortBookmarks(
  bookmarks: Record<string, EpisodeBookmark>,
): EpisodeBookmark[] {
  return Object.values(bookmarks).sort((left, right) => right.updatedAt - left.updatedAt);
}
