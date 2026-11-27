import type { Status } from '@/types';
import { compareTitles } from './text';

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

export type LibrarySort = 'custom' | 'title' | 'rating' | 'added' | 'updated';

export const LIBRARY_SORTS = [
  { value: 'custom', label: 'Your order' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'added', label: 'Recently added' },
  { value: 'updated', label: 'Recently updated' },
] as const satisfies readonly { value: LibrarySort; label: string }[];

type Sortable = {
  title: string;
  rating?: number;
  createdAt: number;
  updatedAt: number;
};

/** Returns a sorted copy, or the same order for the user's own ranking. */
export function sortLibraryItems<T extends Sortable>(items: readonly T[], sort: LibrarySort): T[] {
  if (sort === 'custom') return [...items];
  const sorted = [...items];
  if (sort === 'title') sorted.sort((left, right) => compareTitles(left.title, right.title));
  if (sort === 'rating') sorted.sort((left, right) => (right.rating ?? -1) - (left.rating ?? -1));
  if (sort === 'added') sorted.sort((left, right) => right.createdAt - left.createdAt);
  if (sort === 'updated') sorted.sort((left, right) => right.updatedAt - left.updatedAt);
  return sorted;
}

/** Watching also covers watched shows that are listed there too (see `isAlsoWatching`). */
export function matchesStatus(
  item: { status: Status },
  filter: StatusFilter,
  alsoWatching = false,
) {
  if (filter === 'all' || item.status === filter) return true;
  return filter === 'watching' && alsoWatching;
}

type AlsoWatchingItem = {
  status: Status;
  mediaType: 'movie' | 'tv';
  alsoWatching?: boolean;
  nextEpisode?: { airDate?: string; undatedReleased?: boolean };
};

/**
 * Whether a watched show is also listed under Watching: automatically while a new episode
 * is out, or by hand (Edit entry) when the automatic setting is off.
 */
export function isAlsoWatching(item: AlsoWatchingItem, automatic: boolean, today: string) {
  if (item.status !== 'watched' || item.mediaType !== 'tv') return false;
  if (!automatic) return !!item.alsoWatching;
  const next = item.nextEpisode;
  return !!next && (next.airDate !== undefined ? next.airDate <= today : !!next.undatedReleased);
}
