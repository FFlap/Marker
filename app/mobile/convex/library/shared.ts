import { getClerkUserId } from '../clerkAuth';
import { type MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { v } from 'convex/values';
import { seasonSummaryIdentityKey } from '../episodeSummaries';

export const status = v.union(
  v.literal('watched'),
  v.literal('watching'),
  v.literal('watchlist'),
  v.literal('dropped'),
);
export const mediaType = v.union(v.literal('movie'), v.literal('tv'));
export const rating = v.optional(v.number());
export const addItemFields = {
  tmdbId: v.number(),
  mediaType,
  title: v.string(),
  posterPath: v.optional(v.string()),
  overview: v.optional(v.string()),
  releaseDate: v.optional(v.string()),
  runtime: v.optional(v.number()),
  genres: v.optional(v.array(v.string())),
  status,
  rating,
  timesWatched: v.optional(v.number()),
  tags: v.optional(v.array(v.string())),
};
export type AddItemArgs = {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath?: string;
  overview?: string;
  releaseDate?: string;
  runtime?: number;
  genres?: string[];
  status: 'watched' | 'watching' | 'watchlist' | 'dropped';
  rating?: number;
  timesWatched?: number;
  tags?: string[];
};
export const requireRating = (value: number | undefined) => {
  if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 10))
    throw new Error('Rating must be between 0 and 10');
};
export const boundedOptional = (name: string, value: string | undefined, max: number) => {
  if (value !== undefined && value.length > max)
    throw new Error(`${name} must be at most ${max} characters`);
};
export const requireRuntime = (value: number | undefined) => {
  if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 3000))
    throw new Error('Runtime must be a finite number between 0 and 3000 minutes');
};
export const requireReleaseDate = (value: string | undefined) => {
  if (value === undefined) return;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) throw new Error('Release date must use YYYY-MM-DD format');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    throw new Error('Release date must use YYYY-MM-DD format');
};
export const normalizeGenres = (genres: string[] | undefined) => {
  if (genres === undefined) return undefined;
  if (genres.length > 15) throw new Error('Genres are limited to 15 entries');
  return genres.map((genre) => {
    const value = genre.trim();
    if (!value || value.length > 50)
      throw new Error('Each genre must be between 1 and 50 characters');
    return value;
  });
};
export const normalizeTags = (tags: string[]) => {
  if (tags.length > 20) throw new Error('Tags are limited to 20 per item or episode');
  const seen = new Set<string>();
  return tags.flatMap((raw) => {
    const tag = raw.trim();
    if (!tag || tag.length > 40) throw new Error('Each tag must be between 1 and 40 characters');
    const key = tag.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [tag];
  });
};
export const normalizedTagKey = (tag: string) => tag.trim().toLowerCase();
export const hasTag = (item: Doc<'items'>, tagKey: string) =>
  item.tags.some((tag) => normalizedTagKey(tag) === tagKey);
export const requireUser = async (ctx: { auth: Parameters<typeof getClerkUserId>[0]['auth'] }) => {
  const userId = await getClerkUserId(ctx);
  if (!userId) throw new Error('Authentication required');
  return userId;
};
export const ownedItem = async (
  ctx: { db: { get: (id: Id<'items'>) => Promise<Doc<'items'> | null> } },
  id: Id<'items'>,
  userId: Id<'users'>,
) => {
  const item = await ctx.db.get(id);
  if (!item || item.userId !== userId || item.deletingAt !== undefined)
    throw new Error('Item not found');
  return item;
};

export type EpisodeMetadataStamp = {
  metadataProvider: 'tmdb' | 'tvdb';
  seasonOrder?: string;
  providerEpisodeId?: number;
  summaryIdentityKey?: string;
  summarySeasonVersion?: string;
  summaryTotal?: number;
  seasonName?: string;
  name?: string;
  overview?: string;
  runtime?: number;
  imageUrl?: string;
  airDate?: string;
};

export const episodeMetadataStamp = async (
  ctx: MutationCtx,
  item: Doc<'items'>,
  season: number,
  episode: number,
): Promise<EpisodeMetadataStamp> => {
  const [mapping, title, resolved] = await Promise.all([
    ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', item.mediaType).eq('tmdbId', item.tmdbId))
      .unique(),
    ctx.db
      .query('resolvedTitles')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', item.mediaType).eq('tmdbId', item.tmdbId))
      .unique(),
    ctx.db
      .query('resolvedSeasons')
      .withIndex('by_tmdb_season', (q) => q.eq('tmdbId', item.tmdbId).eq('season', season))
      .unique(),
  ]);
  const activeResolved =
    resolved &&
    resolved.chunksComplete === true &&
    resolved.chunkCount !== undefined &&
    resolved.seasonVersion !== undefined &&
    ((resolved.metadataProvider === 'tmdb' && !mapping) ||
      (mapping !== null && resolved.orderEpoch === mapping.orderEpoch))
      ? resolved
      : undefined;
  let canonicalEpisode: Doc<'resolvedSeasonChunks'>['episodes'][number] | undefined;
  if (activeResolved) {
    const chunkCount = activeResolved.chunkCount!;
    const seasonVersion = activeResolved.seasonVersion!;
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const chunk = await ctx.db
        .query('resolvedSeasonChunks')
        .withIndex('by_tmdb_season_version_chunk', (query) =>
          query
            .eq('tmdbId', item.tmdbId)
            .eq('season', season)
            .eq('seasonVersion', seasonVersion)
            .eq('chunkIndex', chunkIndex),
        )
        .unique();
      if (!chunk) break;
      canonicalEpisode = chunk.episodes.find((entry) => entry.episode === episode);
      if (canonicalEpisode) break;
      const last = chunk.episodes.reduce(
        (maximum, entry) => Math.max(maximum, entry.episode),
        Number.NEGATIVE_INFINITY,
      );
      if (episode <= last) break;
    }
  }
  const metadataProvider = activeResolved?.metadataProvider ?? 'tmdb';
  const seasonOrder = mapping?.seasonOrder;
  const activeTitle =
    title && (mapping?.orderEpoch === undefined || title.orderEpoch === mapping.orderEpoch)
      ? title
      : undefined;
  const seasonName = activeTitle?.seasons.find((entry) => entry.season === season)?.name;
  if (!canonicalEpisode || (metadataProvider === 'tvdb' && seasonOrder === undefined))
    return {
      metadataProvider,
      seasonOrder: metadataProvider === 'tvdb' ? seasonOrder : undefined,
      ...(seasonName !== undefined && { seasonName }),
      name: canonicalEpisode?.name,
      overview: canonicalEpisode?.overview,
      runtime: canonicalEpisode?.runtime,
      imageUrl: canonicalEpisode?.imageUrl,
      airDate: canonicalEpisode?.airDate,
    };
  return {
    metadataProvider,
    seasonOrder: metadataProvider === 'tvdb' ? seasonOrder : undefined,
    // Undefined is intentional: a verified replacement clears a stale id.
    providerEpisodeId: canonicalEpisode.providerEpisodeId,
    summaryIdentityKey: seasonSummaryIdentityKey(activeResolved!, seasonOrder),
    summarySeasonVersion: activeResolved!.seasonVersion,
    summaryTotal: activeResolved!.episodeCount,
    ...(seasonName !== undefined && { seasonName }),
    name: canonicalEpisode.name,
    overview: canonicalEpisode.overview,
    runtime: canonicalEpisode.runtime,
    imageUrl: canonicalEpisode.imageUrl,
    airDate: canonicalEpisode.airDate,
  };
};

export const episodeMatchesStamp = (
  episode: Doc<'episodes'> | null | undefined,
  stamp: {
    metadataProvider?: 'tmdb' | 'tvdb';
    seasonOrder?: string;
    providerEpisodeId?: number;
  },
) =>
  !!episode &&
  episode.metadataProvider === stamp.metadataProvider &&
  episode.seasonOrder === stamp.seasonOrder &&
  episode.providerEpisodeId === stamp.providerEpisodeId;
