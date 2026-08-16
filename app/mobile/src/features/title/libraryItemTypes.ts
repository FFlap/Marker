import type { LibraryEntryDraft } from '@/components/LibraryEntryDrawer';

export const statusOptions = [
  { label: 'Watched', value: 'watched' },
  { label: 'Watching', value: 'watching' },
  { label: 'Watchlist', value: 'watchlist' },
  { label: 'Dropped', value: 'dropped' },
] as const;

export type Detail = {
  tmdbId?: number;
  title: string;
  posterPath?: string;
  overview?: string;
  releaseDate?: string;
  firstAirDate?: string;
  runtime?: number;
  episodeRunTime?: number[];
  genres?: string[];
  seasons?: { season: number; name: string; episodeCount: number }[];
  cast?: { name: string; character: string; profilePath?: string }[];
  metadataProvider?: 'tmdb' | 'tvdb';
  tvdbId?: number;
  seasonOrder?: string;
  orderEpoch?: number;
};
export type Episode = {
  season: number;
  episode: number;
  name: string;
  overview?: string;
  runtime?: number;
  imageUrl?: string;
  airDate?: string;
};
export type SeasonRow = {
  season: number;
  metadataProvider: 'tmdb' | 'tvdb';
  orderEpoch: number;
  totalCount: number;
};
export type ItemDraft = LibraryEntryDraft;
export type EpisodeDraft = { rating?: number; tags: string[] };

export function selectAvailableSeason(
  seasons: { season: number }[] | undefined,
  selectedSeason: number,
) {
  const firstSeason = seasons?.find((entry) => entry.season > 0)?.season ?? 1;
  return seasons?.some((entry) => entry.season === selectedSeason) === false
    ? firstSeason
    : selectedSeason;
}

export const sameValue = (left: unknown, right: unknown) =>
  Array.isArray(left) && Array.isArray(right)
    ? left.length === right.length && left.every((value, index) => value === right[index])
    : left === right;

export function isStaleSeasonError(error: unknown) {
  const data =
    typeof error === 'object' && error !== null && 'data' in error
      ? (error as { data?: { code?: unknown } }).data
      : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return (
    data?.code === 'stale_epoch' ||
    /stale.?epoch/i.test(message) ||
    /season metadata changed/i.test(message)
  );
}
