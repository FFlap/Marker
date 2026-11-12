import { ConvexError } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import { isEpisodeReleased } from '../episodeAvailability';

export type SeriesWatch = NonNullable<Doc<'items'>['seriesWatch']>;
type Episode = {
  episode: number;
  name?: string;
  overview?: string;
  imageUrl?: string;
  airDate?: string;
  providerEpisodeId?: number;
};

export function assertSeriesWatchGeneration(item: Doc<'items'>, generation?: string) {
  if (generation !== undefined && item.seriesWatch?.generation !== generation)
    throw new ConvexError({
      code: 'series_watch_superseded',
      message: 'A newer whole-series watch superseded this hydration',
    });
}

// These records come from the canonical released-episode catalog. An undated
// canonical episode is already known released; a dated episode still respects the cutoff.
export const seriesWatchIncludes = (watch: SeriesWatch | undefined, episode: Episode) =>
  !!watch &&
  (!episode.airDate ||
    isEpisodeReleased(
      { ...episode, name: episode.name ?? `Episode ${episode.episode}` },
      watch.watchedAt,
    ));

const matchesIdentity = (
  saved: Doc<'episodes'>,
  identity: { metadataProvider: 'tmdb' | 'tvdb'; seasonOrder?: string; providerEpisodeId?: number },
) =>
  saved.metadataProvider === identity.metadataProvider &&
  saved.seasonOrder === (identity.metadataProvider === 'tvdb' ? identity.seasonOrder : undefined) &&
  (identity.providerEpisodeId === undefined ||
    saved.providerEpisodeId === identity.providerEpisodeId);

export function currentSeriesOverride(
  watch: SeriesWatch | undefined,
  saved: Doc<'episodes'> | null | undefined,
  canonical: {
    metadataProvider: 'tmdb' | 'tvdb';
    seasonOrder?: string;
    providerEpisodeId?: number;
  },
) {
  return (
    !!watch &&
    saved?.seriesWatchOverride === watch.generation &&
    (saved.providerEpisodeId === undefined || matchesIdentity(saved, canonical))
  );
}

/** A durable declaration is authoritative before rows or provider metadata are hydrated. */
export function effectiveEpisodeWatched(
  watch: SeriesWatch | undefined,
  saved: Doc<'episodes'> | null | undefined,
  episode: Episode,
  identity: { metadataProvider: 'tmdb' | 'tvdb'; seasonOrder?: string; providerEpisodeId?: number },
) {
  if (currentSeriesOverride(watch, saved, identity)) return saved!.watched;
  return (
    !!(saved?.watched && matchesIdentity(saved, identity)) || seriesWatchIncludes(watch, episode)
  );
}
