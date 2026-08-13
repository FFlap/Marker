import { getClerkUserId } from './clerkAuth';
import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
} from './_generated/server';
import { mergeGenres } from './mergePolicy';
import { releasedEpisodes } from './episodeAvailability';
import { hideResolvedEmptySeasons, mergeSeasonDisplayNames } from './seasonNames';
import {
  appendPrechunkedSeasonChunk,
  assertMetadataMutationSize,
  beginPrechunkedSeasonWrite,
  EPISODES_PER_CHUNK,
  episodeChunks,
  finalizePrechunkedSeasonWrite,
  readAssembledSeason,
  writeChunkedSeason,
  type AssembledSeason,
  type PrechunkedSeason,
  type ResolvedEpisode,
} from './seasonStorage';
import { tvdbAnimeGuideKey, tvdbAnimeLookupKey } from './tvdbGuideKeys';
import {
  itemValidator,
  refreshResultValidator,
  requestStateValidator,
  resolvedTitleValidator as publicResolvedTitleValidator,
  resolvedEpisodeValidator as publicResolvedEpisodeValidator,
} from './publicValidators';

const TITLE_FRESH_MS = 24 * 60 * 60 * 1000;
const SEASON_FRESH_MS = 6 * 60 * 60 * 1000;
const PARTIAL_RETRY_MS = 5 * 60 * 1000;
const REFRESH_LEASE_MS = 2 * 60 * 1000;
const REFRESH_WAIT_MS = 15 * 1000;
export const DEBOUNCE_MS = 3 * 60 * 1000;
const FORCE_DEBOUNCE_MS = 30 * 1000;
const REQUEST_LEASE_MS = 2 * 60 * 1000;
const FAILED_TOUCH_BACKOFF_MS = 30 * 1000;
const TOUCHES_PER_MINUTE = 60;
const GLOBAL_TOUCHES_PER_MINUTE = 600;
const NEW_TOUCH_KEYS_PER_HOUR = 240;
const mediaType = v.union(v.literal('movie'), v.literal('tv'));
const metadataProvider = v.union(v.literal('tmdb'), v.literal('tvdb'));
const refreshOutcomeValidator = v.object({
  key: v.string(),
  state: v.union(v.literal('succeeded'), v.literal('failed'), v.literal('notFound')),
  errorCode: v.optional(v.string()),
});
const resolvedEpisodeValidator = v.object({
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
const resolvedSeasonValidator = v.object({
  season: v.number(),
  name: v.string(),
  episodeCount: v.number(),
});
const castMemberValidator = v.object({
  name: v.string(),
  character: v.string(),
  profilePath: v.optional(v.string()),
});
const resolvedTitleValidator = v.object({
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
type MediaType = 'movie' | 'tv';
type MappingIdentity = {
  tvdbId?: number;
  seasonOrder?: string;
  source: 'auto' | 'manual';
  orderEpoch: number;
};
type ResolvedTitle = Omit<Doc<'resolvedTitles'>, '_id' | '_creationTime'>;
type MappingWrite = Omit<Doc<'titleMappings'>, '_id' | '_creationTime'>;
type ProviderTitle = Partial<ResolvedTitle> & {
  title: string;
  originalTitle?: string;
  genres: string[];
  cast?: ResolvedTitle['cast'];
  seasons?: ResolvedTitle['seasons'];
  episodeRunTime?: number[];
};
type ProviderAnime = {
  tvdbId: number;
  firstAirDate?: string;
  episodeRunTime: number[];
  genres: string[];
  order: string;
  seasons: ResolvedTitle['seasons'];
  selectedSeason?: number;
  selectedEpisodes?: ResolvedEpisode[];
};

const cleanEpisode = (episode: ResolvedEpisode): ResolvedEpisode => ({
  season: episode.season,
  episode: episode.episode,
  name: episode.name,
  ...(episode.overview && { overview: episode.overview }),
  ...(episode.runtime !== undefined && { runtime: episode.runtime }),
  ...(episode.imageUrl && { imageUrl: episode.imageUrl }),
  ...(episode.airDate && { airDate: episode.airDate }),
  ...(episode.providerEpisodeId !== undefined && { providerEpisodeId: episode.providerEpisodeId }),
});

const mergeEpisodes = (structure: ResolvedEpisode[], artwork: ResolvedEpisode[]) => {
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

const mergeTitle = (
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

const requireUser = async (ctx: Parameters<typeof getClerkUserId>[0]) => {
  const userId = await getClerkUserId(ctx);
  if (!userId) throw new Error('Authentication required');
  return userId;
};

export const readTitle = internalQuery({
  args: { mediaType, tmdbId: v.number() },
  handler: async (ctx, args) => {
    const [title, mapping] = await Promise.all([
      ctx.db
        .query('resolvedTitles')
        .withIndex('by_tmdb', (q) => q.eq('mediaType', args.mediaType).eq('tmdbId', args.tmdbId))
        .unique(),
      ctx.db
        .query('titleMappings')
        .withIndex('by_tmdb', (q) => q.eq('mediaType', args.mediaType).eq('tmdbId', args.tmdbId))
        .unique(),
    ]);
    return title && (mapping?.orderEpoch === undefined || title.orderEpoch === mapping.orderEpoch)
      ? title
      : null;
  },
});

export const readTitleMapping = internalQuery({
  args: { mediaType, tmdbId: v.number() },
  handler: (ctx, args) =>
    ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', args.mediaType).eq('tmdbId', args.tmdbId))
      .unique(),
});

export const getTitle = query({
  args: { mediaType, tmdbId: v.number() },
  returns: v.union(v.null(), publicResolvedTitleValidator),
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const [title, mapping] = await Promise.all([
      ctx.db
        .query('resolvedTitles')
        .withIndex('by_tmdb', (q) => q.eq('mediaType', args.mediaType).eq('tmdbId', args.tmdbId))
        .unique(),
      ctx.db
        .query('titleMappings')
        .withIndex('by_tmdb', (q) => q.eq('mediaType', args.mediaType).eq('tmdbId', args.tmdbId))
        .unique(),
    ]);
    return title && (mapping?.orderEpoch === undefined || title.orderEpoch === mapping.orderEpoch)
      ? title
      : null;
  },
});

export const getTitleView = query({
  args: { mediaType, tmdbId: v.number() },
  returns: v.object({ title: v.union(v.null(), publicResolvedTitleValidator) }),
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const [title, mapping] = await Promise.all([
      ctx.db
        .query('resolvedTitles')
        .withIndex('by_tmdb', (q) => q.eq('mediaType', args.mediaType).eq('tmdbId', args.tmdbId))
        .unique(),
      ctx.db
        .query('titleMappings')
        .withIndex('by_tmdb', (q) => q.eq('mediaType', args.mediaType).eq('tmdbId', args.tmdbId))
        .unique(),
    ]);
    return {
      title:
        title && (mapping?.orderEpoch === undefined || title.orderEpoch === mapping.orderEpoch)
          ? title
          : null,
    };
  },
});

/** Kept separate so request-state transitions do not retransmit title content. */
export const getTitleRequestState = query({
  args: { mediaType, tmdbId: v.number() },
  returns: requestStateValidator,
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const request = await ctx.db
      .query('metadataRefreshRequests')
      .withIndex('by_key', (q) => q.eq('key', requestKey(args.mediaType, args.tmdbId)))
      .unique();
    return visibleRequestState(request);
  },
});

export const readSeason = internalQuery({
  args: { tmdbId: v.number(), season: v.number() },
  handler: async (ctx, args) => {
    const [season, mapping] = await Promise.all([
      readAssembledSeason(ctx, args.tmdbId, args.season),
      ctx.db
        .query('titleMappings')
        .withIndex('by_tmdb', (q) => q.eq('mediaType', 'tv').eq('tmdbId', args.tmdbId))
        .unique(),
    ]);
    return season && mapping && season.orderEpoch === mapping.orderEpoch ? season : null;
  },
});

export const readResolvedSeasonCounts = internalQuery({
  args: { tmdbId: v.number() },
  handler: async (ctx, args) =>
    (
      await ctx.db
        .query('resolvedSeasons')
        .withIndex('by_tmdb_season', (query) => query.eq('tmdbId', args.tmdbId))
        .collect()
    )
      .filter((season) => season.chunksComplete === true)
      .map((season) => ({ season: season.season, episodeCount: season.episodeCount })),
});

/** Reads one canonical episode chunk plus its season counts. */
export const readSeasonChunk = internalQuery({
  args: { tmdbId: v.number(), season: v.number(), chunkIndex: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const chunkIndex = args.chunkIndex ?? 0;
    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= 50) return null;
    const [mapping, parent] = await Promise.all([
      ctx.db
        .query('titleMappings')
        .withIndex('by_tmdb', (query) => query.eq('mediaType', 'tv').eq('tmdbId', args.tmdbId))
        .unique(),
      ctx.db
        .query('resolvedSeasons')
        .withIndex('by_tmdb_season', (query) =>
          query.eq('tmdbId', args.tmdbId).eq('season', args.season),
        )
        .unique(),
    ]);
    if (
      !mapping ||
      !parent ||
      parent.orderEpoch !== mapping.orderEpoch ||
      parent.chunksComplete !== true ||
      parent.chunkCount === undefined ||
      parent.episodeCount === undefined ||
      parent.orderEpoch === undefined ||
      parent.seasonVersion === undefined
    )
      return null;
    if (chunkIndex >= parent.chunkCount && !(parent.chunkCount === 0 && chunkIndex === 0))
      return null;
    const seasonVersion = parent.seasonVersion;
    const requestedChunk =
      parent.chunkCount === 0
        ? null
        : await ctx.db
            .query('resolvedSeasonChunks')
            .withIndex('by_tmdb_season_version_chunk', (query) =>
              query
                .eq('tmdbId', args.tmdbId)
                .eq('season', args.season)
                .eq('seasonVersion', seasonVersion)
                .eq('chunkIndex', chunkIndex),
            )
            .unique();
    if (parent.chunkCount > 0 && !requestedChunk) return null;
    return { ...parent, episodes: requestedChunk?.episodes ?? [] };
  },
});

export const getItemView = query({
  args: { itemId: v.id('items') },
  returns: v.union(
    v.null(),
    v.object({ item: itemValidator, title: v.union(v.null(), publicResolvedTitleValidator) }),
  ),
  handler: async (ctx, { itemId }) => {
    const userId = await requireUser(ctx);
    const item = await ctx.db.get(itemId);
    if (!item || item.userId !== userId || item.deletingAt !== undefined) return null;
    const title = await ctx.db
      .query('resolvedTitles')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', item.mediaType).eq('tmdbId', item.tmdbId))
      .unique();
    const mapping = await ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', item.mediaType).eq('tmdbId', item.tmdbId))
      .unique();
    const activeTitle =
      title && (mapping?.orderEpoch === undefined || title.orderEpoch === mapping.orderEpoch)
        ? title
        : null;
    return { item, title: activeTitle };
  },
});

export const getSeasonView = query({
  args: { tmdbId: v.number(), season: v.number(), paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(
      v.object({
        season: v.number(),
        metadataProvider,
        orderEpoch: v.number(),
        totalCount: v.optional(v.number()),
        chunkIndex: v.number(),
        episodes: v.array(publicResolvedEpisodeValidator),
      }),
    ),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const [mapping, parent] = await Promise.all([
      ctx.db
        .query('titleMappings')
        .withIndex('by_tmdb', (q) => q.eq('mediaType', 'tv').eq('tmdbId', args.tmdbId))
        .unique(),
      ctx.db
        .query('resolvedSeasons')
        .withIndex('by_tmdb_season', (q) => q.eq('tmdbId', args.tmdbId).eq('season', args.season))
        .unique(),
    ]);
    if (
      !mapping ||
      !parent ||
      parent.orderEpoch !== mapping.orderEpoch ||
      parent.chunksComplete !== true ||
      parent.chunkCount === undefined ||
      parent.orderEpoch === undefined ||
      parent.seasonVersion === undefined
    )
      return { page: [], isDone: true, continueCursor: args.paginationOpts.cursor ?? '' };

    const summary = {
      season: parent.season,
      metadataProvider: parent.metadataProvider,
      orderEpoch: parent.orderEpoch,
      totalCount: parent.episodeCount,
    };
    if (parent.chunkCount === 0)
      return {
        page:
          args.paginationOpts.cursor === null ? [{ ...summary, chunkIndex: 0, episodes: [] }] : [],
        isDone: true,
        continueCursor: '',
      };
    const rawCursor = args.paginationOpts.cursor;
    const requestedChunk = rawCursor?.startsWith('chunk:')
      ? Number(rawCursor.slice('chunk:'.length))
      : 0;
    const chunkIndex = Number.isInteger(requestedChunk) && requestedChunk >= 0 ? requestedChunk : 0;
    const seasonVersion = parent.seasonVersion;
    const chunk = await ctx.db
      .query('resolvedSeasonChunks')
      .withIndex('by_tmdb_season_version_chunk', (q) =>
        q
          .eq('tmdbId', args.tmdbId)
          .eq('season', args.season)
          .eq('seasonVersion', seasonVersion)
          .gte('chunkIndex', chunkIndex),
      )
      .first();
    const nextChunk = chunk ? chunk.chunkIndex + 1 : parent.chunkCount;
    return {
      page: chunk ? [{ ...summary, chunkIndex: chunk.chunkIndex, episodes: chunk.episodes }] : [],
      isDone: nextChunk >= parent.chunkCount,
      continueCursor: `chunk:${nextChunk}`,
    };
  },
});

/** Kept separate so request-state transitions do not retransmit episode chunks. */
export const getSeasonRequestState = query({
  args: { tmdbId: v.number(), season: v.number() },
  returns: requestStateValidator,
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const request = await ctx.db
      .query('metadataRefreshRequests')
      .withIndex('by_key', (q) => q.eq('key', seasonRequestKey(args.tmdbId, args.season)))
      .unique();
    return visibleRequestState(request);
  },
});

export const putTitle = internalMutation({
  args: { value: resolvedTitleValidator },
  handler: async (ctx, { value }) => {
    const next = value;
    const existing = await ctx.db
      .query('resolvedTitles')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', next.mediaType).eq('tmdbId', next.tmdbId))
      .unique();
    if (existing) await ctx.db.replace(existing._id, next);
    else await ctx.db.insert('resolvedTitles', next);
    await ctx.scheduler.runAfter(0, internal.resolvedMetadata.refreshItemProjections, {
      mediaType: next.mediaType,
      tmdbId: next.tmdbId,
    });
  },
});

export const putSeason = internalMutation({
  args: {
    tmdbId: v.number(),
    season: v.number(),
    metadataProvider: v.union(v.literal('tmdb'), v.literal('tvdb')),
    episodes: v.array(resolvedEpisodeValidator),
    refreshedAt: v.number(),
    refreshAfter: v.number(),
    orderEpoch: v.number(),
  },
  handler: async (ctx, args) => {
    await writeChunkedSeason(ctx, args);
    const mapping = await ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (query) => query.eq('mediaType', 'tv').eq('tmdbId', args.tmdbId))
      .unique();
    if (!mapping)
      await ctx.db.insert('titleMappings', {
        tmdbId: args.tmdbId,
        mediaType: 'tv',
        source: 'auto',
        orderEpoch: args.orderEpoch,
        updatedAt: args.refreshedAt,
      });
    else if (mapping.orderEpoch === args.orderEpoch)
      await ctx.db.patch(mapping._id, { updatedAt: args.refreshedAt });
    await ctx.scheduler.runAfter(0, internal.episodeSummaries.reconcileSeasonSummaries, {
      tmdbId: args.tmdbId,
      season: args.season,
    });
  },
});

export const claimRefresh = internalMutation({
  args: {
    key: v.string(),
    token: v.string(),
    leaseMs: v.number(),
    requestKeys: v.optional(v.array(v.string())),
    attemptToken: v.optional(v.string()),
  },
  handler: async (ctx, { key, token, leaseMs, requestKeys, attemptToken }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query('metadataRefreshLeases')
      .withIndex('by_key', (query) => query.eq('key', key))
      .unique();
    if (existing && existing.expiresAt > now) return false;
    const value = { key, token, expiresAt: now + Math.min(Math.max(leaseMs, 1_000), 120_000) };
    if (existing) await ctx.db.replace(existing._id, value);
    else await ctx.db.insert('metadataRefreshLeases', value);
    if (attemptToken)
      for (const requestKeyValue of [...new Set(requestKeys ?? [])]) {
        const request = await ctx.db
          .query('metadataRefreshRequests')
          .withIndex('by_key', (query) => query.eq('key', requestKeyValue))
          .unique();
        if (request?.state === 'inFlight' && request.attemptToken === attemptToken)
          await ctx.db.patch(request._id, { expiresAt: value.expiresAt });
      }
    return true;
  },
});

/** Renews one still-owned provider attempt and every request row attached to it. */
export const renewRefreshAttempt = internalMutation({
  args: {
    key: v.string(),
    token: v.string(),
    leaseMs: v.number(),
    requestKeys: v.array(v.string()),
    attemptToken: v.string(),
  },
  handler: async (ctx, args) => {
    const lease = await ctx.db
      .query('metadataRefreshLeases')
      .withIndex('by_key', (query) => query.eq('key', args.key))
      .unique();
    if (!lease || lease.token !== args.token) return false;
    const expiresAt = Date.now() + Math.min(Math.max(args.leaseMs, 1_000), 120_000);
    await ctx.db.patch(lease._id, { expiresAt });
    for (const key of [...new Set(args.requestKeys)]) {
      const request = await ctx.db
        .query('metadataRefreshRequests')
        .withIndex('by_key', (query) => query.eq('key', key))
        .unique();
      if (request?.state === 'inFlight' && request.attemptToken === args.attemptToken)
        await ctx.db.patch(request._id, { expiresAt });
    }
    return expiresAt;
  },
});

/** Keeps a queued season request alive while it waits for the shared title lease. */
export const renewRefreshRequests = internalMutation({
  args: { keys: v.array(v.string()), attemptToken: v.string(), requestMs: v.number() },
  handler: async (ctx, args) => {
    const expiresAt = Date.now() + Math.min(Math.max(args.requestMs, 1_000), 120_000);
    let renewed = 0;
    for (const key of [...new Set(args.keys)]) {
      const request = await ctx.db
        .query('metadataRefreshRequests')
        .withIndex('by_key', (query) => query.eq('key', key))
        .unique();
      if (request?.state !== 'inFlight' || request.attemptToken !== args.attemptToken) continue;
      await ctx.db.patch(request._id, { expiresAt });
      renewed += 1;
    }
    return renewed;
  },
});

export const releaseRefresh = internalMutation({
  args: { key: v.string(), token: v.string() },
  handler: async (ctx, { key, token }) => {
    const existing = await ctx.db
      .query('metadataRefreshLeases')
      .withIndex('by_key', (query) => query.eq('key', key))
      .unique();
    if (existing?.token === token) await ctx.db.delete(existing._id);
  },
});

const requestKey = (mediaTypeValue: MediaType, tmdbId: number) =>
  `title:${mediaTypeValue}:${tmdbId}`;
const seasonRequestKey = (tmdbId: number, season: number) => `season:${tmdbId}:${season}`;
const refreshLeaseKey = (mediaTypeValue: MediaType, tmdbId: number) =>
  `metadata:${mediaTypeValue}:${tmdbId}`;
function visibleRequestState(row: Doc<'metadataRefreshRequests'> | null) {
  if (!row) return row;
  const now = Date.now();
  if (row.state === 'inFlight' && row.expiresAt > now)
    return { ...row, delayMs: Math.max(0, row.expiresAt - now) };
  if (row.state === 'failed') {
    const retryAt =
      row.retryAt ?? (row.completedAt ?? row.lastRequestedAt) + FAILED_TOUCH_BACKOFF_MS;
    return { ...row, retryAt, delayMs: Math.max(0, retryAt - now) };
  }
  if (row.state !== 'inFlight') return row;
  return {
    ...row,
    state: 'failed' as const,
    errorCode: 'expired',
    completedAt: row.expiresAt,
    retryAt: row.expiresAt + FAILED_TOUCH_BACKOFF_MS,
    delayMs: Math.max(0, row.expiresAt + FAILED_TOUCH_BACKOFF_MS - now),
  };
}

async function consumeWindowBudget(
  ctx: MutationCtx,
  key: string,
  maximum: number,
  windowMs: number,
  amount = 1,
) {
  const now = Date.now();
  const row = await ctx.db
    .query('requestThrottle')
    .withIndex('by_key', (query) => query.eq('key', key))
    .unique();
  if (!row) {
    if (amount > maximum) return false;
    await ctx.db.insert('requestThrottle', { key, windowStart: now, count: amount });
    return true;
  }
  if (now - row.windowStart >= windowMs) {
    if (amount > maximum) return false;
    await ctx.db.patch(row._id, { windowStart: now, count: amount });
    return true;
  }
  if (row.count + amount > maximum) return false;
  await ctx.db.patch(row._id, { count: row.count + amount });
  return true;
}

async function consumeRefreshAdmission(ctx: MutationCtx, userId: Id<'users'>, newKeyCount: number) {
  if (!(await consumeWindowBudget(ctx, 'metadata-touch:global', GLOBAL_TOUCHES_PER_MINUTE, 60_000)))
    throw new ConvexError({ code: 'global_touch_budget', retryable: true });
  if (!(await consumeWindowBudget(ctx, `metadata-touch:${userId}`, TOUCHES_PER_MINUTE, 60_000)))
    throw new ConvexError({ code: 'touch_budget', retryable: true });
  if (
    newKeyCount > 0 &&
    !(await consumeWindowBudget(
      ctx,
      `metadata-touch-new:${userId}`,
      NEW_TOUCH_KEYS_PER_HOUR,
      60 * 60 * 1000,
      newKeyCount,
    ))
  )
    throw new ConvexError({ code: 'new_touch_key_budget', retryable: true });
}

export const admitSynchronousRefresh = internalMutation({
  args: { userId: v.id('users'), keys: v.array(v.string()) },
  handler: async (ctx, { userId, keys }) => {
    const uniqueKeys = [...new Set(keys)];
    const rows = await Promise.all(
      uniqueKeys.map((key) =>
        ctx.db
          .query('metadataRefreshRequests')
          .withIndex('by_key', (query) => query.eq('key', key))
          .unique(),
      ),
    );
    await consumeRefreshAdmission(ctx, userId, rows.filter((row) => !row).length);
    return true;
  },
});

export const completeRefreshRequest = internalMutation({
  args: {
    key: v.string(),
    attemptToken: v.string(),
    state: v.union(v.literal('succeeded'), v.literal('failed'), v.literal('notFound')),
    errorCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('metadataRefreshRequests')
      .withIndex('by_key', (q) => q.eq('key', args.key))
      .unique();
    if (!row || row.attemptToken !== args.attemptToken) return false;
    const completedAt = Date.now();
    await ctx.db.patch(row._id, {
      state: args.state,
      completedAt,
      expiresAt: completedAt,
      retryAt: args.state === 'failed' ? completedAt + FAILED_TOUCH_BACKOFF_MS : undefined,
      ...(args.errorCode ? { errorCode: args.errorCode } : { errorCode: undefined }),
    });
    return true;
  },
});

export const completeRefreshRequests = internalMutation({
  args: {
    attemptToken: v.string(),
    outcomes: v.array(refreshOutcomeValidator),
  },
  handler: async (ctx, { attemptToken, outcomes }) => {
    const now = Date.now();
    const rows = await Promise.all(
      outcomes.map((outcome) =>
        ctx.db
          .query('metadataRefreshRequests')
          .withIndex('by_key', (query) => query.eq('key', outcome.key))
          .unique(),
      ),
    );
    if (rows.some((row) => !row || row.attemptToken !== attemptToken)) return false;
    for (const [index, row] of rows.entries()) {
      const outcome = outcomes[index]!;
      await ctx.db.patch(row!._id, {
        state: outcome.state,
        completedAt: now,
        expiresAt: now,
        retryAt: outcome.state === 'failed' ? now + FAILED_TOUCH_BACKOFF_MS : undefined,
        ...(outcome.errorCode ? { errorCode: outcome.errorCode } : { errorCode: undefined }),
      });
    }
    return true;
  },
});

/** Transfers pending touch rows to the synchronous lease holder. */
export const adoptRefreshRequests = internalMutation({
  args: {
    keys: v.array(v.string()),
    attemptToken: v.string(),
    leaseKey: v.string(),
    leaseToken: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const lease = await ctx.db
      .query('metadataRefreshLeases')
      .withIndex('by_key', (query) => query.eq('key', args.leaseKey))
      .unique();
    if (!lease || lease.token !== args.leaseToken || lease.expiresAt <= now) return [];
    const adopted: string[] = [];
    for (const key of [...new Set(args.keys)]) {
      const row = await ctx.db
        .query('metadataRefreshRequests')
        .withIndex('by_key', (query) => query.eq('key', key))
        .unique();
      if (!row || row.state !== 'inFlight') continue;
      await ctx.db.patch(row._id, {
        attemptToken: args.attemptToken,
        expiresAt: lease.expiresAt,
        completedAt: undefined,
        errorCode: undefined,
        retryAt: undefined,
      });
      adopted.push(key);
    }
    return adopted;
  },
});

/** Converts a lost scheduled lease into success when another writer already made its keys fresh. */
export const settleScheduledRefresh = internalMutation({
  args: {
    mediaType,
    tmdbId: v.number(),
    season: v.optional(v.number()),
    keys: v.array(v.string()),
    attemptToken: v.string(),
    errorCode: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const rows = await Promise.all(
      args.keys.map((key) =>
        ctx.db
          .query('metadataRefreshRequests')
          .withIndex('by_key', (query) => query.eq('key', key))
          .unique(),
      ),
    );
    const owned = rows.flatMap((row, index) =>
      row?.state === 'inFlight' && row.attemptToken === args.attemptToken
        ? [{ row, key: args.keys[index]! }]
        : [],
    );
    if (owned.length === 0) return 'superseded' as const;
    const leaseKey = refreshLeaseKey(args.mediaType, args.tmdbId);
    const [lease, mapping, title, seasonParent] = await Promise.all([
      ctx.db
        .query('metadataRefreshLeases')
        .withIndex('by_key', (query) => query.eq('key', leaseKey))
        .unique(),
      ctx.db
        .query('titleMappings')
        .withIndex('by_tmdb', (query) =>
          query.eq('mediaType', args.mediaType).eq('tmdbId', args.tmdbId),
        )
        .unique(),
      ctx.db
        .query('resolvedTitles')
        .withIndex('by_tmdb', (query) =>
          query.eq('mediaType', args.mediaType).eq('tmdbId', args.tmdbId),
        )
        .unique(),
      args.season === undefined
        ? Promise.resolve(null)
        : ctx.db
            .query('resolvedSeasons')
            .withIndex('by_tmdb_season', (query) =>
              query.eq('tmdbId', args.tmdbId).eq('season', args.season!),
            )
            .unique(),
    ]);
    if (lease && lease.expiresAt > now) {
      if (lease.token !== `scheduled:${args.attemptToken}`) return 'superseded' as const;
      // Release our own failed attempt inside the same transaction that decides
      // whether its request rows may fail. A synchronous claimant can therefore
      // never slip between the lease check and the row transition.
      await ctx.db.delete(lease._id);
    }
    const titleVisible =
      title !== null &&
      (mapping?.orderEpoch === undefined || title.orderEpoch === mapping.orderEpoch);
    const seasonVisible =
      mapping !== null &&
      seasonParent !== null &&
      seasonParent.orderEpoch === mapping.orderEpoch &&
      seasonParent.chunkCount !== undefined &&
      seasonParent.seasonVersion !== undefined &&
      seasonParent.chunksComplete === true;
    if (
      owned.some(({ row, key }) =>
        key.startsWith('season:')
          ? !seasonVisible || (seasonParent?.refreshedAt ?? 0) < row.lastRequestedAt
          : !titleVisible || (title?.refreshedAt ?? 0) < row.lastRequestedAt,
      )
    ) {
      for (const { row } of owned)
        await ctx.db.patch(row._id, {
          state: 'failed',
          completedAt: now,
          expiresAt: now,
          retryAt: now + FAILED_TOUCH_BACKOFF_MS,
          errorCode: args.errorCode,
        });
      return 'failed' as const;
    }
    const completedAt = now;
    for (const { row } of owned)
      await ctx.db.patch(row._id, {
        state: 'succeeded',
        completedAt,
        expiresAt: completedAt,
        errorCode: undefined,
        retryAt: undefined,
      });
    return 'fresh' as const;
  },
});

async function requestRefresh(
  ctx: MutationCtx,
  args: {
    userId: Id<'users'>;
    mediaType: MediaType;
    tmdbId: number;
    title?: string;
    season?: number;
    force?: boolean;
  },
) {
  const now = Date.now();
  const keys = [
    requestKey(args.mediaType, args.tmdbId),
    ...(args.season !== undefined ? [seasonRequestKey(args.tmdbId, args.season)] : []),
  ];
  const rows = await Promise.all(
    keys.map((key) =>
      ctx.db
        .query('metadataRefreshRequests')
        .withIndex('by_key', (q) => q.eq('key', key))
        .unique(),
    ),
  );

  const decideFromRequestRow = (row: Doc<'metadataRefreshRequests'> | null) => {
    if (row?.state === 'notFound')
      return {
        scheduled: false as const,
        reason: 'notFound' as const,
        expiresAt: row.expiresAt,
        delayMs: 0,
      };
    if (row?.state === 'inFlight' && row.expiresAt > now)
      return {
        scheduled: false as const,
        reason: 'inFlight' as const,
        expiresAt: row.expiresAt,
        delayMs: row.expiresAt - now,
      };
    const failedUntil =
      row?.state === 'failed'
        ? (row.retryAt ?? (row.completedAt ?? row.lastRequestedAt) + FAILED_TOUCH_BACKOFF_MS)
        : 0;
    if (!args.force && failedUntil > now)
      return {
        scheduled: false as const,
        reason: 'backoff' as const,
        expiresAt: failedUntil,
        retryAt: failedUntil,
        delayMs: failedUntil - now,
      };
    if (args.force && (row?.lastRequestedAt ?? 0) > now - FORCE_DEBOUNCE_MS)
      return {
        scheduled: false as const,
        reason: 'debounced' as const,
        expiresAt: (row?.lastRequestedAt ?? now) + FORCE_DEBOUNCE_MS,
        delayMs: (row?.lastRequestedAt ?? now) + FORCE_DEBOUNCE_MS - now,
      };
    return undefined;
  };
  const titleRowDecision = decideFromRequestRow(rows[0]);
  const seasonRowDecision = args.season === undefined ? undefined : decideFromRequestRow(rows[1]);
  const combineRejectedDecisions = (
    titleDecision: NonNullable<typeof titleRowDecision>,
    seasonDecision?: NonNullable<typeof seasonRowDecision>,
  ) => {
    if (args.season === undefined) return titleDecision;
    return {
      scheduled: false as const,
      title: titleDecision,
      season: seasonDecision!,
      expiresAt: Math.max(titleDecision.expiresAt, seasonDecision!.expiresAt),
      delayMs: Math.max(titleDecision.delayMs, seasonDecision!.delayMs),
    };
  };
  if (titleRowDecision && (args.season === undefined || seasonRowDecision))
    return combineRejectedDecisions(titleRowDecision, seasonRowDecision);

  const writeRequest = async (
    key: string,
    row: Doc<'metadataRefreshRequests'> | null,
    attemptToken: string,
    expiresAt: number,
  ) => {
    const next = {
      key,
      state: 'inFlight' as const,
      lastRequestedAt: now,
      attemptToken,
      expiresAt,
      retryAt: undefined,
    };
    if (row) await ctx.db.replace(row._id, next);
    else await ctx.db.insert('metadataRefreshRequests', next);
  };

  const activeLease = await ctx.db
    .query('metadataRefreshLeases')
    .withIndex('by_key', (query) => query.eq('key', refreshLeaseKey(args.mediaType, args.tmdbId)))
    .unique();
  if (activeLease && activeLease.expiresAt > now) {
    const scheduledAttemptToken = activeLease.token.startsWith('scheduled:')
      ? activeLease.token.slice('scheduled:'.length)
      : undefined;
    const scheduledRequests = scheduledAttemptToken
      ? await ctx.db
          .query('metadataRefreshRequests')
          .withIndex('by_attempt_token', (query) => query.eq('attemptToken', scheduledAttemptToken))
          .take(2)
      : [];
    const scheduledSeasonOnlyLease =
      scheduledRequests.some((request) => request.key.startsWith('season:')) &&
      scheduledRequests.every((request) => !request.key.startsWith('title:'));
    const leaseDecision = {
      scheduled: false as const,
      reason: 'inFlight' as const,
      expiresAt: activeLease.expiresAt,
      delayMs: activeLease.expiresAt - now,
    };
    const titleDecision = titleRowDecision ?? leaseDecision;
    const seasonDecision =
      args.season === undefined ? undefined : (seasonRowDecision ?? leaseDecision);
    if (activeLease.token.startsWith('synchronous:')) {
      // A synchronous title action can adopt its title and whichever selected
      // season provider discovery chooses. A season-only action
      // gives a newly arriving title touch its own orchestrator instead.
      // Admission happens before any row is written, so a rejected touch leaves
      // no request row behind.
      const admittedRows = [
        ...(!titleRowDecision ? [{ index: 0, key: keys[0] }] : []),
        ...(args.season !== undefined && !seasonRowDecision ? [{ index: 1, key: keys[1] }] : []),
      ];
      await consumeRefreshAdmission(
        ctx,
        args.userId,
        admittedRows.filter(({ index }) => !rows[index]).length,
      );
      let independentlyScheduledTitle:
        { scheduled: true; attemptToken: string; expiresAt: number; delayMs: number } | undefined;
      if (!titleRowDecision) {
        if (activeLease.token.startsWith('synchronous:season:')) {
          const attemptToken = `${now}:title:${crypto.randomUUID()}`;
          const expiresAt = now + REQUEST_LEASE_MS;
          await writeRequest(keys[0], rows[0], attemptToken, expiresAt);
          await ctx.scheduler.runAfter(0, internal.resolvedMetadata.orchestrateRefresh, {
            userId: args.userId,
            mediaType: args.mediaType,
            tmdbId: args.tmdbId,
            ...(args.title !== undefined && { title: args.title }),
            ...(args.force !== undefined && { force: args.force }),
            keys: [keys[0]],
            attemptToken,
          });
          independentlyScheduledTitle = {
            scheduled: true,
            attemptToken,
            expiresAt,
            delayMs: expiresAt - now,
          };
        } else await writeRequest(keys[0], rows[0], activeLease.token, activeLease.expiresAt);
      }
      if (args.season !== undefined && !seasonRowDecision) {
        const attemptToken = `${now}:season:${crypto.randomUUID()}`;
        const expiresAt = now + REQUEST_LEASE_MS;
        await writeRequest(keys[1], rows[1], attemptToken, expiresAt);
        await ctx.scheduler.runAfter(0, internal.resolvedMetadata.orchestrateSeasonRefresh, {
          userId: args.userId,
          tmdbId: args.tmdbId,
          season: args.season,
          ...(args.force !== undefined && { force: args.force }),
          key: keys[1],
          attemptToken,
        });
        const scheduledSeason = {
          scheduled: true as const,
          attemptToken,
          expiresAt,
          delayMs: expiresAt - now,
        };
        const scheduledTitle = independentlyScheduledTitle ?? titleDecision;
        return {
          scheduled: true,
          title: scheduledTitle,
          season: scheduledSeason,
          expiresAt: Math.max(scheduledTitle.expiresAt, scheduledSeason.expiresAt),
          delayMs: Math.max(scheduledTitle.delayMs, scheduledSeason.delayMs),
        };
      }
      if (independentlyScheduledTitle) {
        if (args.season === undefined) return independentlyScheduledTitle;
        return {
          scheduled: true,
          title: independentlyScheduledTitle,
          season: seasonDecision!,
          expiresAt: Math.max(independentlyScheduledTitle.expiresAt, seasonDecision!.expiresAt),
          delayMs: Math.max(independentlyScheduledTitle.delayMs, seasonDecision!.delayMs),
        };
      }
    } else if (!titleRowDecision && scheduledSeasonOnlyLease) {
      // A season-only scheduled holder can only season-patch. Give a colliding
      // title touch its own durable request and orchestrator so it waits for the
      // shared lease and eventually performs the title refresh.
      await consumeRefreshAdmission(
        ctx,
        args.userId,
        Number(!rows[0]) + Number(args.season !== undefined && !seasonRowDecision && !rows[1]),
      );
      const titleAttemptToken = `${now}:title:${crypto.randomUUID()}`;
      const titleExpiresAt = now + REQUEST_LEASE_MS;
      await writeRequest(keys[0], rows[0], titleAttemptToken, titleExpiresAt);
      await ctx.scheduler.runAfter(0, internal.resolvedMetadata.orchestrateRefresh, {
        userId: args.userId,
        mediaType: args.mediaType,
        tmdbId: args.tmdbId,
        ...(args.title !== undefined && { title: args.title }),
        ...(args.force !== undefined && { force: args.force }),
        keys: [keys[0]],
        attemptToken: titleAttemptToken,
      });
      const scheduledTitle = {
        scheduled: true as const,
        attemptToken: titleAttemptToken,
        expiresAt: titleExpiresAt,
        delayMs: titleExpiresAt - now,
      };
      if (args.season === undefined) return scheduledTitle;

      if (!seasonRowDecision) {
        const seasonAttemptToken = `${now}:season:${crypto.randomUUID()}`;
        const seasonExpiresAt = now + REQUEST_LEASE_MS;
        await writeRequest(keys[1], rows[1], seasonAttemptToken, seasonExpiresAt);
        await ctx.scheduler.runAfter(0, internal.resolvedMetadata.orchestrateSeasonRefresh, {
          userId: args.userId,
          tmdbId: args.tmdbId,
          season: args.season,
          ...(args.force !== undefined && { force: args.force }),
          key: keys[1],
          attemptToken: seasonAttemptToken,
        });
        const scheduledSeason = {
          scheduled: true,
          attemptToken: seasonAttemptToken,
          expiresAt: seasonExpiresAt,
          delayMs: seasonExpiresAt - now,
        };
        return {
          scheduled: true,
          title: scheduledTitle,
          season: scheduledSeason,
          expiresAt: Math.max(scheduledTitle.expiresAt, scheduledSeason.expiresAt),
          delayMs: Math.max(scheduledTitle.delayMs, scheduledSeason.delayMs),
        };
      }
      return {
        scheduled: true,
        title: scheduledTitle,
        season: seasonDecision!,
        expiresAt: Math.max(scheduledTitle.expiresAt, seasonDecision!.expiresAt),
        delayMs: Math.max(scheduledTitle.delayMs, seasonDecision!.delayMs),
      };
    } else if (args.season !== undefined && !seasonRowDecision) {
      // A scheduled title/season holder cannot adopt a newly requested sibling
      // season. Persist and orchestrate it independently so it survives this
      // mutation and waits for the shared title lease instead of being stranded.
      await consumeRefreshAdmission(ctx, args.userId, rows[1] ? 0 : 1);
      const attemptToken = `${now}:season:${crypto.randomUUID()}`;
      const expiresAt = now + REQUEST_LEASE_MS;
      await writeRequest(keys[1], rows[1], attemptToken, expiresAt);
      await ctx.scheduler.runAfter(0, internal.resolvedMetadata.orchestrateSeasonRefresh, {
        userId: args.userId,
        tmdbId: args.tmdbId,
        season: args.season,
        ...(args.force !== undefined && { force: args.force }),
        key: keys[1],
        attemptToken,
      });
      const scheduledSeason = {
        scheduled: true as const,
        attemptToken,
        expiresAt,
        delayMs: expiresAt - now,
      };
      return {
        scheduled: true,
        title: titleDecision,
        season: scheduledSeason,
        expiresAt: Math.max(titleDecision.expiresAt, scheduledSeason.expiresAt),
        delayMs: Math.max(titleDecision.delayMs, scheduledSeason.delayMs),
      };
    }
    return combineRejectedDecisions(titleDecision, seasonDecision);
  }

  // Successful debounce visibility only needs canonical parent rows. In
  // particular, touch admission never assembles or reads season chunks.
  const [mapping, storedTitle, storedSeasonParent] = await Promise.all([
    ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', args.mediaType).eq('tmdbId', args.tmdbId))
      .unique(),
    ctx.db
      .query('resolvedTitles')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', args.mediaType).eq('tmdbId', args.tmdbId))
      .unique(),
    args.season === undefined
      ? Promise.resolve(null)
      : ctx.db
          .query('resolvedSeasons')
          .withIndex('by_tmdb_season', (q) =>
            q.eq('tmdbId', args.tmdbId).eq('season', args.season!),
          )
          .unique(),
  ]);
  const titleVisible =
    !!storedTitle &&
    (mapping?.orderEpoch === undefined || storedTitle.orderEpoch === mapping.orderEpoch);
  const seasonVisible =
    !!mapping &&
    !!storedSeasonParent &&
    storedSeasonParent.orderEpoch === mapping.orderEpoch &&
    storedSeasonParent.chunkCount !== undefined &&
    storedSeasonParent.seasonVersion !== undefined &&
    storedSeasonParent.chunksComplete === true;
  const decideVisibleKey = (
    row: Doc<'metadataRefreshRequests'> | null,
    rowDecision: ReturnType<typeof decideFromRequestRow>,
    dataVisible: boolean,
  ) => {
    if (rowDecision) return rowDecision;
    const cooldown = args.force ? FORCE_DEBOUNCE_MS : DEBOUNCE_MS;
    if (dataVisible && row?.state === 'succeeded' && (row.completedAt ?? 0) > now - cooldown)
      return {
        scheduled: false as const,
        reason: 'debounced' as const,
        expiresAt: (row.completedAt ?? now) + cooldown,
        delayMs: (row.completedAt ?? now) + cooldown - now,
      };
    return { scheduled: true as const };
  };

  const titleDecision = decideVisibleKey(rows[0], titleRowDecision, titleVisible);
  const seasonDecision =
    args.season === undefined
      ? undefined
      : decideVisibleKey(rows[1], seasonRowDecision, seasonVisible);
  if (!titleDecision.scheduled && !seasonDecision?.scheduled) {
    if (args.season === undefined) return titleDecision;
    return {
      scheduled: false,
      title: titleDecision,
      season: seasonDecision!,
      expiresAt: Math.max(titleDecision.expiresAt, seasonDecision!.expiresAt),
      delayMs: Math.max(titleDecision.delayMs, seasonDecision!.delayMs),
    };
  }

  // The state/debounce ingress guard above is intentionally read-only. Only work
  // that can schedule an orchestrator consumes the shared throttle budgets.
  const newKeyCount =
    Number(!rows[0] && !titleVisible) +
    Number(args.season !== undefined && !rows[1] && !seasonVisible);
  await consumeRefreshAdmission(ctx, args.userId, newKeyCount);

  const expiresAt = now + REQUEST_LEASE_MS;

  // A title refresh owns the selected season as part of the same attempt, even
  // when that season was otherwise fresh. Both request rows and all canonical
  // documents are completed by the one commitRefresh transaction.
  if (titleDecision.scheduled) {
    const attemptToken = `${now}:title:${crypto.randomUUID()}`;
    const combinedSeason =
      args.season !== undefined &&
      seasonRowDecision?.reason !== 'inFlight' &&
      seasonRowDecision?.reason !== 'backoff';
    await writeRequest(keys[0], rows[0], attemptToken, expiresAt);
    if (combinedSeason) await writeRequest(keys[1], rows[1], attemptToken, expiresAt);
    const claimedKeys = [keys[0], ...(combinedSeason ? [keys[1]] : [])];
    await ctx.scheduler.runAfter(0, internal.resolvedMetadata.orchestrateRefresh, {
      userId: args.userId,
      mediaType: args.mediaType,
      tmdbId: args.tmdbId,
      ...(args.title !== undefined && { title: args.title }),
      ...(combinedSeason && { season: args.season }),
      ...(args.force !== undefined && { force: args.force }),
      keys: claimedKeys,
      attemptToken,
    });
    const titleResult = {
      scheduled: true as const,
      attemptToken,
      expiresAt,
      delayMs: expiresAt - now,
    };
    if (args.season === undefined) return titleResult;
    const seasonResult = combinedSeason
      ? { scheduled: true as const, attemptToken, expiresAt, delayMs: expiresAt - now }
      : seasonRowDecision!;
    return {
      scheduled: true,
      title: titleResult,
      season: seasonResult,
      expiresAt: Math.max(titleResult.expiresAt, seasonResult.expiresAt),
      delayMs: Math.max(titleResult.delayMs, seasonResult.delayMs),
    };
  }

  // Round 2's title-in-flight collision path remains season-scoped, but its
  // orchestrator now commits through the same atomic mutation as combined work.
  const attemptToken = `${now}:season:${crypto.randomUUID()}`;
  await writeRequest(keys[1], rows[1], attemptToken, expiresAt);
  await ctx.scheduler.runAfter(0, internal.resolvedMetadata.orchestrateSeasonRefresh, {
    userId: args.userId,
    tmdbId: args.tmdbId,
    season: args.season!,
    ...(args.force !== undefined && { force: args.force }),
    key: keys[1],
    attemptToken,
  });
  const titleResult = titleDecision;
  const seasonResult = {
    scheduled: true as const,
    attemptToken,
    expiresAt,
    delayMs: expiresAt - now,
  };
  if (args.season === undefined) return titleResult;
  return {
    scheduled: true,
    title: titleResult,
    season: seasonResult,
    expiresAt: Math.max(titleResult.expiresAt, seasonResult.expiresAt),
    delayMs: Math.max(titleResult.delayMs, seasonResult.delayMs),
  };
}

export const touchItemView = mutation({
  args: { itemId: v.id('items'), season: v.optional(v.number()), force: v.optional(v.boolean()) },
  returns: refreshResultValidator,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item || item.userId !== userId || item.deletingAt !== undefined)
      throw new Error('Item not found');
    if (args.season !== undefined) validateId('season', args.season, 10_000);
    return requestRefresh(ctx, {
      userId,
      mediaType: item.mediaType,
      tmdbId: item.tmdbId,
      title: item.title,
      season: args.season,
      force: args.force,
    });
  },
});

export const touchTitle = mutation({
  args: {
    mediaType,
    tmdbId: v.number(),
    title: v.optional(v.string()),
    season: v.optional(v.number()),
    force: v.optional(v.boolean()),
  },
  returns: refreshResultValidator,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    validateId('tmdbId', args.tmdbId);
    const title = args.title?.trim();
    if (title !== undefined && (!title || title.length > 500))
      throw new Error('Title must be between 1 and 500 characters');
    if (args.season !== undefined) validateId('season', args.season, 10_000);
    if (args.mediaType === 'movie' && args.season !== undefined)
      throw new Error('Movies do not have seasons');
    return requestRefresh(ctx, { userId, ...args, ...(title !== undefined && { title }) });
  },
});

async function publishCanonicalMetadata(
  ctx: MutationCtx,
  args: {
    title: ResolvedTitle;
    titleWrite: 'replace' | 'seasonPatch';
    season?: { season: number; episodeCount: number };
    mapping?: MappingWrite;
    writeTitle: boolean;
    writeSeason: boolean;
    now: number;
  },
  currentMapping: Doc<'titleMappings'> | null,
  existingTitle: Doc<'resolvedTitles'> | null,
) {
  const refreshed = (args.titleWrite === 'replace' && args.writeTitle) || args.writeSeason;
  if (args.titleWrite === 'replace' && args.writeTitle) {
    const title =
      args.writeSeason && args.season
        ? {
            ...args.title,
            seasons: args.title.seasons.flatMap((entry) =>
              entry.season !== args.season!.season
                ? [entry]
                : args.season!.episodeCount > 0
                  ? [{ ...entry, episodeCount: args.season!.episodeCount }]
                  : [],
            ),
          }
        : args.title;
    if (existingTitle) await ctx.db.replace(existingTitle._id, title);
    else await ctx.db.insert('resolvedTitles', title);
    await ctx.scheduler.runAfter(0, internal.resolvedMetadata.refreshItemProjections, {
      mediaType: title.mediaType,
      tmdbId: title.tmdbId,
    });
  } else if (
    args.titleWrite === 'seasonPatch' &&
    args.writeSeason &&
    args.season &&
    existingTitle
  ) {
    await ctx.db.patch(existingTitle._id, {
      seasons: existingTitle.seasons.map((entry) =>
        entry.season === args.season!.season
          ? { ...entry, episodeCount: args.season!.episodeCount }
          : entry,
      ),
    });
  }

  if (!refreshed) return;
  if (!currentMapping) {
    if (args.mapping) await ctx.db.insert('titleMappings', args.mapping);
    return;
  }
  if (args.mapping && currentMapping.source === 'auto') {
    const identityChanged =
      currentMapping.tvdbId !== args.mapping.tvdbId ||
      currentMapping.seasonOrder !== args.mapping.seasonOrder;
    const expectedEpoch = currentMapping.orderEpoch + (identityChanged ? 1 : 0);
    if (args.mapping.orderEpoch !== expectedEpoch)
      throw new Error(
        'An automatic mapping identity change must increment orderEpoch exactly once',
      );
    await ctx.db.replace(currentMapping._id, args.mapping);
    return;
  }
  // Manual mapping identity is authoritative and can only be changed by the
  // explicit mapping controls, never by provider discovery.
  await ctx.db.patch(currentMapping._id, { updatedAt: args.now });
}

/** Keeps the library's display projection current without adding list-time joins. */
export const refreshItemProjections = internalMutation({
  args: { mediaType, tmdbId: v.number(), cursor: v.optional(v.string()) },
  returns: v.object({ updated: v.number(), isDone: v.boolean() }),
  handler: async (ctx, { mediaType: type, tmdbId, cursor }) => {
    const [title, mapping] = await Promise.all([
      ctx.db
        .query('resolvedTitles')
        .withIndex('by_tmdb', (query) => query.eq('mediaType', type).eq('tmdbId', tmdbId))
        .unique(),
      ctx.db
        .query('titleMappings')
        .withIndex('by_tmdb', (query) => query.eq('mediaType', type).eq('tmdbId', tmdbId))
        .unique(),
    ]);
    if (!title || (mapping && title.orderEpoch !== mapping.orderEpoch))
      return { updated: 0, isDone: true };
    const page = await ctx.db
      .query('items')
      .withIndex('by_media_tmdb', (query) => query.eq('mediaType', type).eq('tmdbId', tmdbId))
      .paginate({ cursor: cursor ?? null, numItems: 10 });
    const runtime =
      title.runtime ??
      (title.episodeRunTime.length
        ? title.episodeRunTime.reduce((sum, value) => sum + value, 0) / title.episodeRunTime.length
        : undefined);
    for (const item of page.page) {
      await ctx.db.patch(item._id, {
        title: title.title,
        normalizedTitle: title.title.toLocaleLowerCase(),
        posterPath: title.posterPath,
        overview: title.overview,
        releaseDate: title.releaseDate ?? title.firstAirDate,
        runtime,
        genres: title.genres,
        isAnime: title.genres.some((genre) => genre.toLocaleLowerCase() === 'anime'),
      });
      if (type === 'tv') {
        await ctx.scheduler.runAfter(0, internal.nextEpisode.startNextEpisodeRefresh, {
          itemId: item._id,
        });
        await ctx.scheduler.runAfter(
          0,
          internal.episodeProjectionRepair.startEpisodeProjectionRepair,
          { itemId: item._id },
        );
      }
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.resolvedMetadata.refreshItemProjections, {
        mediaType: type,
        tmdbId,
        cursor: page.continueCursor,
      });
    return { updated: page.page.length, isDone: page.isDone };
  },
});

type RefreshOutcome = {
  key: string;
  state: 'succeeded' | 'failed' | 'notFound';
  errorCode?: string;
};

/**
 * Resolves the explicit attempt outcome plus late request rows that attached to
 * the same lease token before this publication transaction began.
 */
async function requestsForPublication(
  ctx: MutationCtx,
  explicitOutcomes: RefreshOutcome[],
  publicationKeys: string[],
  attemptToken: string,
  now: number,
) {
  const explicitByKey = new Map(explicitOutcomes.map((outcome) => [outcome.key, outcome]));
  const keys = [...new Set([...explicitByKey.keys(), ...publicationKeys])];
  const rows = await Promise.all(
    keys.map((key) =>
      ctx.db
        .query('metadataRefreshRequests')
        .withIndex('by_key', (query) => query.eq('key', key))
        .unique(),
    ),
  );
  const attached: { row: Doc<'metadataRefreshRequests'>; outcome: RefreshOutcome }[] = [];
  for (const [index, key] of keys.entries()) {
    const row = rows[index];
    const explicit = explicitByKey.get(key);
    if (explicit) {
      if (
        !row ||
        row.state !== 'inFlight' ||
        row.expiresAt <= now ||
        row.attemptToken !== attemptToken
      )
        return null;
      attached.push({ row, outcome: explicit });
      continue;
    }
    if (!row || row.state !== 'inFlight' || row.attemptToken !== attemptToken) continue;
    if (row.expiresAt <= now) return null;
    attached.push({ row, outcome: { key, state: 'succeeded' } });
  }
  return attached;
}

async function visiblePublicationOutcomes(
  ctx: MutationCtx,
  attached: { row: Doc<'metadataRefreshRequests'>; outcome: RefreshOutcome }[],
  args: { mediaType: MediaType; tmdbId: number; season?: number },
) {
  const [mapping, title, seasonParent] = await Promise.all([
    ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (query) =>
        query.eq('mediaType', args.mediaType).eq('tmdbId', args.tmdbId),
      )
      .unique(),
    ctx.db
      .query('resolvedTitles')
      .withIndex('by_tmdb', (query) =>
        query.eq('mediaType', args.mediaType).eq('tmdbId', args.tmdbId),
      )
      .unique(),
    args.season === undefined
      ? Promise.resolve(null)
      : ctx.db
          .query('resolvedSeasons')
          .withIndex('by_tmdb_season', (query) =>
            query.eq('tmdbId', args.tmdbId).eq('season', args.season!),
          )
          .unique(),
  ]);
  const titleVisible =
    title !== null &&
    (mapping?.orderEpoch === undefined || title.orderEpoch === mapping.orderEpoch);
  const seasonVisible =
    mapping !== null &&
    seasonParent !== null &&
    seasonParent.orderEpoch === mapping.orderEpoch &&
    seasonParent.chunkCount !== undefined &&
    seasonParent.seasonVersion !== undefined &&
    seasonParent.chunksComplete === true;
  return attached.map(({ row, outcome }) => {
    const visible = outcome.key.startsWith('season:') ? seasonVisible : titleVisible;
    return {
      row,
      outcome:
        outcome.state === 'succeeded' && !visible
          ? {
              ...outcome,
              state: 'failed' as const,
              errorCode: 'publication_invisible',
            }
          : outcome,
    };
  });
}

export const commitRefresh = internalMutation({
  args: {
    title: resolvedTitleValidator,
    titleWrite: v.optional(v.union(v.literal('replace'), v.literal('seasonPatch'))),
    season: v.optional(
      v.object({
        tmdbId: v.number(),
        season: v.number(),
        metadataProvider: v.union(v.literal('tmdb'), v.literal('tvdb')),
        chunks: v.array(v.array(resolvedEpisodeValidator)),
        episodeCount: v.number(),
        chunkCount: v.number(),
        refreshedAt: v.number(),
        refreshAfter: v.number(),
        orderEpoch: v.number(),
      }),
    ),
    mapping: v.optional(
      v.object({
        tmdbId: v.number(),
        mediaType,
        tvdbId: v.optional(v.number()),
        seasonOrder: v.optional(v.string()),
        source: v.union(v.literal('auto'), v.literal('manual')),
        orderEpoch: v.number(),
        updatedAt: v.number(),
      }),
    ),
    expectedMapping: v.optional(
      v.union(
        v.null(),
        v.object({
          tvdbId: v.optional(v.number()),
          seasonOrder: v.optional(v.string()),
          source: v.union(v.literal('auto'), v.literal('manual')),
          orderEpoch: v.number(),
        }),
      ),
    ),
    keys: v.optional(v.array(v.string())),
    outcomes: v.optional(v.array(refreshOutcomeValidator)),
    attemptToken: v.string(),
    leaseKey: v.string(),
    leaseToken: v.string(),
  },
  handler: async (ctx, args) => {
    assertMetadataMutationSize(args, 'commitRefresh');
    const now = Date.now();
    if (args.leaseKey !== refreshLeaseKey(args.title.mediaType, args.title.tmdbId)) return false;
    const lease = await ctx.db
      .query('metadataRefreshLeases')
      .withIndex('by_key', (query) => query.eq('key', args.leaseKey))
      .unique();
    if (!lease || lease.token !== args.leaseToken || lease.expiresAt <= now) return false;
    // This is deliberately checked before the first write. A newer touch may have
    // superseded an outbound attempt while it was waiting on a provider.
    const outcomes: RefreshOutcome[] =
      args.outcomes ?? (args.keys ?? []).map((key) => ({ key, state: 'succeeded' as const }));
    const currentMapping = await ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (q) =>
        q.eq('mediaType', args.title.mediaType).eq('tmdbId', args.title.tmdbId),
      )
      .unique();
    if (
      args.expectedMapping !== undefined &&
      !sameMappingIdentity(args.expectedMapping, currentMapping)
    )
      return 'mappingChanged' as const;
    const existingTitle = await ctx.db
      .query('resolvedTitles')
      .withIndex('by_tmdb', (q) =>
        q.eq('mediaType', args.title.mediaType).eq('tmdbId', args.title.tmdbId),
      )
      .unique();
    const titleOutcome = outcomes.find((outcome) => outcome.key.startsWith('title:'));
    const seasonOutcome = outcomes.find((outcome) => outcome.key.startsWith('season:'));
    const writeTitle = titleOutcome?.state !== 'failed' && titleOutcome?.state !== 'notFound';
    const writeSeason =
      args.season !== undefined &&
      seasonOutcome?.state !== 'failed' &&
      seasonOutcome?.state !== 'notFound';
    const requests = await requestsForPublication(
      ctx,
      outcomes,
      [
        ...(writeTitle ? [requestKey(args.title.mediaType, args.title.tmdbId)] : []),
        ...(writeSeason ? [seasonRequestKey(args.title.tmdbId, args.season!.season)] : []),
      ],
      args.attemptToken,
      now,
    );
    if (!requests) return false;
    if (writeSeason) {
      await beginPrechunkedSeasonWrite(ctx, args.season!, args.attemptToken);
      if (args.season!.chunkCount > 1) {
        const parent = await ctx.db
          .query('resolvedSeasons')
          .withIndex('by_tmdb_season', (query) =>
            query.eq('tmdbId', args.season!.tmdbId).eq('season', args.season!.season),
          )
          .unique();
        if (!parent || parent.stagingVersion !== args.attemptToken)
          throw new Error('A multi-chunk season could not be staged');
        await ctx.db.patch(parent._id, {
          stagingTitle: args.title,
          stagingTitleWrite: args.titleWrite ?? 'replace',
          stagingMapping: args.mapping ?? null,
          stagingExpectedMapping: args.expectedMapping ?? null,
        });
        return 'staged' as const;
      }
      const finalized = await finalizePrechunkedSeasonWrite(ctx, {
        tmdbId: args.season!.tmdbId,
        season: args.season!.season,
        attemptToken: args.attemptToken,
      });
      if (!finalized) throw new Error('A single-chunk season could not be published');
    }
    await publishCanonicalMetadata(
      ctx,
      {
        title: args.title,
        titleWrite: args.titleWrite ?? 'replace',
        ...(args.season && {
          season: { season: args.season.season, episodeCount: args.season.episodeCount },
        }),
        ...(args.mapping && { mapping: args.mapping }),
        writeTitle,
        writeSeason,
        now,
      },
      currentMapping,
      existingTitle,
    );
    if (writeSeason)
      await ctx.scheduler.runAfter(0, internal.episodeSummaries.reconcileSeasonSummaries, {
        tmdbId: args.title.tmdbId,
        season: args.season!.season,
      });
    const publishedRequests = await visiblePublicationOutcomes(ctx, requests, {
      mediaType: args.title.mediaType,
      tmdbId: args.title.tmdbId,
      ...(args.season && { season: args.season.season }),
    });
    for (const { row, outcome } of publishedRequests) {
      await ctx.db.patch(row._id, {
        state: outcome.state,
        completedAt: now,
        expiresAt: now,
        retryAt: outcome.state === 'failed' ? now + FAILED_TOUCH_BACKOFF_MS : undefined,
        ...(outcome.errorCode ? { errorCode: outcome.errorCode } : { errorCode: undefined }),
      });
    }
    return true;
  },
});

export const appendRefreshSeasonChunk = internalMutation({
  args: {
    tmdbId: v.number(),
    season: v.number(),
    orderEpoch: v.number(),
    chunkIndex: v.number(),
    episodes: v.array(resolvedEpisodeValidator),
    attemptToken: v.string(),
  },
  handler: (ctx, args) => {
    assertMetadataMutationSize(args, 'appendRefreshSeasonChunk');
    return appendPrechunkedSeasonChunk(ctx, args);
  },
});

export const finalizeRefreshSeason = internalMutation({
  args: {
    tmdbId: v.number(),
    season: v.number(),
    outcomes: v.array(refreshOutcomeValidator),
    expectedMapping: v.union(
      v.null(),
      v.object({
        tvdbId: v.optional(v.number()),
        seasonOrder: v.optional(v.string()),
        source: v.union(v.literal('auto'), v.literal('manual')),
        orderEpoch: v.number(),
      }),
    ),
    attemptToken: v.string(),
    leaseKey: v.string(),
    leaseToken: v.string(),
  },
  handler: async (ctx, args) => {
    assertMetadataMutationSize(args, 'finalizeRefreshSeason');
    const now = Date.now();
    if (args.leaseKey !== refreshLeaseKey('tv', args.tmdbId)) return false;
    const [lease, mapping, parent, existingTitle] = await Promise.all([
      ctx.db
        .query('metadataRefreshLeases')
        .withIndex('by_key', (query) => query.eq('key', args.leaseKey))
        .unique(),
      ctx.db
        .query('titleMappings')
        .withIndex('by_tmdb', (query) => query.eq('mediaType', 'tv').eq('tmdbId', args.tmdbId))
        .unique(),
      ctx.db
        .query('resolvedSeasons')
        .withIndex('by_tmdb_season', (query) =>
          query.eq('tmdbId', args.tmdbId).eq('season', args.season),
        )
        .unique(),
      ctx.db
        .query('resolvedTitles')
        .withIndex('by_tmdb', (query) => query.eq('mediaType', 'tv').eq('tmdbId', args.tmdbId))
        .unique(),
    ]);
    if (!lease || lease.token !== args.leaseToken || lease.expiresAt <= now) return false;
    if (
      !parent ||
      parent.stagingVersion !== args.attemptToken ||
      parent.stagingTitle === undefined ||
      parent.stagingTitleWrite === undefined ||
      parent.stagingExpectedMapping === undefined
    )
      return false;
    const stagedExpectedMapping = parent.stagingExpectedMapping as MappingIdentity | null;
    if (
      !sameMappingIdentity(args.expectedMapping, mapping) ||
      !sameMappingIdentity(stagedExpectedMapping, mapping)
    )
      return 'mappingChanged' as const;
    const titleOutcome = args.outcomes.find((outcome) => outcome.key.startsWith('title:'));
    const seasonOutcome = args.outcomes.find((outcome) => outcome.key.startsWith('season:'));
    const writeTitle = titleOutcome?.state !== 'failed' && titleOutcome?.state !== 'notFound';
    const writeSeason = seasonOutcome?.state !== 'failed' && seasonOutcome?.state !== 'notFound';
    const requests = await requestsForPublication(
      ctx,
      args.outcomes,
      [
        ...(writeTitle ? [requestKey('tv', args.tmdbId)] : []),
        ...(writeSeason ? [seasonRequestKey(args.tmdbId, args.season)] : []),
      ],
      args.attemptToken,
      now,
    );
    if (!requests) return false;
    const finalized = await finalizePrechunkedSeasonWrite(ctx, {
      tmdbId: args.tmdbId,
      season: args.season,
      attemptToken: args.attemptToken,
    });
    if (!finalized) return false;
    await publishCanonicalMetadata(
      ctx,
      {
        title: parent.stagingTitle as ResolvedTitle,
        titleWrite: parent.stagingTitleWrite,
        season: {
          season: args.season,
          episodeCount: parent.stagingEpisodeCount!,
        },
        ...(parent.stagingMapping !== null && parent.stagingMapping !== undefined
          ? { mapping: parent.stagingMapping as MappingWrite }
          : {}),
        writeTitle,
        writeSeason,
        now,
      },
      mapping,
      existingTitle,
    );
    if (writeSeason)
      await ctx.scheduler.runAfter(0, internal.episodeSummaries.reconcileSeasonSummaries, {
        tmdbId: args.tmdbId,
        season: args.season,
      });
    const publishedRequests = await visiblePublicationOutcomes(ctx, requests, {
      mediaType: 'tv',
      tmdbId: args.tmdbId,
      season: args.season,
    });
    for (const { row, outcome } of publishedRequests) {
      await ctx.db.patch(row._id, {
        state: outcome.state,
        completedAt: now,
        expiresAt: now,
        retryAt: outcome.state === 'failed' ? now + FAILED_TOUCH_BACKOFF_MS : undefined,
        ...(outcome.errorCode ? { errorCode: outcome.errorCode } : { errorCode: undefined }),
      });
    }
    return true;
  },
});

function sameMappingIdentity(
  expected: MappingIdentity | null,
  current: Doc<'titleMappings'> | null,
) {
  if (expected === null) return current === null;
  return (
    current !== null &&
    current.tvdbId === expected.tvdbId &&
    current.seasonOrder === expected.seasonOrder &&
    current.source === expected.source &&
    current.orderEpoch === expected.orderEpoch
  );
}

const mappingIdentity = (mapping: Doc<'titleMappings'> | null): MappingIdentity | null =>
  mapping
    ? {
        ...(mapping.tvdbId !== undefined && { tvdbId: mapping.tvdbId }),
        ...(mapping.seasonOrder !== undefined && { seasonOrder: mapping.seasonOrder }),
        source: mapping.source,
        orderEpoch: mapping.orderEpoch,
      }
    : null;

export const readRefreshRequest = internalQuery({
  args: { key: v.string() },
  handler: (ctx, { key }) =>
    ctx.db
      .query('metadataRefreshRequests')
      .withIndex('by_key', (query) => query.eq('key', key))
      .unique(),
});

export const orchestrateRefresh = internalAction({
  args: {
    userId: v.id('users'),
    mediaType,
    tmdbId: v.number(),
    title: v.optional(v.string()),
    season: v.optional(v.number()),
    force: v.optional(v.boolean()),
    keys: v.array(v.string()),
    attemptToken: v.string(),
    mappingRetry: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const leaseKey = refreshLeaseKey(args.mediaType, args.tmdbId);
    const leaseToken = `scheduled:${args.attemptToken}`;
    let claimed = false;
    try {
      claimed = await ctx.runMutation(internal.resolvedMetadata.claimRefresh, {
        key: leaseKey,
        token: leaseToken,
        leaseMs: REFRESH_LEASE_MS,
        requestKeys: args.keys,
        attemptToken: args.attemptToken,
      });
      if (!claimed) {
        const pending = await Promise.all(
          args.keys.map(
            (key) =>
              ctx.runQuery(internal.resolvedMetadata.readRefreshRequest, {
                key,
              }) as Promise<Doc<'metadataRefreshRequests'> | null>,
          ),
        );
        if (
          pending.every(
            (request) =>
              request?.state === 'inFlight' &&
              request.attemptToken === args.attemptToken &&
              request.expiresAt > Date.now(),
          )
        ) {
          await ctx.runMutation(internal.resolvedMetadata.renewRefreshRequests, {
            keys: args.keys,
            attemptToken: args.attemptToken,
            requestMs: REQUEST_LEASE_MS,
          });
          await ctx.scheduler.runAfter(1_000, internal.resolvedMetadata.orchestrateRefresh, args);
          return;
        }
        throw new ConvexError({ code: 'refresh_in_progress', retryable: true });
      }
      const allowed = await ctx.runMutation(internal.tmdb.consumeThrottle, {
        key: `resolved:${args.userId}`,
      });
      if (!allowed) throw new ConvexError({ code: 'throttled' });
      const result = await resolveAndCommitCanonical(ctx, {
        mediaType: args.mediaType,
        tmdbId: args.tmdbId,
        title: args.title,
        requestedSeason: args.season,
        force: args.force ?? false,
        keys: args.keys,
        attemptToken: args.attemptToken,
        leaseKey,
        leaseToken,
      });
      if (result.commitStatus === 'mappingChanged' && !args.mappingRetry) {
        await ctx.scheduler.runAfter(100, internal.resolvedMetadata.orchestrateRefresh, {
          ...args,
          mappingRetry: true,
        });
        return;
      }
      if (result.commitStatus === 'mappingChanged')
        throw new ConvexError({ code: 'mapping_changed', retryable: true });
      if (!result.committed) return;
    } catch (error) {
      const settled = await ctx
        .runMutation(internal.resolvedMetadata.settleScheduledRefresh, {
          mediaType: args.mediaType,
          tmdbId: args.tmdbId,
          ...(args.season !== undefined && { season: args.season }),
          keys: args.keys,
          attemptToken: args.attemptToken,
          errorCode: errorCode(error),
        })
        .catch(() => 'unsettled' as const);
      void settled;
    } finally {
      if (claimed)
        await ctx
          .runMutation(internal.resolvedMetadata.releaseRefresh, {
            key: leaseKey,
            token: leaseToken,
          })
          .catch(() => undefined);
    }
  },
});

async function waitForTitleRequest(ctx: ActionCtx, tmdbId: number) {
  const deadline = Date.now() + 10_000;
  let waited = false;
  while (Date.now() < deadline) {
    const row: Doc<'metadataRefreshRequests'> | null = await ctx.runQuery(
      internal.resolvedMetadata.readRefreshRequest,
      { key: requestKey('tv', tmdbId) },
    );
    if (!row || row.state !== 'inFlight' || row.expiresAt <= Date.now()) return waited;
    waited = true;
    await pause(200);
  }
  return waited;
}

export const orchestrateSeasonRefresh = internalAction({
  args: {
    userId: v.id('users'),
    tmdbId: v.number(),
    season: v.number(),
    force: v.optional(v.boolean()),
    key: v.string(),
    attemptToken: v.string(),
    mappingRetry: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const leaseKey = refreshLeaseKey('tv', args.tmdbId);
    const leaseToken = `scheduled:${args.attemptToken}`;
    let claimed = false;
    try {
      await ctx.runMutation(internal.resolvedMetadata.renewRefreshRequests, {
        keys: [args.key],
        attemptToken: args.attemptToken,
        requestMs: REQUEST_LEASE_MS,
      });
      await waitForTitleRequest(ctx, args.tmdbId);
      claimed = await ctx.runMutation(internal.resolvedMetadata.claimRefresh, {
        key: leaseKey,
        token: leaseToken,
        leaseMs: REFRESH_LEASE_MS,
        requestKeys: [args.key],
        attemptToken: args.attemptToken,
      });
      if (!claimed) {
        const pending: Doc<'metadataRefreshRequests'> | null = await ctx.runQuery(
          internal.resolvedMetadata.readRefreshRequest,
          { key: args.key },
        );
        if (
          pending?.state === 'inFlight' &&
          pending.attemptToken === args.attemptToken &&
          pending.expiresAt > Date.now()
        ) {
          await ctx.scheduler.runAfter(1_000, internal.resolvedMetadata.orchestrateSeasonRefresh, {
            ...args,
          });
          return;
        }
        throw new ConvexError({ code: 'refresh_in_progress', retryable: true });
      }
      const allowed = await ctx.runMutation(internal.tmdb.consumeThrottle, {
        key: `resolved:${args.userId}`,
      });
      if (!allowed) throw new ConvexError({ code: 'throttled' });
      const [title, mapping, request] = await Promise.all([
        ctx.runQuery(internal.resolvedMetadata.readTitle, {
          mediaType: 'tv',
          tmdbId: args.tmdbId,
        }) as Promise<Doc<'resolvedTitles'> | null>,
        ctx.runQuery(internal.resolvedMetadata.readTitleMapping, {
          mediaType: 'tv',
          tmdbId: args.tmdbId,
        }) as Promise<Doc<'titleMappings'> | null>,
        ctx.runQuery(internal.resolvedMetadata.readRefreshRequest, {
          key: args.key,
        }) as Promise<Doc<'metadataRefreshRequests'> | null>,
      ]);
      if (!title || title.orderEpoch !== (mapping?.orderEpoch ?? 0))
        throw new ConvexError({ code: 'title_unavailable', retryable: true });
      const result = await resolveAndCommitCanonical(ctx, {
        mediaType: 'tv',
        tmdbId: args.tmdbId,
        title: title.title,
        requestedSeason: args.season,
        force:
          (args.force ?? false) &&
          !(
            request &&
            title.metadataProvider === 'tvdb' &&
            title.refreshedAt >= request.lastRequestedAt &&
            args.season === title.seasons.find((entry) => entry.season > 0)?.season
          ),
        keys: [args.key],
        attemptToken: args.attemptToken,
        leaseKey,
        leaseToken,
        currentTitle: title,
      });
      if (result.commitStatus === 'mappingChanged' && !args.mappingRetry) {
        await ctx.scheduler.runAfter(100, internal.resolvedMetadata.orchestrateSeasonRefresh, {
          ...args,
          mappingRetry: true,
        });
        return;
      }
      if (result.commitStatus === 'mappingChanged')
        throw new ConvexError({ code: 'mapping_changed', retryable: true });
      if (!result.committed) return;
    } catch (error) {
      const settled = await ctx
        .runMutation(internal.resolvedMetadata.settleScheduledRefresh, {
          mediaType: 'tv',
          tmdbId: args.tmdbId,
          season: args.season,
          keys: [args.key],
          attemptToken: args.attemptToken,
          errorCode: errorCode(error),
        })
        .catch(() => 'unsettled' as const);
      void settled;
    } finally {
      if (claimed)
        await ctx
          .runMutation(internal.resolvedMetadata.releaseRefresh, {
            key: leaseKey,
            token: leaseToken,
          })
          .catch(() => undefined);
    }
  },
});

/** Atomically fails every row adopted by a synchronous attempt and releases its lease. */
export const failSynchronousRefresh = internalMutation({
  args: {
    leaseKey: v.string(),
    attemptToken: v.string(),
    errorCode: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const [lease, requests] = await Promise.all([
      ctx.db
        .query('metadataRefreshLeases')
        .withIndex('by_key', (query) => query.eq('key', args.leaseKey))
        .unique(),
      ctx.db
        .query('metadataRefreshRequests')
        .withIndex('by_attempt_token', (query) => query.eq('attemptToken', args.attemptToken))
        .collect(),
    ]);
    let settled = 0;
    for (const request of requests) {
      if (request.state !== 'inFlight') continue;
      await ctx.db.patch(request._id, {
        state: 'failed',
        completedAt: now,
        expiresAt: now,
        retryAt: now + FAILED_TOUCH_BACKOFF_MS,
        errorCode: args.errorCode,
      });
      settled += 1;
    }
    if (lease?.token === args.attemptToken) await ctx.db.delete(lease._id);
    return settled;
  },
});

export const pruneRefreshLeases = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const leases = await ctx.db
      .query('metadataRefreshLeases')
      .withIndex('by_expires', (query) => query.lt('expiresAt', now))
      .take(500);
    await Promise.all(leases.map((document) => ctx.db.delete(document._id)));
    await ctx.scheduler.runAfter(0, internal.resolvedMetadata.pruneCanonicalData, {});
    return {
      leases: leases.length,
    };
  },
});

const CANONICAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const canonicalGcPhase = v.union(
  v.literal('titles'),
  v.literal('seasons'),
  v.literal('chunks'),
  v.literal('mappings'),
);

/** Bounded storage hygiene only: never resolves or refreshes provider metadata. */
export const pruneCanonicalData = internalMutation({
  args: { phase: v.optional(canonicalGcPhase), cursor: v.optional(v.string()) },
  handler: async (ctx, { phase = 'titles', cursor }) => {
    const now = Date.now();
    const cutoff = now - CANONICAL_RETENTION_MS;
    const stagingCutoff = now - REFRESH_LEASE_MS;
    const isReferenced = (mediaTypeValue: MediaType, tmdbId: number) =>
      ctx.db
        .query('items')
        .withIndex('by_media_tmdb', (query) =>
          query.eq('mediaType', mediaTypeValue).eq('tmdbId', tmdbId),
        )
        .first()
        .then((item) => item !== null);
    const hasActiveCanonicalWork = async (
      mediaTypeValue: MediaType,
      tmdbId: number,
      season?: number,
    ) => {
      const [lease, request] = await Promise.all([
        ctx.db
          .query('metadataRefreshLeases')
          .withIndex('by_key', (query) => query.eq('key', refreshLeaseKey(mediaTypeValue, tmdbId)))
          .unique(),
        ctx.db
          .query('metadataRefreshRequests')
          .withIndex('by_key', (query) =>
            query.eq(
              'key',
              season === undefined
                ? requestKey(mediaTypeValue, tmdbId)
                : seasonRequestKey(tmdbId, season),
            ),
          )
          .unique(),
      ]);
      return (lease !== null && lease.expiresAt > now) || request?.state === 'inFlight';
    };
    const hasLiveStagingLease = async (row: Doc<'resolvedSeasons'>) => {
      const attempt = row.stagingVersion ?? row.writeAttemptToken;
      if (attempt === undefined) return false;
      const lease = await ctx.db
        .query('metadataRefreshLeases')
        .withIndex('by_key', (query) => query.eq('key', refreshLeaseKey('tv', row.tmdbId)))
        .unique();
      return (
        lease !== null &&
        lease.expiresAt > now &&
        (lease.token === attempt || lease.token === `scheduled:${attempt}`)
      );
    };
    const clearOrphanedStaging = async (row: Doc<'resolvedSeasons'>) => {
      const stagingVersion = row.stagingVersion;
      if (stagingVersion === undefined) return { deleted: 0, parentDeleted: false };
      const chunks = await ctx.db
        .query('resolvedSeasonChunks')
        .withIndex('by_tmdb_season_version_chunk', (query) =>
          query
            .eq('tmdbId', row.tmdbId)
            .eq('season', row.season)
            .eq('seasonVersion', stagingVersion),
        )
        .take(51);
      if (chunks.length > 50) return { deleted: 0, parentDeleted: false };
      for (const chunk of chunks) await ctx.db.delete(chunk._id);
      const hasVisibleSeason = row.chunkCount !== undefined && row.seasonVersion !== undefined;
      if (!hasVisibleSeason) {
        await ctx.db.delete(row._id);
        return { deleted: chunks.length + 1, parentDeleted: true };
      }
      await ctx.db.patch(row._id, {
        writeAttemptToken: undefined,
        nextChunkIndex: undefined,
        stagingVersion: undefined,
        stagingMetadataProvider: undefined,
        stagingEpisodeCount: undefined,
        stagingChunkCount: undefined,
        stagingRefreshedAt: undefined,
        stagingRefreshAfter: undefined,
        stagingOrderEpoch: undefined,
        stagingTitle: undefined,
        stagingTitleWrite: undefined,
        stagingMapping: undefined,
        stagingExpectedMapping: undefined,
      });
      return { deleted: chunks.length, parentDeleted: false };
    };

    let page;
    let deleted = 0;
    if (phase === 'titles') {
      page = await ctx.db
        .query('resolvedTitles')
        .withIndex('by_refreshed_at', (query) => query.lt('refreshedAt', cutoff))
        .paginate({ cursor: cursor ?? null, numItems: 40 });
      for (const row of page.page)
        if (
          !(await isReferenced(row.mediaType, row.tmdbId)) &&
          !(await hasActiveCanonicalWork(row.mediaType, row.tmdbId))
        ) {
          await ctx.db.delete(row._id);
          deleted += 1;
        }
    } else if (phase === 'seasons') {
      page = await ctx.db
        .query('resolvedSeasons')
        .withIndex('by_refreshed_at', (query) => query.lt('refreshedAt', stagingCutoff))
        .paginate({ cursor: cursor ?? null, numItems: 10 });
      for (const row of page.page) {
        if (await hasActiveCanonicalWork('tv', row.tmdbId, row.season)) continue;
        if (row.stagingVersion !== undefined) {
          const stagingIsRecent = (row.stagingRefreshedAt ?? row.refreshedAt) >= stagingCutoff;
          if (stagingIsRecent || (await hasLiveStagingLease(row))) continue;
          const cleaned = await clearOrphanedStaging(row);
          deleted += cleaned.deleted;
          if (cleaned.parentDeleted) continue;
        }
        if (row.refreshedAt >= cutoff) continue;
        if (row.chunkCount !== 0 && (await isReferenced('tv', row.tmdbId))) continue;
        const chunks = await ctx.db
          .query('resolvedSeasonChunks')
          .withIndex('by_tmdb_season_epoch_chunk', (query) =>
            query.eq('tmdbId', row.tmdbId).eq('season', row.season),
          )
          .take(51);
        if (chunks.length > 50) continue;
        for (const chunk of chunks) await ctx.db.delete(chunk._id);
        await ctx.db.delete(row._id);
        deleted += chunks.length + 1;
      }
    } else if (phase === 'chunks') {
      page = await ctx.db
        .query('resolvedSeasonChunks')
        .withIndex('by_refreshed_at', (query) => query.lt('refreshedAt', stagingCutoff))
        .paginate({ cursor: cursor ?? null, numItems: 40 });
      for (const row of page.page) {
        const parent = await ctx.db
          .query('resolvedSeasons')
          .withIndex('by_tmdb_season', (query) =>
            query.eq('tmdbId', row.tmdbId).eq('season', row.season),
          )
          .unique();
        if (await hasActiveCanonicalWork('tv', row.tmdbId, row.season)) continue;
        const visible =
          parent !== null &&
          parent.chunkCount !== undefined &&
          (parent.seasonVersion !== undefined
            ? row.seasonVersion === parent.seasonVersion
            : row.seasonVersion === undefined && row.orderEpoch === parent.orderEpoch);
        if (visible) {
          if ((row.refreshedAt ?? 0) >= cutoff || (await isReferenced('tv', row.tmdbId))) continue;
        } else {
          const activeStaging =
            parent !== null &&
            parent.stagingVersion !== undefined &&
            parent.stagingVersion === row.seasonVersion &&
            ((parent.stagingRefreshedAt ?? parent.refreshedAt) >= stagingCutoff ||
              (await hasLiveStagingLease(parent)));
          if (activeStaging) continue;
        }
        if (!visible || !(await isReferenced('tv', row.tmdbId))) {
          await ctx.db.delete(row._id);
          deleted += 1;
        }
      }
    } else {
      page = await ctx.db
        .query('titleMappings')
        .withIndex('by_updated_at', (query) => query.lt('updatedAt', cutoff))
        .paginate({ cursor: cursor ?? null, numItems: 40 });
      for (const row of page.page) {
        if (await isReferenced(row.mediaType, row.tmdbId)) continue;
        const [title, latestSeason] = await Promise.all([
          ctx.db
            .query('resolvedTitles')
            .withIndex('by_tmdb', (query) =>
              query.eq('mediaType', row.mediaType).eq('tmdbId', row.tmdbId),
            )
            .unique(),
          ctx.db
            .query('resolvedSeasons')
            .withIndex('by_tmdb_refreshed_at', (query) => query.eq('tmdbId', row.tmdbId))
            .order('desc')
            .first(),
        ]);
        if (
          Math.max(row.updatedAt, title?.refreshedAt ?? 0, latestSeason?.refreshedAt ?? 0) >= cutoff
        )
          continue;
        if (row.source === 'manual' && (title || latestSeason)) continue;
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.resolvedMetadata.pruneCanonicalData, {
        phase,
        cursor: page.continueCursor,
      });
    } else {
      const phases = ['titles', 'seasons', 'chunks', 'mappings'] as const;
      const next = phases[phases.indexOf(phase) + 1];
      if (next)
        await ctx.scheduler.runAfter(0, internal.resolvedMetadata.pruneCanonicalData, {
          phase: next,
        });
    }
    return { phase, deleted, isDone: page.isDone };
  },
});

export const pruneRefreshRequests = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query('metadataRefreshRequests')
      .withIndex('by_expires', (query) => query.lt('expiresAt', Date.now() - 24 * 60 * 60 * 1000))
      .paginate({ cursor: cursor ?? null, numItems: 200 });
    for (const request of page.page) await ctx.db.delete(request._id);
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.resolvedMetadata.pruneRefreshRequests, {
        cursor: page.continueCursor,
      });
    return { deleted: page.page.length, isDone: page.isDone };
  },
});

export const pruneRequestThrottle = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query('requestThrottle')
      .paginate({ cursor: cursor ?? null, numItems: 200 });
    let deleted = 0;
    for (const row of page.page)
      if (row.windowStart < Date.now() - 2 * 60 * 60 * 1000) {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.resolvedMetadata.pruneRequestThrottle, {
        cursor: page.continueCursor,
      });
    return { deleted, isDone: page.isDone };
  },
});

async function authorizeRefresh(ctx: { runMutation: Function }, userId: string) {
  const allowed = await ctx.runMutation(internal.tmdb.consumeThrottle, {
    key: `resolved:${userId}`,
  });
  if (!allowed) throw new Error('Too many metadata refreshes — try again shortly');
}

type ProviderOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

const settle = async <T>(promise: Promise<T>): Promise<ProviderOutcome<T>> => {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
};

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const errorCode = (error: unknown) => {
  if (error instanceof ConvexError && typeof error.data === 'object' && error.data !== null) {
    const code = Reflect.get(error.data, 'code');
    if (typeof code === 'string') return code;
  }
  return error instanceof Error ? error.name || 'error' : 'unknown';
};

const titleIsFresh = (title: Doc<'resolvedTitles'> | null) =>
  !!title && Date.now() < title.refreshAfter;

const seasonIsFresh = (season: AssembledSeason | null) =>
  !!season && Date.now() < season.refreshAfter;

const validateId = (name: string, value: number, max = 2 ** 31) => {
  if (!Number.isInteger(value) || value < 0 || value > max)
    throw new Error(`${name} must be a non-negative integer no greater than ${max}`);
};

const animeFromCurrent = (current: Doc<'resolvedTitles'> | null): ProviderAnime | null =>
  current?.metadataProvider === 'tvdb' && current.tvdbId && current.seasonOrder
    ? {
        tvdbId: current.tvdbId,
        firstAirDate: current.firstAirDate,
        episodeRunTime: current.episodeRunTime,
        genres: current.genres,
        order: current.seasonOrder,
        seasons: current.seasons,
      }
    : null;

async function resolveFreshTitle(
  ctx: ActionCtx,
  args: { mediaType: MediaType; tmdbId: number; title?: string },
  current: Doc<'resolvedTitles'> | null,
  mapping: Doc<'titleMappings'> | null,
  loadSelectedSeason = true,
  force = false,
  requestedSeason?: number,
) {
  const manuallyPinnedMapping =
    mapping?.source === 'manual' &&
    mapping.tvdbId !== undefined &&
    mapping.seasonOrder !== undefined
      ? mapping
      : null;
  const knownTvdbId = mapping?.tvdbId;
  const manualWithoutTvdbIdentity = mapping?.source === 'manual' && !manuallyPinnedMapping;
  const tmdbPromise = ctx.runAction(
    args.mediaType === 'movie' ? internal.tmdb.refreshMovieDetails : internal.tmdb.refreshTvDetails,
    { tmdbId: args.tmdbId, force },
  ) as Promise<ProviderTitle>;
  const animePromise: Promise<ProviderOutcome<ProviderAnime | null>> =
    args.mediaType === 'tv'
      ? manualWithoutTvdbIdentity
        ? Promise.resolve({ ok: true, value: null })
        : tmdbPromise.then((tmdb) =>
            settle(
              ctx.runAction(
                knownTvdbId ? internal.tvdb.refreshAnimeWithMapping : internal.tvdb.refreshAnime,
                {
                  tmdbId: args.tmdbId,
                  title: tmdb.title,
                  ...(tmdb.originalTitle && { originalTitle: tmdb.originalTitle }),
                  force,
                  ...(requestedSeason !== undefined && { requestedSeason }),
                  ...(knownTvdbId && {
                    tvdbId: knownTvdbId,
                    ...(manuallyPinnedMapping && {
                      order: manuallyPinnedMapping.seasonOrder,
                    }),
                  }),
                },
              ) as Promise<ProviderAnime | null>,
            ),
          )
      : Promise.resolve({ ok: true, value: null });
  const [tmdb, animeResult] = await Promise.all([tmdbPromise, animePromise]);
  let partial = false;
  let partialError: unknown;
  let anime = animeResult.ok ? animeResult.value : animeFromCurrent(current);
  if (!animeResult.ok) {
    partial = true;
    partialError = animeResult.error;
  }
  if (animeResult.ok && animeResult.value === null && current?.metadataProvider === 'tvdb') {
    anime = animeFromCurrent(current);
    partial = true;
    partialError = new Error('TVDB mapping disappeared during refresh');
  }
  const seasons = anime?.seasons.length ? anime.seasons : (tmdb.seasons ?? []);
  const selectedSeason = anime?.selectedSeason ?? seasons.find((entry) => entry.season > 0)?.season;
  const tmdbSeasonResult: ProviderOutcome<ResolvedEpisode[]> =
    loadSelectedSeason && args.mediaType === 'tv' && selectedSeason !== undefined
      ? await settle(
          ctx.runAction(internal.tmdb.refreshSeasonDetails, {
            tmdbId: args.tmdbId,
            season: selectedSeason,
            force,
          }) as Promise<ResolvedEpisode[]>,
        )
      : { ok: true, value: [] };
  if (!tmdbSeasonResult.ok) {
    partial = true;
    partialError ??= tmdbSeasonResult.error;
  }
  const tmdbEpisodes = tmdbSeasonResult.ok ? tmdbSeasonResult.value : [];
  const refreshedAt = Date.now();
  const value = mergeTitle(
    args.tmdbId,
    args.mediaType,
    tmdb,
    anime,
    refreshedAt,
    refreshedAt + (partial ? PARTIAL_RETRY_MS : TITLE_FRESH_MS),
  );
  if (args.mediaType === 'tv') {
    const resolvedSeasonCounts = (await ctx.runQuery(
      internal.resolvedMetadata.readResolvedSeasonCounts,
      { tmdbId: args.tmdbId },
    )) as { season: number; episodeCount: number }[];
    value.seasons = hideResolvedEmptySeasons(value.seasons, resolvedSeasonCounts);
  }
  return {
    value,
    partial,
    partialError,
    selectedSeason,
    selectedEpisodes: anime
      ? mergeEpisodes(anime.selectedEpisodes ?? [], tmdbEpisodes)
      : releasedEpisodes(tmdbEpisodes).map(cleanEpisode),
  };
}

async function waitForTitle(
  ctx: ActionCtx,
  args: { mediaType: MediaType; tmdbId: number },
  previous: Doc<'resolvedTitles'> | null,
) {
  const deadline = Date.now() + REFRESH_WAIT_MS;
  while (Date.now() < deadline) {
    await pause(150);
    const next: Doc<'resolvedTitles'> | null = await ctx.runQuery(
      internal.resolvedMetadata.readTitle,
      args,
    );
    if (
      next &&
      (!previous ||
        next.refreshedAt > previous.refreshedAt ||
        next.refreshAfter !== previous.refreshAfter)
    )
      return next;
  }
  return null;
}

async function getOrRefreshTitle(
  ctx: ActionCtx & Parameters<typeof getClerkUserId>[0],
  args: { mediaType: MediaType; tmdbId: number; title: string },
  userIdOverride?: Id<'users'>,
) {
  validateId('tmdbId', args.tmdbId);
  if (args.title.length > 500) throw new Error('Title must be no longer than 500 characters');
  const userId = userIdOverride ?? (await requireUser(ctx));
  const current: Doc<'resolvedTitles'> | null = await ctx.runQuery(
    internal.resolvedMetadata.readTitle,
    { mediaType: args.mediaType, tmdbId: args.tmdbId },
  );
  if (titleIsFresh(current)) return current!;
  const key = refreshLeaseKey(args.mediaType, args.tmdbId);
  const token = `synchronous:title:${Date.now()}:${crypto.randomUUID()}`;
  const claimed = await ctx.runMutation(internal.resolvedMetadata.claimRefresh, {
    key,
    token,
    leaseMs: REFRESH_LEASE_MS,
  });
  if (!claimed) {
    if (current) return current;
    const next = await waitForTitle(ctx, args, current);
    if (next) return next;
    throw new ConvexError({ code: 'refresh_in_progress', retryable: true });
  }
  try {
    await ctx.runMutation(internal.resolvedMetadata.admitSynchronousRefresh, {
      userId,
      keys: [requestKey(args.mediaType, args.tmdbId)],
    });
  } catch (error) {
    await ctx
      .runMutation(internal.resolvedMetadata.releaseRefresh, { key, token })
      .catch(() => undefined);
    throw error;
  }
  const adoptedKeys = await ctx.runMutation(internal.resolvedMetadata.adoptRefreshRequests, {
    keys: [requestKey(args.mediaType, args.tmdbId)],
    attemptToken: token,
    leaseKey: key,
    leaseToken: token,
  });
  let failureFinalized = false;
  const finalizeFailure = async (error: unknown) => {
    failureFinalized = true;
    await ctx.runMutation(internal.resolvedMetadata.failSynchronousRefresh, {
      leaseKey: key,
      attemptToken: token,
      errorCode: errorCode(error),
    });
  };
  try {
    await authorizeRefresh(ctx, String(userId));
    const result = await resolveAndCommitCanonical(ctx, {
      ...args,
      force: false,
      includeSelectedSeason: true,
      keys: adoptedKeys,
      attemptToken: token,
      leaseKey: key,
      leaseToken: token,
    });
    if (!result.committed) {
      const next = await waitForTitle(ctx, args, current);
      const superseded = new ConvexError({ code: 'refresh_superseded', retryable: true });
      await finalizeFailure(superseded);
      if (next) return next;
      throw superseded;
    }
    return result.title;
  } catch (error) {
    if (!failureFinalized) await finalizeFailure(error);
    if (current) return current;
    throw error;
  } finally {
    if (!failureFinalized)
      await ctx
        .runMutation(internal.resolvedMetadata.releaseRefresh, { key, token })
        .catch(() => undefined);
  }
}

export const resolveTitleForUser = internalAction({
  args: { userId: v.id('users'), mediaType, tmdbId: v.number(), title: v.string() },
  handler: (ctx, { userId, ...args }): Promise<ResolvedTitle> =>
    getOrRefreshTitle(ctx, args, userId),
});

async function resolveFreshSeason(
  ctx: ActionCtx,
  args: { tmdbId: number; season: number },
  title: ResolvedTitle,
  current: AssembledSeason | null,
  force = false,
  preloadedTvdbEpisodes?: ResolvedEpisode[],
) {
  const tmdbPromise = settle(
    ctx.runAction(internal.tmdb.refreshSeasonDetails, { ...args, force }) as Promise<
      ResolvedEpisode[]
    >,
  );
  const tvdbPromise: Promise<ProviderOutcome<ResolvedEpisode[]>> | null =
    title.metadataProvider === 'tvdb' && title.tvdbId && title.seasonOrder
      ? preloadedTvdbEpisodes
        ? Promise.resolve({ ok: true as const, value: preloadedTvdbEpisodes })
        : settle(
            ctx.runAction(internal.tvdb.refreshSeason, {
              tvdbId: title.tvdbId,
              order: title.seasonOrder,
              season: args.season,
              force,
            }) as Promise<ResolvedEpisode[]>,
          )
      : null;
  const [tmdbResult, tvdbResult] = await Promise.all([
    tmdbPromise,
    tvdbPromise ?? Promise.resolve(null),
  ]);

  if (title.metadataProvider === 'tvdb' && tvdbResult && !tvdbResult.ok) {
    if (current)
      return {
        episodes: current.episodes,
        partial: true,
        persisted: false,
        error: tvdbResult.error,
      };
    throw tvdbResult.error;
  }
  if (title.metadataProvider === 'tmdb' && !tmdbResult.ok) {
    if (current)
      return {
        episodes: current.episodes,
        partial: true,
        persisted: false,
        error: tmdbResult.error,
      };
    throw tmdbResult.error;
  }

  const tmdbEpisodes = tmdbResult.ok ? tmdbResult.value : [];
  const tvdbEpisodes = tvdbResult?.ok ? tvdbResult.value : [];
  const episodes = tvdbEpisodes.length
    ? mergeEpisodes(tvdbEpisodes, tmdbEpisodes)
    : releasedEpisodes(tmdbEpisodes).map(cleanEpisode);
  const partial = !tmdbResult.ok;
  return { episodes, partial, persisted: true, error: undefined };
}

export function titleWriteForCapturedTitle(
  capturedTitleWasProvided: boolean,
  capturedTitleIsCurrent: boolean,
) {
  return capturedTitleWasProvided && capturedTitleIsCurrent
    ? ('seasonPatch' as const)
    : ('replace' as const);
}

/** Builds the epoch-stamped title/season pair and commits it through one mutation. */
async function resolveAndCommitCanonical(
  ctx: ActionCtx,
  args: {
    mediaType: MediaType;
    tmdbId: number;
    title?: string;
    requestedSeason?: number;
    includeSelectedSeason?: boolean;
    force: boolean;
    keys: string[];
    attemptToken: string;
    leaseKey: string;
    leaseToken: string;
    currentTitle?: Doc<'resolvedTitles'>;
  },
) {
  const [queriedTitle, mapping] = await Promise.all([
    args.currentTitle
      ? Promise.resolve(args.currentTitle)
      : (ctx.runQuery(internal.resolvedMetadata.readTitle, {
          mediaType: args.mediaType,
          tmdbId: args.tmdbId,
        }) as Promise<Doc<'resolvedTitles'> | null>),
    ctx.runQuery(internal.resolvedMetadata.readTitleMapping, {
      mediaType: args.mediaType,
      tmdbId: args.tmdbId,
    }) as Promise<Doc<'titleMappings'> | null>,
  ]);
  const currentTitle =
    queriedTitle && queriedTitle.orderEpoch === (mapping?.orderEpoch ?? 0) ? queriedTitle : null;
  const titleResult =
    args.currentTitle && currentTitle
      ? {
          value: currentTitle,
          partial: false,
          partialError: undefined,
          selectedSeason: args.requestedSeason,
          selectedEpisodes: undefined,
        }
      : await resolveFreshTitle(
          ctx,
          { mediaType: args.mediaType, tmdbId: args.tmdbId, title: args.title },
          currentTitle,
          mapping,
          false,
          args.force,
          args.requestedSeason,
        );
  const reusedCapturedTitle = args.currentTitle !== undefined && currentTitle !== null;
  const discoveredIdentity: { tvdbId?: number; seasonOrder?: string } =
    titleResult.value.metadataProvider === 'tvdb'
      ? {
          ...(titleResult.value.tvdbId !== undefined && { tvdbId: titleResult.value.tvdbId }),
          ...(titleResult.value.seasonOrder !== undefined && {
            seasonOrder: titleResult.value.seasonOrder,
          }),
        }
      : {};
  const autoIdentityChanged =
    mapping?.source === 'auto' &&
    (mapping.tvdbId !== discoveredIdentity.tvdbId ||
      mapping.seasonOrder !== discoveredIdentity.seasonOrder);
  const autoMapping =
    args.mediaType === 'tv' && (!mapping || autoIdentityChanged)
      ? {
          tmdbId: args.tmdbId,
          mediaType: args.mediaType,
          ...discoveredIdentity,
          source: 'auto' as const,
          orderEpoch: mapping ? mapping.orderEpoch + 1 : 0,
          updatedAt: Date.now(),
        }
      : undefined;
  const effectiveMapping = autoMapping ?? mapping;
  const orderEpoch = effectiveMapping?.orderEpoch ?? 0;
  const {
    _id: _documentId,
    _creationTime: _creationTime,
    ...titleWithoutDocumentFields
  } = titleResult.value as ResolvedTitle & Partial<Doc<'resolvedTitles'>>;
  let title: ResolvedTitle = { ...titleWithoutDocumentFields, orderEpoch };
  const requestedSeason =
    args.requestedSeason ?? (args.includeSelectedSeason ? titleResult.selectedSeason : undefined);
  let season:
    | {
        tmdbId: number;
        season: number;
        metadataProvider: 'tmdb' | 'tvdb';
        episodes: ResolvedEpisode[];
        episodeCount: number;
        chunkCount: number;
        refreshedAt: number;
        refreshAfter?: number;
        orderEpoch: number;
      }
    | undefined;
  let seasonPayload:
    | {
        tmdbId: number;
        season: number;
        metadataProvider: 'tmdb' | 'tvdb';
        episodes: ResolvedEpisode[];
        refreshedAt: number;
        refreshAfter: number;
        orderEpoch: number;
      }
    | undefined;
  let seasonPartial = false;
  let seasonError: unknown;
  let seasonPersisted: boolean | undefined;
  const seasonNotFound =
    args.mediaType === 'tv' &&
    requestedSeason !== undefined &&
    !title.seasons.some((entry) => entry.season === requestedSeason);
  if (args.mediaType === 'tv' && requestedSeason !== undefined && !seasonNotFound) {
    const storedSeason: AssembledSeason | null = await ctx.runQuery(
      internal.resolvedMetadata.readSeason,
      { tmdbId: args.tmdbId, season: requestedSeason },
    );
    const currentSeason = storedSeason;
    const seasonResult = await resolveFreshSeason(
      ctx,
      { tmdbId: args.tmdbId, season: requestedSeason },
      title,
      currentSeason,
      args.force,
      titleResult.selectedSeason === requestedSeason && titleResult.selectedEpisodes?.length
        ? titleResult.selectedEpisodes
        : undefined,
    );
    seasonPartial = seasonResult.partial;
    seasonError = seasonResult.error;
    seasonPersisted = seasonResult.persisted;
    const refreshedAt = Date.now();
    season = {
      tmdbId: args.tmdbId,
      season: requestedSeason,
      metadataProvider: title.metadataProvider,
      episodes: seasonResult.episodes,
      episodeCount: seasonResult.episodes.length,
      chunkCount: Math.ceil(seasonResult.episodes.length / EPISODES_PER_CHUNK),
      refreshedAt: seasonResult.persisted
        ? refreshedAt
        : (currentSeason?.refreshedAt ?? refreshedAt),
      refreshAfter: seasonResult.persisted
        ? refreshedAt + (seasonResult.partial ? PARTIAL_RETRY_MS : SEASON_FRESH_MS)
        : currentSeason?.refreshAfter,
      orderEpoch,
    };
    if (seasonResult.persisted) {
      seasonPayload = {
        tmdbId: args.tmdbId,
        season: requestedSeason,
        metadataProvider: title.metadataProvider,
        episodes: seasonResult.episodes,
        refreshedAt: seasonResult.persisted ? refreshedAt : currentTitle!.refreshedAt,
        refreshAfter: seasonResult.persisted
          ? refreshedAt + (seasonResult.partial ? PARTIAL_RETRY_MS : SEASON_FRESH_MS)
          : currentTitle!.refreshAfter,
        orderEpoch,
      };
      title = {
        ...title,
        seasons: title.seasons.map((entry) =>
          entry.season === requestedSeason
            ? { ...entry, episodeCount: seasonResult.episodes.length }
            : entry,
        ),
      };
    }
  }
  const mappingPayload = effectiveMapping
    ? {
        tmdbId: effectiveMapping.tmdbId,
        mediaType: effectiveMapping.mediaType,
        ...(effectiveMapping.tvdbId !== undefined && { tvdbId: effectiveMapping.tvdbId }),
        ...(effectiveMapping.seasonOrder !== undefined && {
          seasonOrder: effectiveMapping.seasonOrder,
        }),
        source: effectiveMapping.source,
        orderEpoch: effectiveMapping.orderEpoch,
        updatedAt: Date.now(),
      }
    : undefined;
  const candidateKeys = [
    requestKey(args.mediaType, args.tmdbId),
    ...(requestedSeason !== undefined ? [seasonRequestKey(args.tmdbId, requestedSeason)] : []),
  ];
  // A synchronous season read may reuse a captured title. In that case it can
  // still adopt a season touch that arrived during provider work,
  // but it must leave a late title touch with its scheduled title orchestrator.
  // If it adopted the title before provider work, currentTitle is deliberately
  // omitted by the caller and the title was actually refreshed above.
  const adoptableCandidateKeys =
    args.attemptToken.startsWith('synchronous:') && args.currentTitle !== undefined
      ? candidateKeys.filter((key) => key.startsWith('season:'))
      : candidateKeys;
  const synchronousKeys = args.attemptToken.startsWith('synchronous:')
    ? await ctx.runMutation(internal.resolvedMetadata.adoptRefreshRequests, {
        keys: adoptableCandidateKeys,
        attemptToken: args.attemptToken,
        leaseKey: args.leaseKey,
        leaseToken: args.leaseToken,
      })
    : [];
  const claimedKeys = [...new Set([...args.keys, ...synchronousKeys])];
  const outcomes = claimedKeys.map((key) => {
    if (key.startsWith('season:') && seasonNotFound)
      return {
        key,
        state: 'notFound' as const,
        errorCode: 'season_not_found',
      };
    if (key.startsWith('season:') && seasonPersisted === false)
      return {
        key,
        state: 'failed' as const,
        errorCode: errorCode(seasonError ?? new Error('Season refresh was not persisted')),
      };
    return { key, state: 'succeeded' as const };
  });
  // Provider calls can outlive the ingress deadline. Renew both the ownership
  // lease and every currently attached row immediately before the first commit.
  // Adoptable candidate keys are used instead of the earlier adoption snapshot
  // so eligible touches that arrived during provider work receive the same
  // healthy deadline.
  await ctx.runMutation(internal.resolvedMetadata.renewRefreshAttempt, {
    key: args.leaseKey,
    token: args.leaseToken,
    leaseMs: REFRESH_LEASE_MS,
    requestKeys: adoptableCandidateKeys,
    attemptToken: args.attemptToken,
  });
  const chunks = seasonPayload ? episodeChunks(seasonPayload.episodes) : undefined;
  const commitSeason: PrechunkedSeason | undefined = seasonPayload
    ? {
        tmdbId: seasonPayload.tmdbId,
        season: seasonPayload.season,
        metadataProvider: seasonPayload.metadataProvider,
        chunks: chunks!.slice(0, 1),
        episodeCount: seasonPayload.episodes.length,
        chunkCount: chunks!.length,
        refreshedAt: seasonPayload.refreshedAt,
        refreshAfter: seasonPayload.refreshAfter,
        orderEpoch: seasonPayload.orderEpoch,
      }
    : undefined;
  const coreArgs = {
    title,
    // A season orchestrator can discover that its captured title was invalidated
    // by a mapping change. In that case resolveFreshTitle produced a replacement
    // title and publication must replace the old-epoch document with it.
    titleWrite: titleWriteForCapturedTitle(args.currentTitle !== undefined, reusedCapturedTitle),
    season: commitSeason,
    mapping: mappingPayload,
    expectedMapping: mappingIdentity(mapping),
    outcomes,
    attemptToken: args.attemptToken,
    leaseKey: args.leaseKey,
    leaseToken: args.leaseToken,
  };
  assertMetadataMutationSize(coreArgs, 'commitRefresh');
  let commitStatus = await ctx.runMutation(internal.resolvedMetadata.commitRefresh, coreArgs);
  const seasonFailed = outcomes.some(
    (outcome) => outcome.key.startsWith('season:') && outcome.state === 'failed',
  );
  if (commitStatus === 'staged' && commitSeason && chunks && !seasonFailed) {
    for (let chunkIndex = 1; chunkIndex < chunks.length; chunkIndex += 1) {
      const appendArgs = {
        tmdbId: commitSeason.tmdbId,
        season: commitSeason.season,
        orderEpoch: commitSeason.orderEpoch,
        chunkIndex,
        episodes: chunks[chunkIndex]!,
        attemptToken: args.attemptToken,
      };
      assertMetadataMutationSize(appendArgs, 'appendRefreshSeasonChunk');
      const appended = await ctx.runMutation(
        internal.resolvedMetadata.appendRefreshSeasonChunk,
        appendArgs,
      );
      if (!appended) throw new ConvexError({ code: 'refresh_superseded', retryable: true });
    }
    const expectedMapping = mappingIdentity(mapping);
    const finalizeArgs = {
      tmdbId: commitSeason.tmdbId,
      season: commitSeason.season,
      outcomes,
      expectedMapping,
      attemptToken: args.attemptToken,
      leaseKey: args.leaseKey,
      leaseToken: args.leaseToken,
    };
    await ctx.runMutation(internal.resolvedMetadata.renewRefreshAttempt, {
      key: args.leaseKey,
      token: args.leaseToken,
      leaseMs: REFRESH_LEASE_MS,
      requestKeys: adoptableCandidateKeys,
      attemptToken: args.attemptToken,
    });
    assertMetadataMutationSize(finalizeArgs, 'finalizeRefreshSeason');
    commitStatus = await ctx.runMutation(
      internal.resolvedMetadata.finalizeRefreshSeason,
      finalizeArgs,
    );
  }
  return {
    committed: commitStatus === true,
    commitStatus,
    title,
    season,
    partial: titleResult.partial || seasonPartial,
    error: titleResult.partialError ?? seasonError,
    seasonPersisted,
  };
}

async function waitForSeason(
  ctx: ActionCtx,
  args: { tmdbId: number; season: number },
  previous: AssembledSeason | null,
) {
  const deadline = Date.now() + REFRESH_WAIT_MS;
  while (Date.now() < deadline) {
    await pause(150);
    const next: AssembledSeason | null = await ctx.runQuery(
      internal.resolvedMetadata.readSeason,
      args,
    );
    if (
      next &&
      (!previous ||
        next.refreshedAt > previous.refreshedAt ||
        next.refreshAfter !== previous.refreshAfter)
    )
      return next;
  }
  return null;
}

async function getOrRefreshSeason(
  ctx: ActionCtx & Parameters<typeof getClerkUserId>[0],
  args: { tmdbId: number; season: number },
  userIdOverride?: Id<'users'>,
) {
  validateId('tmdbId', args.tmdbId);
  validateId('season', args.season, 10_000);
  const userId = userIdOverride ?? (await requireUser(ctx));
  const current: AssembledSeason | null = await ctx.runQuery(
    internal.resolvedMetadata.readSeason,
    args,
  );
  if (seasonIsFresh(current)) return current!.episodes.slice(0, EPISODES_PER_CHUNK);
  const titleBeforeLease: Doc<'resolvedTitles'> | null = await ctx.runQuery(
    internal.resolvedMetadata.readTitle,
    { mediaType: 'tv', tmdbId: args.tmdbId },
  );
  if (!titleBeforeLease) throw new Error('Resolved title metadata is unavailable');
  const key = refreshLeaseKey('tv', args.tmdbId);
  const token = `synchronous:season:${Date.now()}:${crypto.randomUUID()}`;
  const claimed = await ctx.runMutation(internal.resolvedMetadata.claimRefresh, {
    key,
    token,
    leaseMs: REFRESH_LEASE_MS,
  });
  if (!claimed) {
    if (current) return current.episodes.slice(0, EPISODES_PER_CHUNK);
    const next = await waitForSeason(ctx, args, current);
    if (next) return next.episodes.slice(0, EPISODES_PER_CHUNK);
    throw new ConvexError({ code: 'refresh_in_progress', retryable: true });
  }
  try {
    await ctx.runMutation(internal.resolvedMetadata.admitSynchronousRefresh, {
      userId,
      keys: [requestKey('tv', args.tmdbId), seasonRequestKey(args.tmdbId, args.season)],
    });
  } catch (error) {
    await ctx
      .runMutation(internal.resolvedMetadata.releaseRefresh, { key, token })
      .catch(() => undefined);
    throw error;
  }
  const adoptedKeys = await ctx.runMutation(internal.resolvedMetadata.adoptRefreshRequests, {
    keys: [requestKey('tv', args.tmdbId), seasonRequestKey(args.tmdbId, args.season)],
    attemptToken: token,
    leaseKey: key,
    leaseToken: token,
  });
  const adoptedTitle = adoptedKeys.includes(requestKey('tv', args.tmdbId));
  let failureFinalized = false;
  const finalizeFailure = async (error: unknown) => {
    failureFinalized = true;
    await ctx.runMutation(internal.resolvedMetadata.failSynchronousRefresh, {
      leaseKey: key,
      attemptToken: token,
      errorCode: errorCode(error),
    });
  };
  try {
    await authorizeRefresh(ctx, String(userId));
    const title: Doc<'resolvedTitles'> | null = await ctx.runQuery(
      internal.resolvedMetadata.readTitle,
      { mediaType: 'tv', tmdbId: args.tmdbId },
    );
    if (!title) throw new Error('Resolved title metadata is unavailable');
    const result = await resolveAndCommitCanonical(ctx, {
      mediaType: 'tv',
      tmdbId: args.tmdbId,
      title: title.title,
      requestedSeason: args.season,
      force: false,
      keys: adoptedKeys,
      attemptToken: token,
      leaseKey: key,
      leaseToken: token,
      // An already-pending title touch is safe to adopt only if this season
      // action performs the requested title refresh as well.
      ...(!adoptedTitle && { currentTitle: title }),
    });
    if (!result.committed) {
      const next = await waitForSeason(ctx, args, current);
      const superseded = new ConvexError({ code: 'refresh_superseded', retryable: true });
      await finalizeFailure(superseded);
      if (next) return next.episodes.slice(0, EPISODES_PER_CHUNK);
      throw superseded;
    }
    return (result.season?.episodes ?? current?.episodes ?? []).slice(0, EPISODES_PER_CHUNK);
  } catch (error) {
    if (!failureFinalized) await finalizeFailure(error);
    if (current) return current.episodes.slice(0, EPISODES_PER_CHUNK);
    throw error;
  } finally {
    if (!failureFinalized)
      await ctx
        .runMutation(internal.resolvedMetadata.releaseRefresh, { key, token })
        .catch(() => undefined);
  }
}

export const resolveSeasonForUser = internalAction({
  args: { userId: v.id('users'), tmdbId: v.number(), season: v.number() },
  handler: (ctx, { userId, ...args }): Promise<ResolvedEpisode[]> =>
    getOrRefreshSeason(ctx, args, userId),
});

export const listSeedItems = internalQuery({
  args: {},
  handler: async (ctx) => {
    const items = await ctx.db.query('items').take(2000);
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = `${item.mediaType}:${item.tmdbId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },
});

export const setTitleMapping = internalMutation({
  args: {
    mediaType,
    tmdbId: v.number(),
    tvdbId: v.optional(v.number()),
    seasonOrder: v.optional(v.string()),
    source: v.union(v.literal('auto'), v.literal('manual')),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', args.mediaType).eq('tmdbId', args.tmdbId))
      .unique();
    if (existing?.source === 'manual' && args.source === 'auto') return existing;
    const changed =
      !existing || existing.tvdbId !== args.tvdbId || existing.seasonOrder !== args.seasonOrder;
    const value = {
      ...args,
      orderEpoch: existing ? existing.orderEpoch + (changed ? 1 : 0) : 0,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.replace(existing._id, value);
    else await ctx.db.insert('titleMappings', value);
    if (args.mediaType === 'tv')
      await ctx.scheduler.runAfter(0, internal.nextEpisode.refreshForTitle, {
        tmdbId: args.tmdbId,
      });
    return value;
  },
});

export const seedFromProviderSnapshots = internalAction({
  args: {},
  handler: async (ctx): Promise<{ found: number; seeded: number }> => {
    const items: Doc<'items'>[] = await ctx.runQuery(internal.resolvedMetadata.listSeedItems, {});
    const readProviderSnapshot = internal.providerSnapshots.get;
    let seeded = 0;
    for (const item of items) {
      const existing = await ctx.runQuery(internal.resolvedMetadata.readTitle, {
        mediaType: item.mediaType,
        tmdbId: item.tmdbId,
      });
      if (existing) continue;
      const existingMapping = await ctx.runQuery(internal.resolvedMetadata.readTitleMapping, {
        mediaType: item.mediaType,
        tmdbId: item.tmdbId,
      });
      const lookup =
        item.mediaType === 'tv' && item.isAnime
          ? await ctx.runQuery(readProviderSnapshot, {
              key: tvdbAnimeLookupKey(item.tmdbId),
            })
          : null;
      const lookupValue = lookup?.value as { tvdbId?: unknown; order?: unknown } | undefined;
      const mapping =
        existingMapping ??
        (await ctx.runMutation(internal.resolvedMetadata.setTitleMapping, {
          mediaType: item.mediaType,
          tmdbId: item.tmdbId,
          ...(typeof lookupValue?.tvdbId === 'number' && { tvdbId: lookupValue.tvdbId }),
          ...(typeof lookupValue?.order === 'string' && { seasonOrder: lookupValue.order }),
          source: 'auto',
        }));
      const tmdbKey =
        item.mediaType === 'movie' ? `tmdb:movie:${item.tmdbId}` : `tmdb:tv:full:${item.tmdbId}`;
      const tmdbSnapshot = await ctx.runQuery(readProviderSnapshot, { key: tmdbKey });
      let animeSnapshot = null;
      if (item.mediaType === 'tv' && item.isAnime) {
        const identityKey =
          mapping?.tvdbId && mapping.seasonOrder
            ? tvdbAnimeGuideKey(item.tmdbId, mapping.tvdbId, mapping.seasonOrder)
            : typeof lookupValue?.tvdbId === 'number' && typeof lookupValue.order === 'string'
              ? tvdbAnimeGuideKey(item.tmdbId, lookupValue.tvdbId, lookupValue.order)
              : undefined;
        for (const key of [
          ...(identityKey ? [identityKey] : []),
          `tvdb:anime:v4:${item.tmdbId}`,
          `tvdb:anime:v2:${item.tmdbId}`,
          `tvdb:anime:${item.tmdbId}`,
        ]) {
          const candidate = await ctx.runQuery(readProviderSnapshot, { key });
          if (candidate?.value) {
            animeSnapshot = candidate;
            break;
          }
        }
      }
      const base = (tmdbSnapshot?.value ?? {
        title: item.title,
        posterPath: item.posterPath,
        overview: item.overview,
        releaseDate: item.releaseDate,
        runtime: item.runtime,
        genres: item.genres ?? [],
        cast: [],
        seasons: [],
        episodeRunTime: item.runtime ? [item.runtime] : [],
      }) as ProviderTitle;
      const anime = (animeSnapshot?.value ?? null) as ProviderAnime | null;
      const seasons = anime?.seasons.length ? anime.seasons : (base.seasons ?? []);
      const selectedSeason =
        anime?.selectedSeason ?? seasons.find((entry) => entry.season > 0)?.season;
      const seasonSnapshot =
        selectedSeason === undefined
          ? null
          : await ctx.runQuery(readProviderSnapshot, {
              key: `tmdb:season:${item.tmdbId}:${selectedSeason}`,
            });
      const complete = !!tmdbSnapshot && (item.mediaType === 'movie' || !item.isAnime || !!anime);
      const refreshedAt = complete
        ? Math.min(tmdbSnapshot.refreshedAt, animeSnapshot?.refreshedAt ?? tmdbSnapshot.refreshedAt)
        : 0;
      const value = {
        ...mergeTitle(item.tmdbId, item.mediaType, base, anime, refreshedAt),
        orderEpoch: mapping.orderEpoch,
      };
      await ctx.runMutation(internal.resolvedMetadata.putTitle, { value });
      const selectedEpisodes = (anime?.selectedEpisodes ??
        seasonSnapshot?.value ??
        []) as ResolvedEpisode[];
      if (selectedSeason !== undefined && selectedEpisodes.length)
        await ctx.runMutation(internal.resolvedMetadata.putSeason, {
          tmdbId: item.tmdbId,
          season: selectedSeason,
          metadataProvider: value.metadataProvider,
          episodes: mergeEpisodes(selectedEpisodes, []),
          refreshedAt,
          refreshAfter: refreshedAt + SEASON_FRESH_MS,
          orderEpoch: mapping.orderEpoch,
        });
      seeded += 1;
    }
    return { found: items.length, seeded };
  },
});
