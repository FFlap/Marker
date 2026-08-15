import {
  action,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { ConvexError, v } from 'convex/values';
import { EPISODES_PER_CHUNK, MAX_SEASON_EPISODES } from './seasonStorage';
import { seasonSummaryIdentityKey } from './episodeSummaries';
import { writeActivityEvents, type ActivityEventWrite } from './activityEvents';
import { refreshNextEpisode } from './nextEpisode';
import { requestProfileStatsRefresh } from './profileStatsRefresh';
import { addItemFields, ownedItem, requireUser } from './libraryShared.impl';
import { setEpisode } from './libraryEpisodes.impl';

const SEASON_WATCH_BATCH_SIZE = EPISODES_PER_CHUNK;
const MAX_SEASON_WATCH_RESTARTS = 4;
const MAX_SEASON_WATCH_BATCHES =
  Math.ceil(MAX_SEASON_EPISODES / SEASON_WATCH_BATCH_SIZE) * (MAX_SEASON_WATCH_RESTARTS + 1);
const seasonWatchIdentity = {
  userId: v.id('users'),
  itemId: v.id('items'),
  season: v.number(),
  watched: v.boolean(),
  orderEpoch: v.optional(v.number()),
  metadataProvider: v.optional(v.union(v.literal('tmdb'), v.literal('tvdb'))),
};

const staleSeasonEpoch = () =>
  new ConvexError({
    code: 'stale_epoch',
    retryable: true,
    message: 'Season metadata changed because its provider or episode order changed; retry',
  });

async function loadSeasonWatchState(
  ctx: MutationCtx | QueryCtx,
  args: {
    userId: Id<'users'>;
    itemId: Id<'items'>;
    season: number;
    orderEpoch?: number;
    metadataProvider?: 'tmdb' | 'tvdb';
  },
) {
  const item = await ownedItem(ctx, args.itemId, args.userId);
  const [mapping, resolved, title] = await Promise.all([
    ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (query) =>
        query.eq('mediaType', item.mediaType).eq('tmdbId', item.tmdbId),
      )
      .unique(),
    ctx.db
      .query('resolvedSeasons')
      .withIndex('by_tmdb_season', (query) =>
        query.eq('tmdbId', item.tmdbId).eq('season', args.season),
      )
      .unique(),
    ctx.db
      .query('resolvedTitles')
      .withIndex('by_tmdb', (query) =>
        query.eq('mediaType', item.mediaType).eq('tmdbId', item.tmdbId),
      )
      .unique(),
  ]);
  if (
    !mapping ||
    !resolved ||
    resolved.orderEpoch !== mapping.orderEpoch ||
    resolved.chunkCount === undefined ||
    resolved.seasonVersion === undefined ||
    resolved.chunksComplete !== true
  )
    throw staleSeasonEpoch();
  const epoch = mapping.orderEpoch;
  if (args.orderEpoch !== undefined && args.orderEpoch !== epoch) throw staleSeasonEpoch();
  if (args.metadataProvider !== undefined && args.metadataProvider !== resolved.metadataProvider)
    throw staleSeasonEpoch();
  const episodeCount = resolved.episodeCount;
  if (episodeCount === undefined || episodeCount > MAX_SEASON_EPISODES)
    throw new Error(`A season batch is limited to ${MAX_SEASON_EPISODES} episodes`);
  const seasonName =
    title && title.orderEpoch === epoch
      ? title.seasons.find((entry) => entry.season === args.season)?.name
      : undefined;
  return { item, mapping, resolved, episodeCount, epoch, seasonName };
}

async function loadSeasonWatchChunk(
  ctx: MutationCtx,
  resolved: Doc<'resolvedSeasons'>,
  offset: number,
) {
  if (
    resolved.chunkCount === undefined ||
    resolved.orderEpoch === undefined ||
    resolved.seasonVersion === undefined
  )
    throw staleSeasonEpoch();
  const chunkIndex = Math.floor(offset / EPISODES_PER_CHUNK);
  const chunk = await ctx.db
    .query('resolvedSeasonChunks')
    .withIndex('by_tmdb_season_version_chunk', (query) =>
      query
        .eq('tmdbId', resolved.tmdbId)
        .eq('season', resolved.season)
        .eq('seasonVersion', resolved.seasonVersion!)
        .eq('chunkIndex', chunkIndex),
    )
    .unique();
  if (!chunk) throw staleSeasonEpoch();
  const withinChunk = offset % EPISODES_PER_CHUNK;
  return chunk.episodes.slice(withinChunk, withinChunk + SEASON_WATCH_BATCH_SIZE);
}

export const getSeasonWatchedPlan = internalQuery({
  args: seasonWatchIdentity,
  handler: async (ctx, args) => {
    const { resolved, episodeCount, epoch } = await loadSeasonWatchState(ctx, args);
    return {
      episodeCount,
      refreshedAt: resolved.refreshedAt,
      orderEpoch: epoch,
      metadataProvider: resolved.metadataProvider,
    };
  },
});

export const setSeasonWatchedBatch = internalMutation({
  args: {
    ...seasonWatchIdentity,
    offset: v.number(),
    expectedRefreshedAt: v.number(),
    expectedOrderEpoch: v.number(),
    expectedMetadataProvider: v.union(v.literal('tmdb'), v.literal('tvdb')),
  },
  handler: async (ctx, args) => {
    const { item, mapping, resolved, episodeCount, epoch, seasonName } = await loadSeasonWatchState(
      ctx,
      {
        userId: args.userId,
        itemId: args.itemId,
        season: args.season,
        orderEpoch: args.expectedOrderEpoch,
        metadataProvider: args.expectedMetadataProvider,
      },
    );
    if (epoch !== args.expectedOrderEpoch) throw staleSeasonEpoch();

    const seasonOrder = mapping.seasonOrder;
    const identityAvailable = resolved.metadataProvider === 'tmdb' || seasonOrder !== undefined;
    const summaryIdentityKey = identityAvailable
      ? seasonSummaryIdentityKey(resolved, seasonOrder)
      : undefined;
    const restarted = resolved.refreshedAt !== args.expectedRefreshedAt;
    const offset = restarted ? 0 : args.offset;
    const batch = await loadSeasonWatchChunk(ctx, resolved, offset);
    const existing = await Promise.all(
      batch.map((episode) =>
        ctx.db
          .query('episodes')
          .withIndex('by_item', (query) =>
            query
              .eq('itemId', args.itemId)
              .eq('season', args.season)
              .eq('episode', episode.episode),
          )
          .unique(),
      ),
    );
    const activityEvents: ActivityEventWrite[] = [];
    for (const [index, episode] of batch.entries())
      await setEpisode(
        ctx,
        args.userId,
        {
          itemId: args.itemId,
          ...episode,
          watched: args.watched,
          ...(identityAvailable && {
            stamp: {
              metadataProvider: resolved.metadataProvider,
              seasonOrder: resolved.metadataProvider === 'tvdb' ? seasonOrder : undefined,
              providerEpisodeId: episode.providerEpisodeId,
              summaryIdentityKey,
              summarySeasonVersion: resolved.seasonVersion,
              summaryTotal: episodeCount,
              ...(seasonName !== undefined && { seasonName }),
              name: episode.name,
              overview: episode.overview,
              runtime: episode.runtime,
              imageUrl: episode.imageUrl,
              airDate: episode.airDate,
            },
          }),
        },
        item,
        existing[index] ?? null,
        activityEvents,
        false,
      );
    await writeActivityEvents(ctx, activityEvents);
    const watchedCoordinate =
      args.watched &&
      item.nextEpisode &&
      batch.some(
        (episode) =>
          episode.season === item.nextEpisode!.season &&
          episode.episode === item.nextEpisode!.episode,
      )
        ? { season: item.nextEpisode.season, episode: item.nextEpisode.episode }
        : undefined;
    await refreshNextEpisode(ctx, item._id, watchedCoordinate);
    return {
      processed: batch.length,
      episodeCount,
      refreshedAt: resolved.refreshedAt,
      restarted,
    };
  },
});

type SeasonWatchedActionArgs = {
  userId: Id<'users'>;
  itemId: Id<'items'>;
  season: number;
  watched: boolean;
  orderEpoch?: number;
  metadataProvider?: 'tmdb' | 'tvdb';
};

async function applySeasonWatched(
  ctx: ActionCtx,
  { userId, itemId, season, watched, orderEpoch, metadataProvider }: SeasonWatchedActionArgs,
) {
  if (!Number.isInteger(season) || season < 0 || season > 10_000)
    throw new Error('Season must be an integer between 0 and 10000');
  const plan = await ctx.runQuery(internal.library.getSeasonWatchedPlan, {
    userId,
    itemId,
    season,
    watched,
    orderEpoch,
    metadataProvider,
  });
  let processed = 0;
  let batches = 0;
  let restarts = 0;
  let episodeCount = plan.episodeCount;
  let refreshedAt = plan.refreshedAt;
  while (true) {
    if (processed >= episodeCount) {
      const current = await ctx.runQuery(internal.library.getSeasonWatchedPlan, {
        userId,
        itemId,
        season,
        watched,
        orderEpoch: plan.orderEpoch,
        metadataProvider: plan.metadataProvider,
      });
      if (current.refreshedAt === refreshedAt && current.episodeCount === episodeCount) break;
      restarts += 1;
      if (restarts > MAX_SEASON_WATCH_RESTARTS) throw staleSeasonEpoch();
      processed = 0;
      episodeCount = current.episodeCount;
      refreshedAt = current.refreshedAt;
      continue;
    }
    batches += 1;
    if (batches > MAX_SEASON_WATCH_BATCHES) throw staleSeasonEpoch();
    const result = await ctx.runMutation(internal.library.setSeasonWatchedBatch, {
      userId,
      itemId,
      season,
      watched,
      offset: processed,
      expectedRefreshedAt: refreshedAt,
      expectedOrderEpoch: plan.orderEpoch,
      expectedMetadataProvider: plan.metadataProvider,
    });
    if (result.processed === 0) throw new Error('Season batch made no progress');
    if (result.restarted) {
      restarts += 1;
      if (restarts > MAX_SEASON_WATCH_RESTARTS) throw staleSeasonEpoch();
    }
    processed = (result.restarted ? 0 : processed) + result.processed;
    episodeCount = result.episodeCount;
    refreshedAt = result.refreshedAt;
  }
  return { processed };
}

export const setSeasonWatched = action({
  args: {
    itemId: v.id('items'),
    season: v.number(),
    watched: v.optional(v.boolean()),
    orderEpoch: v.optional(v.number()),
    metadataProvider: v.optional(v.union(v.literal('tmdb'), v.literal('tvdb'))),
  },
  returns: v.object({ processed: v.number() }),
  handler: async (ctx, { itemId, season, watched = true, orderEpoch, metadataProvider }) => {
    const userId = await requireUser(ctx);
    return applySeasonWatched(ctx, {
      userId,
      itemId,
      season,
      watched,
      orderEpoch,
      metadataProvider,
    });
  },
});

async function moveItemToWatchedForUser(
  ctx: ActionCtx,
  userId: Id<'users'>,
  args: {
    itemId: Id<'items'>;
    beforeId?: Id<'items'>;
    afterId?: Id<'items'>;
  },
): Promise<number> {
  const item: Doc<'items'> = await ctx.runQuery(internal.library.getOwnedItemForStatusMove, {
    userId,
    itemId: args.itemId,
  });
  if (item.mediaType === 'tv') {
    const initialTitle = await ctx.runAction(internal.resolvedMetadata.resolveTitleForUser, {
      userId,
      mediaType: 'tv',
      tmdbId: item.tmdbId,
      title: item.title,
    });
    if (!initialTitle?.seasons.length) throw new Error('Season information is unavailable');
    for (const seasonInfo of initialTitle.seasons.filter(
      (entry: { season: number }) => entry.season >= 0,
    )) {
      const episodes = await ctx.runAction(internal.resolvedMetadata.resolveSeasonForUser, {
        userId,
        tmdbId: item.tmdbId,
        season: seasonInfo.season,
      });
      if (seasonInfo.episodeCount > 0 && episodes.length === 0)
        throw new Error('Episode information is unavailable');
      const currentTitle = await ctx.runQuery(internal.resolvedMetadata.readTitle, {
        mediaType: 'tv',
        tmdbId: item.tmdbId,
      });
      if (!currentTitle) throw new Error('Season identity is unavailable');
      await applySeasonWatched(ctx, {
        userId,
        itemId: item._id,
        season: seasonInfo.season,
        watched: true,
        orderEpoch: currentTitle.orderEpoch,
        metadataProvider: currentTitle.metadataProvider,
      });
    }
  }
  return ctx.runMutation(internal.library.moveItemToSlotInternal, {
    userId,
    itemId: item._id,
    status: 'watched',
    beforeId: args.beforeId,
    afterId: args.afterId,
  });
}

export const moveItemToWatched = action({
  args: {
    itemId: v.id('items'),
    beforeId: v.optional(v.id('items')),
    afterId: v.optional(v.id('items')),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    return moveItemToWatchedForUser(ctx, userId, args);
  },
});

export const addItemAndMarkWatched = action({
  args: addItemFields,
  returns: v.id('items'),
  handler: async (ctx, args): Promise<Id<'items'>> => {
    if (args.mediaType !== 'tv' || args.status !== 'watched')
      throw new Error('This action only adds watched TV shows');
    const userId = await requireUser(ctx);
    const itemId: Id<'items'> = await ctx.runMutation(internal.library.addItemInternal, {
      userId,
      ...args,
      status: 'watchlist',
    });
    try {
      await moveItemToWatchedForUser(ctx, userId, { itemId });
    } catch (error) {
      await ctx
        .runMutation(internal.library.discardAddedItem, { userId, itemId })
        .catch(() => undefined);
      throw error;
    }
    return itemId;
  },
});

export const discardAddedItem = internalMutation({
  args: { userId: v.id('users'), itemId: v.id('items') },
  handler: async (ctx, { userId, itemId }) => {
    const item = await ctx.db.get(itemId);
    if (!item || item.userId !== userId) return;
    if (item.deletingAt === undefined) {
      await ctx.db.patch(itemId, { deletingAt: Date.now() });
      await requestProfileStatsRefresh(ctx, userId);
    }
    await ctx.scheduler.runAfter(0, internal.library.continueRemoveItem, { itemId });
  },
});
