import type { FunctionReturnType } from 'convex/server';
import type { api } from '@convex/_generated/api';
import type { LibraryEntryDraft } from '@/components/LibraryEntryDrawer';

export const statusOptions = [
  { label: 'Watched', value: 'watched' },
  { label: 'Watching', value: 'watching' },
  { label: 'Watchlist', value: 'watchlist' },
  { label: 'Dropped', value: 'dropped' },
] as const;

type SeasonPage = FunctionReturnType<
  typeof api.resolvedMetadata.reads.getSeasonView
>['page'][number];
export type Episode = SeasonPage['episodes'][number];
export type SeasonRow = Omit<SeasonPage, 'episodes' | 'chunkIndex'>;
export type ItemDraft = LibraryEntryDraft;
export type EpisodeDraft = { rating?: number; tags: string[] };

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
