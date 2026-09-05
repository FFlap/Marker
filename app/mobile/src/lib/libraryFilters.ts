import type { Status } from '@/types';

export type MediaTypeFilter = 'all' | 'movie' | 'tv' | 'anime';
export type StatusFilter = 'all' | Status;

export const LIBRARY_STATUSES = [
  ['watched', 'Watched'],
  ['watching', 'Watching'],
  ['watchlist', 'Watchlist'],
  ['dropped', 'Dropped'],
] as const satisfies readonly (readonly [Status, string])[];

export function matchesMediaType(
  item: { mediaType: 'movie' | 'tv'; isAnime: boolean },
  filter: MediaTypeFilter,
) {
  if (filter === 'all') return true;
  if (filter === 'anime') return item.isAnime;
  return item.mediaType === filter && !item.isAnime;
}
