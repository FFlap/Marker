import { v } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import { getClerkUserId } from '../clerkAuth';
import { releasedEpisodes } from '../episodeAvailability';
import { mergeGenres } from '../mergePolicy';
import { mergeSeasonDisplayNames } from '../seasonNames';
import { type ResolvedEpisode } from '../seasonStorage';

export const TITLE_FRESH_MS = 24 * 60 * 60 * 1000;
export const SEASON_FRESH_MS = 6 * 60 * 60 * 1000;
export const PARTIAL_RETRY_MS = 5 * 60 * 1000;
export const REFRESH_LEASE_MS = 2 * 60 * 1000;
export const REFRESH_WAIT_MS = 15 * 1000;
export const DEBOUNCE_MS = 3 * 60 * 1000;
export const FORCE_DEBOUNCE_MS = 30 * 1000;
export const REQUEST_LEASE_MS = 2 * 60 * 1000;
export const FAILED_TOUCH_BACKOFF_MS = 30 * 1000;
export const TOUCHES_PER_MINUTE = 60;
export const GLOBAL_TOUCHES_PER_MINUTE = 600;
export const NEW_TOUCH_KEYS_PER_HOUR = 240;
export const mediaType = v.union(v.literal('movie'), v.literal('tv'));
export const metadataProvider = v.union(v.literal('tmdb'), v.literal('tvdb'));
export const refreshOutcomeValidator = v.object({
  key: v.string(),
  state: v.union(v.literal('succeeded'), v.literal('failed'), v.literal('notFound')),
  errorCode: v.optional(v.string()),
});
export const resolvedEpisodeValidator = v.object({
  season: v.number(),
  episode: v.number(),
  name: v.string(),
  overview: v.optional(v.string()),
  runtime: v.optional(v.number()),
  imageUrl: v.optional(v.string()),
  stillPath: v.optional(v.string()),
  airDate: v.optional(v.string()),
  providerEpisodeId: v.optional(v.number()),
});
export const resolvedSeasonValidator = v.object({
  season: v.number(),
  name: v.string(),
  episodeCount: v.number(),
});
export const castMemberValidator = v.object({
  name: v.string(),
  character: v.string(),
  profilePath: v.optional(v.string()),
});
export const resolvedTitleValidator = v.object({
  tmdbId: v.number(),
  mediaType,
  title: v.string(),
  posterPath: v.optional(v.string()),
  overview: v.optional(v.string()),
  releaseDate: v.optional(v.string()),
  firstAirDate: v.optional(v.string()),
  voteAverage: v.optional(v.number()),
  runtime: v.optional(v.number()),
  episodeRunTime: v.array(v.number()),
  genres: v.array(v.string()),
  cast: v.array(castMemberValidator),
  seasons: v.array(resolvedSeasonValidator),
  metadataProvider,
  tvdbId: v.optional(v.number()),
  seasonOrder: v.optional(v.string()),
  orderEpoch: v.number(),
  refreshedAt: v.number(),
  refreshAfter: v.number(),
});
export type MediaType = 'movie' | 'tv';
export type MappingIdentity = {
  tvdbId?: number;
  seasonOrder?: string;
  source: 'auto' | 'manual';
  orderEpoch: number;
};
export type ResolvedTitle = Omit<Doc<'resolvedTitles'>, '_id' | '_creationTime'>;
export type MappingWrite = Omit<Doc<'titleMappings'>, '_id' | '_creationTime'>;
export type ProviderTitle = Partial<ResolvedTitle> & {
  title: string;
  originalTitle?: string;
  genres: string[];
  cast?: ResolvedTitle['cast'];
  seasons?: ResolvedTitle['seasons'];
  episodeRunTime?: number[];
};
export type ProviderAnime = {
  tvdbId: number;
  firstAirDate?: string;
  episodeRunTime: number[];
  genres: string[];
  order: string;
  seasons: ResolvedTitle['seasons'];
  selectedSeason?: number;
  selectedEpisodes?: ResolvedEpisode[];
};

export const cleanEpisode = (episode: ResolvedEpisode): ResolvedEpisode => ({
  season: episode.season,
  episode: episode.episode,
  name: episode.name,
  ...(episode.overview && { overview: episode.overview }),
  ...(episode.runtime !== undefined && { runtime: episode.runtime }),
  ...(episode.imageUrl && { imageUrl: episode.imageUrl }),
  ...(episode.stillPath && { stillPath: episode.stillPath }),
  ...(episode.airDate && { airDate: episode.airDate }),
  ...(episode.providerEpisodeId !== undefined && { providerEpisodeId: episode.providerEpisodeId }),
});

export const mergeEpisodes = (structure: ResolvedEpisode[], artwork: ResolvedEpisode[]) => {
  const byNumber = new Map(
    artwork.map((episode) => [`${episode.season}:${episode.episode}`, episode]),
  );
  return releasedEpisodes(structure).map((episode) => {
    const image = byNumber.get(`${episode.season}:${episode.episode}`);
    const providerEpisodeId =
      episode.providerEpisodeId ??
      (typeof (episode as unknown as { id?: unknown }).id === 'number'
        ? (episode as unknown as { id: number }).id
        : undefined);
    return cleanEpisode({
      ...cleanEpisode(episode),
      ...(!episode.imageUrl && image?.imageUrl && { imageUrl: image.imageUrl }),
      ...(providerEpisodeId !== undefined && { providerEpisodeId }),
    });
  });
};

export const mergeTitle = (
  tmdbId: number,
  mediaTypeValue: MediaType,
  base: ProviderTitle,
  anime: ProviderAnime | null,
  refreshedAt: number,
  refreshAfter = refreshedAt + TITLE_FRESH_MS,
): ResolvedTitle => {
  if (mediaTypeValue === 'movie')
    return {
      tmdbId,
      mediaType: 'movie',
      title: base.title,
      ...(base.posterPath && { posterPath: base.posterPath }),
      ...(base.overview && { overview: base.overview }),
      ...(base.releaseDate && { releaseDate: base.releaseDate }),
      ...(base.voteAverage !== undefined && { voteAverage: base.voteAverage }),
      ...(base.runtime !== undefined && { runtime: base.runtime }),
      episodeRunTime: [],
      genres: base.genres,
      cast: base.cast ?? [],
      seasons: [],
      metadataProvider: 'tmdb',
      orderEpoch: base.orderEpoch ?? 0,
      refreshedAt,
      refreshAfter,
    };

  const seasons = anime?.seasons.length
    ? mergeSeasonDisplayNames(anime.seasons, base.seasons ?? [])
    : (base.seasons ?? []);
  return {
    tmdbId,
    mediaType: 'tv',
    title: base.title,
    ...(base.posterPath && { posterPath: base.posterPath }),
    ...(base.overview && { overview: base.overview }),
    ...(base.releaseDate && { releaseDate: base.releaseDate }),
    ...(base.firstAirDate && { firstAirDate: base.firstAirDate }),
    ...(base.voteAverage !== undefined && { voteAverage: base.voteAverage }),
    episodeRunTime: anime?.episodeRunTime.length
      ? anime.episodeRunTime
      : (base.episodeRunTime ?? []),
    genres: mergeGenres(base.genres ?? [], anime?.genres ?? []),
    cast: base.cast ?? [],
    seasons,
    metadataProvider: anime ? 'tvdb' : 'tmdb',
    ...(anime && { tvdbId: anime.tvdbId, seasonOrder: anime.order }),
    orderEpoch: base.orderEpoch ?? 0,
    refreshedAt,
    refreshAfter,
  };
};

export const requireUser = async (ctx: Parameters<typeof getClerkUserId>[0]) => {
  const userId = await getClerkUserId(ctx);
  if (!userId) throw new Error('Authentication required');
  return userId;
};
