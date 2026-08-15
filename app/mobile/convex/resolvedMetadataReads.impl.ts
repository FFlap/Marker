import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { internalQuery, query } from './_generated/server';
import {
  itemValidator,
  resolvedEpisodeValidator as publicResolvedEpisodeValidator,
  resolvedTitleValidator as publicResolvedTitleValidator,
  requestStateValidator,
} from './publicValidators';
import { requestKey, seasonRequestKey, visibleRequestState } from './resolvedMetadataRequests.impl';
import { mediaType, metadataProvider, requireUser } from './resolvedMetadataShared.impl';
import { readAssembledSeason } from './seasonStorage';

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
