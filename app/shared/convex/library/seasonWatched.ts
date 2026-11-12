import { bulkWatchState } from '../lifecycles';
import {
  action,
  internalMutation,
  internalAction,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from '../_generated/server';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { ConvexError, v, type ObjectType } from 'convex/values';
import { EPISODES_PER_CHUNK, MAX_SEASON_EPISODES } from '../seasonStorage';
import {
  seasonSummaryIdentityKey,
  updateSummaryForEpisodeUpserts,
  type EpisodeSummaryUpsert,
} from '../episodeSummaries';
import { writeActivityEvents, type ActivityEventWrite } from '../activityEvents';
import { refreshNextEpisode } from '../nextEpisode';
import { updateProfileStatsForItem } from '../profileStatsRefresh';
import { bumpCalendarRevision } from '../calendarLibrary';
import { addItemFields, episodeMatchesStamp, ownedItem, requireUser } from './shared';
import { moveItemToSlot } from './ordering';
import { publishWatchMetadataFromSnapshots } from './watchMetadata';
import { setEpisode } from './episodes';
import {
  assertSeriesWatchGeneration,
  currentSeriesOverride,
  seriesWatchIncludes,
} from './seriesWatchState';
import { recordWatchActivity, resolveActivityDate } from '../watchActivity';

const SEASON_WATCH_BATCH_SIZE = EPISODES_PER_CHUNK;
const MAX_ATOMIC_WATCH_EPISODES = 2_000;
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
  generation: v.optional(v.string()),
};

const MAX_WATCHED_SEASON_PASSES = 3;
const watchedSeasonKey = (
  title: Pick<Doc<'resolvedTitles'>, 'orderEpoch' | 'metadataProvider'>,
  season: number,
) => `${title.orderEpoch}:${title.metadataProvider}:${season}`;

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
    generation?: string;
  },
) {
  const item = await ownedItem(ctx, args.itemId, args.userId);
  assertSeriesWatchGeneration(item, args.generation);
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
    const { resolved, mapping, episodeCount, epoch } = await loadSeasonWatchState(ctx, args);
    const summary = await ctx.db
      .query('episodeSummaries')
      .withIndex('by_item', (q) => q.eq('itemId', args.itemId).eq('season', args.season))
      .unique();
    return {
      complete: args.watched && seasonIsWatched(summary, resolved, mapping),
      episodeCount,
      refreshedAt: resolved.refreshedAt,
      orderEpoch: epoch,
      metadataProvider: resolved.metadataProvider,
    };
  },
});

const seasonWatchBatchArgs = {
  ...seasonWatchIdentity,
  activityDate: v.optional(v.string()),
  offset: v.number(),
  expectedRefreshedAt: v.number(),
  expectedOrderEpoch: v.number(),
  expectedMetadataProvider: v.union(v.literal('tmdb'), v.literal('tvdb')),
};

async function applySeasonWatchedBatch(
  ctx: MutationCtx,
  args: ObjectType<typeof seasonWatchBatchArgs>,
  buffered?: {
    state: Awaited<ReturnType<typeof loadSeasonWatchState>>;
    activityEvents: ActivityEventWrite[];
    watchActivityDeltas: Map<string, number>;
  },
) {
  const { item, mapping, resolved, episodeCount, epoch, seasonName } =
    buffered?.state ??
    (await loadSeasonWatchState(ctx, {
      userId: args.userId,
      itemId: args.itemId,
      season: args.season,
      orderEpoch: args.expectedOrderEpoch,
      metadataProvider: args.expectedMetadataProvider,
    }));
  assertSeriesWatchGeneration(item, args.generation);
  if (epoch !== args.expectedOrderEpoch) throw staleSeasonEpoch();

  const seasonOrder = mapping.seasonOrder;
  const identityAvailable = resolved.metadataProvider === 'tmdb' || seasonOrder !== undefined;
  const summaryIdentityKey = identityAvailable
    ? seasonSummaryIdentityKey(resolved, seasonOrder)
    : undefined;
  const restarted = resolved.refreshedAt !== args.expectedRefreshedAt;
  const offset = restarted ? 0 : args.offset;
  const batch = await loadSeasonWatchChunk(ctx, resolved, offset);
  // Contiguous episode chunks need one index range read, not one query per episode.
  // Sparse provider numbering retains bounded point lookups.
  const minimum = Math.min(...batch.map((episode) => episode.episode));
  const maximum = Math.max(...batch.map((episode) => episode.episode));
  let existing: (Doc<'episodes'> | null)[];
  if (batch.length > 0 && maximum - minimum < SEASON_WATCH_BATCH_SIZE) {
    const rows = await ctx.db
      .query('episodes')
      .withIndex('by_item', (query) =>
        query
          .eq('itemId', args.itemId)
          .eq('season', args.season)
          .gte('episode', minimum)
          .lte('episode', maximum),
      )
      .take(SEASON_WATCH_BATCH_SIZE + 1);
    const byEpisode = new Map(rows.map((episode) => [episode.episode, episode]));
    if (byEpisode.size !== rows.length) throw new Error('Duplicate saved episode coordinates');
    existing = batch.map((episode) => byEpisode.get(episode.episode) ?? null);
  } else {
    existing = await Promise.all(
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
  }
  const activityDate = args.activityDate ?? resolveActivityDate(undefined);
  const activityEvents = buffered?.activityEvents ?? [];
  const watchActivityDeltas = buffered?.watchActivityDeltas ?? new Map<string, number>();
  const summary = await ctx.db
    .query('episodeSummaries')
    .withIndex('by_item', (q) => q.eq('itemId', item._id).eq('season', args.season))
    .unique();
  const summaryIsCurrent =
    summary?.currentIdentityKey === summaryIdentityKey &&
    summary?.currentSeasonVersion === resolved.seasonVersion;
  const summaryUpdates: EpisodeSummaryUpsert[] = [];
  let changed = false;
  await Promise.all(
    batch.map(async (episode, index) => {
      const saved = existing[index];
      if (
        args.generation &&
        saved?.seriesWatchOverride === args.generation &&
        !currentSeriesOverride(item.seriesWatch, saved, {
          metadataProvider: resolved.metadataProvider,
          seasonOrder: resolved.metadataProvider === 'tvdb' ? seasonOrder : undefined,
          providerEpisodeId: episode.providerEpisodeId,
        })
      )
        throw new ConvexError({
          code: 'episode_identity_changed',
          message:
            'A newer episode edit needs its original metadata identity; hydration will retry',
        });

      if (
        args.generation &&
        (!seriesWatchIncludes(item.seriesWatch, episode) ||
          currentSeriesOverride(item.seriesWatch, saved, {
            metadataProvider: resolved.metadataProvider,
            seasonOrder: resolved.metadataProvider === 'tvdb' ? seasonOrder : undefined,
            providerEpisodeId: episode.providerEpisodeId,
          }))
      )
        return;
      if (
        summaryIsCurrent &&
        saved?.watched === args.watched &&
        identityAvailable &&
        episodeMatchesStamp(saved, {
          metadataProvider: resolved.metadataProvider,
          seasonOrder: resolved.metadataProvider === 'tvdb' ? seasonOrder : undefined,
          providerEpisodeId: episode.providerEpisodeId,
        }) &&
        (!args.watched ||
          (
            [
              ['seasonName', seasonName],
              ['name', episode.name],
              ['overview', episode.overview],
              ['runtime', episode.runtime],
              ['imageUrl', episode.imageUrl],
              ['airDate', episode.airDate],
            ] as const
          ).every(([key, value]) => value === undefined || saved[key] === value))
      )
        return;
      changed = true;
      await setEpisode(
        ctx,
        args.userId,
        {
          itemId: args.itemId,
          ...episode,
          watched: args.watched,
          activityDate,
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
        {
          item,
          existing: existing[index] ?? null,
          activityEvents,
          watchActivityDeltas,
          summaryUpdates,
          seriesGeneration: args.generation,
        },
      );
    }),
  );
  await updateSummaryForEpisodeUpserts(ctx, args.userId, item._id, args.season, summaryUpdates);
  if (!buffered) {
    for (const [date, delta] of watchActivityDeltas)
      await recordWatchActivity(ctx, args.userId, date, delta);
    await writeActivityEvents(ctx, activityEvents);
  }
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
  if (changed && !buffered) await refreshNextEpisode(ctx, item._id, watchedCoordinate);
  return {
    processed: batch.length,
    episodeCount,
    refreshedAt: resolved.refreshedAt,
    restarted,
  };
}

export const setSeasonWatchedBatch = internalMutation({
  args: seasonWatchBatchArgs,
  returns: v.object({
    processed: v.number(),
    episodeCount: v.number(),
    refreshedAt: v.number(),
    restarted: v.boolean(),
  }),
  handler: applySeasonWatchedBatch,
});

type SeasonWatchedActionArgs = {
  userId: Id<'users'>;
  itemId: Id<'items'>;
  season: number;
  watched: boolean;
  activityDate: string;
  orderEpoch?: number;
  metadataProvider?: 'tmdb' | 'tvdb';
  generation?: string;
};

async function applySeasonWatched(
  ctx: ActionCtx,
  {
    userId,
    itemId,
    season,
    watched,
    activityDate,
    orderEpoch,
    metadataProvider,
    generation,
  }: SeasonWatchedActionArgs,
): Promise<{ processed: number }> {
  if (!Number.isInteger(season) || season < 0 || season > 10_000)
    throw new Error('Season must be an integer between 0 and 10000');
  const plan = await ctx.runQuery(internal.library.seasonWatched.getSeasonWatchedPlan, {
    userId,
    itemId,
    season,
    watched,
    orderEpoch,
    metadataProvider,
    generation,
  });
  if (plan.complete) return { processed: plan.episodeCount };
  // Keep one watch day across chunks, metadata restarts, and midnight.
  let processed = 0;
  let batches = 0;
  let restarts = 0;
  let episodeCount = plan.episodeCount;
  let refreshedAt = plan.refreshedAt;
  while (true) {
    if (processed >= episodeCount) {
      const current = await ctx.runQuery(internal.library.seasonWatched.getSeasonWatchedPlan, {
        userId,
        itemId,
        season,
        watched,
        orderEpoch: plan.orderEpoch,
        metadataProvider: plan.metadataProvider,
        generation,
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
    const result = await ctx.runMutation(internal.library.seasonWatched.setSeasonWatchedBatch, {
      userId,
      itemId,
      season,
      watched,
      activityDate,
      offset: processed,
      expectedRefreshedAt: refreshedAt,
      expectedOrderEpoch: plan.orderEpoch,
      expectedMetadataProvider: plan.metadataProvider,
      generation,
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
    activityDate: v.optional(v.string()),
    orderEpoch: v.optional(v.number()),
    metadataProvider: v.optional(v.union(v.literal('tmdb'), v.literal('tvdb'))),
  },
  returns: v.object({ processed: v.number() }),
  handler: async (
    ctx,
    { itemId, season, watched = true, activityDate, orderEpoch, metadataProvider },
  ) => {
    const userId = await requireUser(ctx);
    return applySeasonWatched(ctx, {
      userId,
      itemId,
      season,
      watched,
      activityDate: resolveActivityDate(activityDate),
      orderEpoch,
      metadataProvider,
    });
  },
});

// Only trust progress for the exact published metadata version, with no rebuild pending.
function seasonIsWatched(
  summary: Doc<'episodeSummaries'> | null,
  season: Doc<'resolvedSeasons'>,
  mapping: Doc<'titleMappings'>,
) {
  return (
    (season.metadataProvider !== 'tvdb' || mapping.seasonOrder !== undefined) &&
    summary?.currentIdentityKey === seasonSummaryIdentityKey(season, mapping.seasonOrder) &&
    summary.currentSeasonVersion === season.seasonVersion &&
    summary.rebuildIdentityKey === undefined &&
    summary.currentTotal === season.episodeCount &&
    summary.currentWatchedCount === season.episodeCount
  );
}

const watchedMoveArgs = {
  userId: v.id('users'),
  itemId: v.id('items'),
  activityDate: v.string(),
  beforeId: v.optional(v.id('items')),
  afterId: v.optional(v.id('items')),
  generation: v.optional(v.string()),
};

export const tryMoveCachedItemToWatched = internalMutation({
  args: watchedMoveArgs,
  returns: v.union(v.number(), v.null()),
  handler: moveCachedItemToWatched,
});

async function moveCachedItemToWatched(
  ctx: MutationCtx,
  { userId, ...args }: ObjectType<typeof watchedMoveArgs>,
): Promise<number | null> {
  const item = await ownedItem(ctx, args.itemId, userId);
  assertSeriesWatchGeneration(item, args.generation);
  if (item.mediaType !== 'tv') return moveItemToSlot(ctx, userId, { ...args, status: 'watched' });
  const [title, mapping, summaries] = await Promise.all([
    ctx.db
      .query('resolvedTitles')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', 'tv').eq('tmdbId', item.tmdbId))
      .unique(),
    ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', 'tv').eq('tmdbId', item.tmdbId))
      .unique(),
    ctx.db
      .query('episodeSummaries')
      .withIndex('by_item', (q) => q.eq('itemId', item._id))
      .take(101),
  ]);
  if (
    !title ||
    !mapping ||
    title.orderEpoch !== mapping.orderEpoch ||
    title.refreshAfter <= Date.now() ||
    !title.seasons.length ||
    title.seasons.length > 100
  )
    return null;
  const pending: Awaited<ReturnType<typeof loadSeasonWatchState>>[] = [];
  let work = 0;
  for (const entry of title.seasons) {
    if (entry.season < 0) continue;
    const season = await ctx.db
      .query('resolvedSeasons')
      .withIndex('by_tmdb_season', (q) => q.eq('tmdbId', item.tmdbId).eq('season', entry.season))
      .unique();
    if (
      !season ||
      season.orderEpoch !== mapping.orderEpoch ||
      season.metadataProvider !== title.metadataProvider ||
      season.refreshAfter <= Date.now() ||
      !season.chunksComplete ||
      season.chunkCount === undefined ||
      season.seasonVersion === undefined ||
      season.episodeCount === undefined
    )
      return null;
    if (seasonIsWatched(summaries.find((s) => s.season === entry.season) ?? null, season, mapping))
      continue;
    work += season.episodeCount;
    // Larger updates retain the bounded, restartable action path.
    if (work > MAX_ATOMIC_WATCH_EPISODES) return null;
    if (season.episodeCount > 0)
      pending.push({
        item,
        mapping,
        resolved: season,
        episodeCount: season.episodeCount,
        epoch: mapping.orderEpoch,
        seasonName: entry.name,
      });
  }
  // Preflight above performs no writes. All episodes, counters, history and the
  // final status commit together for bounded whole-series updates.
  const activityEvents: ActivityEventWrite[] = [];
  const watchActivityDeltas = new Map<string, number>();
  for (const state of pending) {
    for (let offset = 0; offset < state.episodeCount; offset += EPISODES_PER_CHUNK) {
      await applySeasonWatchedBatch(
        ctx,
        {
          userId,
          itemId: item._id,
          season: state.resolved.season,
          watched: true,
          activityDate: args.activityDate,
          offset,
          expectedRefreshedAt: state.resolved.refreshedAt,
          expectedOrderEpoch: mapping.orderEpoch,
          expectedMetadataProvider: state.resolved.metadataProvider,
          generation: args.generation,
        },
        { state, activityEvents, watchActivityDeltas },
      );
    }
  }
  for (const [date, delta] of watchActivityDeltas)
    await recordWatchActivity(ctx, userId, date, delta);
  if (pending.length > 0) await refreshNextEpisode(ctx, item._id);
  const rank = args.generation
    ? item.rank
    : await moveItemToSlot(ctx, userId, { ...args, status: 'watched' }, activityEvents);
  await writeActivityEvents(ctx, activityEvents);
  return rank;
}

export const finishWatchedFromSnapshots = internalMutation({
  args: watchedMoveArgs,
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, args): Promise<number | null> => {
    if (!(await publishWatchMetadataFromSnapshots(ctx, args))) return null;
    return moveCachedItemToWatched(ctx, args);
  },
});

export const getMissingWatchSeasonMetadata = internalQuery({
  args: { userId: v.id('users'), itemId: v.id('items') },
  handler: async (ctx, { userId, itemId }) => {
    const item = await ownedItem(ctx, itemId, userId);
    const [title, seasons] = await Promise.all([
      ctx.db
        .query('resolvedTitles')
        .withIndex('by_tmdb', (q) => q.eq('mediaType', 'tv').eq('tmdbId', item.tmdbId))
        .unique(),
      ctx.db
        .query('resolvedSeasons')
        .withIndex('by_tmdb_season', (q) => q.eq('tmdbId', item.tmdbId))
        .take(1001),
    ]);
    if (!title) return null;
    const cached = new Map(seasons.map((season) => [season.season, season]));
    return {
      tmdbId: item.tmdbId,
      tvdbId: title.tvdbId,
      seasonOrder: title.seasonOrder,
      metadataProvider: title.metadataProvider,
      seasons: title.seasons
        .filter((entry) => {
          const season = cached.get(entry.season);
          return (
            entry.season >= 0 &&
            (!season ||
              season.orderEpoch !== title.orderEpoch ||
              season.refreshAfter <= Date.now() ||
              !season.chunksComplete)
          );
        })
        .map((entry) => entry.season),
    };
  },
});

async function prefetchWatchSeasonMetadata(
  ctx: ActionCtx,
  userId: Id<'users'>,
  itemId: Id<'items'>,
): Promise<void> {
  const plan = await ctx.runQuery(internal.library.seasonWatched.getMissingWatchSeasonMetadata, {
    userId,
    itemId,
  });
  if (!plan || plan.seasons.length === 0) return;
  let nextSeason = 0;
  const warmTmdb = async () => {
    while (nextSeason < plan.seasons.length) {
      const seasons = plan.seasons.slice(nextSeason, nextSeason + 20);
      nextSeason += 20;
      // Prefetch only provider snapshots. Canonical publication below retains its
      // existing lease, epoch checks and failure handling, including optional TMDB failures.
      try {
        await ctx.runAction(internal.tmdb.prefetchSeasonDetails, { tmdbId: plan.tmdbId, seasons });
      } catch {
        /* The canonical resolver decides whether this provider is required. */
      }
    }
  };
  const warmTvdb = async () => {
    if (plan.metadataProvider !== 'tvdb' || !plan.tvdbId || !plan.seasonOrder) return;
    // TVDB downloads the shared series catalog: warm it once, not once per worker.
    try {
      await ctx.runAction(internal.tvdb.refreshSeason, {
        tvdbId: plan.tvdbId,
        order: plan.seasonOrder,
        season: plan.seasons[0]!,
      });
    } catch {
      /* The canonical resolver reports required-provider failures. */
    }
  };
  await Promise.all([
    warmTvdb(),
    ...Array.from({ length: Math.min(2, Math.ceil(plan.seasons.length / 20)) }, warmTmdb),
  ]);
}

async function moveItemToWatchedForUser(
  ctx: ActionCtx,
  userId: Id<'users'>,
  args: {
    itemId: Id<'items'>;
    activityDate: string;
    beforeId?: Id<'items'>;
    afterId?: Id<'items'>;
    generation?: string;
  },
): Promise<number> {
  const cachedRank = await ctx.runMutation(
    internal.library.seasonWatched.tryMoveCachedItemToWatched,
    { userId, ...args },
  );
  if (cachedRank !== null) return cachedRank;
  const item: Doc<'items'> = await ctx.runQuery(
    internal.library.ordering.getOwnedItemForStatusMove,
    {
      userId,
      itemId: args.itemId,
    },
  );
  if (item.mediaType === 'tv') {
    const initialTitle = await ctx.runAction(
      internal.resolvedMetadata.titleResolution.resolveTitleForUser,
      {
        userId,
        mediaType: 'tv',
        tmdbId: item.tmdbId,
        title: item.title,
        deferEpisodes: true,
      },
    );
    if (!initialTitle?.seasons.length) throw new Error('Season information is unavailable');
    // The initial TMDB season list can gain or lose episodes or seasons while
    // the anime mapping to TVDB is still in flight.
    const done = new Set<string>();
    let pending: number[] = initialTitle.seasons
      .map((entry: { season: number }) => entry.season)
      .filter((season: number) => season >= 0);
    for (
      let pass = 0;
      bulkWatchState(pending, pass, MAX_WATCHED_SEASON_PASSES).state === 'marking';
      pass += 1
    ) {
      await prefetchWatchSeasonMetadata(ctx, userId, item._id);
      const publishedRank = await ctx.runMutation(
        internal.library.seasonWatched.finishWatchedFromSnapshots,
        { userId, ...args },
      );
      if (publishedRank !== null) return publishedRank;
      const toWatch: { season: number; orderEpoch: number; metadataProvider: 'tmdb' | 'tvdb' }[] =
        [];
      for (const season of pending) {
        const episodes = await ctx.runAction(
          internal.resolvedMetadata.seasonResolution.resolveSeasonForUser,
          { userId, tmdbId: item.tmdbId, season },
        );
        const currentTitle = await ctx.runQuery(internal.resolvedMetadata.reads.readTitle, {
          mediaType: 'tv',
          tmdbId: item.tmdbId,
        });
        if (!currentTitle) throw new Error('Season identity is unavailable');
        const expected =
          currentTitle.seasons.find((entry: { season: number }) => entry.season === season)
            ?.episodeCount ?? 0;
        if (episodes.length === 0) {
          if (expected > 0) throw new Error('Episode information is unavailable');
          done.add(watchedSeasonKey(currentTitle, season));
          continue;
        }
        toWatch.push({
          season,
          orderEpoch: currentTitle.orderEpoch,
          metadataProvider: currentTitle.metadataProvider,
        });
      }
      const atomicRank = await ctx.runMutation(
        internal.library.seasonWatched.tryMoveCachedItemToWatched,
        { userId, ...args },
      );
      if (atomicRank !== null) return atomicRank;
      const resolvedTitle = await ctx.runQuery(internal.resolvedMetadata.reads.readTitle, {
        mediaType: 'tv',
        tmdbId: item.tmdbId,
      });
      if (!resolvedTitle) throw new Error('Season identity is unavailable');
      for (const season of toWatch) {
        // An order change during resolution is revisited on the next pass.
        if (
          season.orderEpoch !== resolvedTitle.orderEpoch ||
          season.metadataProvider !== resolvedTitle.metadataProvider
        )
          continue;
        await applySeasonWatched(ctx, {
          userId,
          itemId: item._id,
          season: season.season,
          watched: true,
          activityDate: args.activityDate,
          orderEpoch: season.orderEpoch,
          metadataProvider: season.metadataProvider,
          generation: args.generation,
        });
        done.add(watchedSeasonKey(resolvedTitle, season.season));
      }
      const latest = await ctx.runQuery(internal.resolvedMetadata.reads.readTitle, {
        mediaType: 'tv',
        tmdbId: item.tmdbId,
      });
      if (!latest) throw new Error('Season identity is unavailable');
      pending = latest.seasons
        .map((entry: { season: number }) => entry.season)
        .filter((season: number) => season >= 0 && !done.has(watchedSeasonKey(latest, season)));
    }
    if (
      bulkWatchState(pending, MAX_WATCHED_SEASON_PASSES, MAX_WATCHED_SEASON_PASSES).state ===
      'exhausted'
    )
      throw staleSeasonEpoch();
  }
  if (args.generation) {
    const current: Doc<'items'> = await ctx.runQuery(
      internal.library.ordering.getOwnedItemForStatusMove,
      { userId, itemId: item._id },
    );
    assertSeriesWatchGeneration(current, args.generation);
    return current.rank;
  }
  return ctx.runMutation(internal.library.ordering.moveItemToSlotInternal, {
    userId,
    itemId: item._id,
    status: 'watched',
    beforeId: args.beforeId,
    afterId: args.afterId,
  });
}

export const declareSeriesWatched = internalMutation({
  args: watchedMoveArgs,
  returns: v.number(),
  handler: async (ctx, { userId, ...args }): Promise<number> => {
    const item = await ownedItem(ctx, args.itemId, userId);
    const rank = await moveItemToSlot(ctx, userId, { ...args, status: 'watched' });
    if (item.mediaType !== 'tv') return rank;
    const generation = crypto.randomUUID();
    await ctx.db.patch(item._id, {
      nextEpisode: undefined,
      seriesWatch: {
        generation,
        hydrationToken: generation,
        watchedAt: Date.now(),
        activityDate: args.activityDate,
        hydration: 'pending',
        attempts: 0,
      },
    });
    await ctx.scheduler.runAfter(0, internal.library.seasonWatched.hydrateSeriesWatch, {
      userId,
      itemId: item._id,
      generation,
      token: generation,
      attempt: 0,
    });
    return rank;
  },
});

export const finishSeriesHydration = internalMutation({
  args: {
    userId: v.id('users'),
    itemId: v.id('items'),
    generation: v.string(),
    succeeded: v.boolean(),
    token: v.string(),
    attempt: v.number(),
  },
  handler: async (ctx, { userId, itemId, generation, succeeded, token, attempt }) => {
    const item = await ctx.db.get(itemId);
    if (
      !item ||
      item.userId !== userId ||
      item.deletingAt !== undefined ||
      item.seriesWatch?.generation !== generation ||
      item.seriesWatch.hydrationToken !== token ||
      item.seriesWatch.attempts !== attempt ||
      item.seriesWatch.hydration !== 'pending'
    )
      return;
    const watch = item.seriesWatch;
    if (succeeded) {
      await ctx.db.patch(itemId, {
        seriesWatch: {
          ...watch,
          hydration: 'complete',
          leaseUntil: undefined,
          hydratedAt: Date.now(),
          retryAt: undefined,
        },
      });
      return;
    }
    const attempts = watch.attempts + 1;
    const retryMs = [1_000, 5_000, 30_000, 120_000, 300_000][attempts - 1];
    await ctx.db.patch(itemId, {
      seriesWatch: {
        ...watch,
        attempts,
        leaseUntil: undefined,
        hydration: retryMs === undefined ? 'failed' : 'pending',
        retryAt: retryMs === undefined ? undefined : Date.now() + retryMs,
      },
    });
    if (retryMs !== undefined)
      await ctx.scheduler.runAfter(retryMs, internal.library.seasonWatched.hydrateSeriesWatch, {
        userId,
        itemId,
        generation,
        token,
        attempt: attempts,
      });
  },
});

export const resumeSeriesWatch = internalMutation({
  args: { itemId: v.id('items'), refreshedAt: v.number() },
  handler: async (ctx, { itemId, refreshedAt }) => {
    const item = await ctx.db.get(itemId);
    const watch = item?.seriesWatch;
    if (
      !item ||
      item.deletingAt !== undefined ||
      !watch ||
      watch.hydration === 'pending' ||
      (watch.hydratedAt !== undefined && watch.hydratedAt >= refreshedAt)
    )
      return;
    const token = crypto.randomUUID();
    await ctx.db.patch(itemId, {
      seriesWatch: {
        ...watch,
        hydration: 'pending',
        hydrationToken: token,
        leaseUntil: undefined,
        attempts: 0,
        retryAt: undefined,
      },
    });
    await ctx.scheduler.runAfter(0, internal.library.seasonWatched.hydrateSeriesWatch, {
      itemId,
      userId: item.userId,
      generation: watch.generation,
      token,
      attempt: 0,
    });
  },
});

const hydrationAttemptArgs = {
  userId: v.id('users'),
  itemId: v.id('items'),
  generation: v.string(),
  token: v.string(),
  attempt: v.number(),
};

export const claimSeriesHydration = internalMutation({
  args: hydrationAttemptArgs,
  handler: async (ctx, args): Promise<Doc<'items'> | null> => {
    const item = await ctx.db.get(args.itemId);
    const watch = item?.seriesWatch;
    if (
      !item ||
      item.userId !== args.userId ||
      item.deletingAt !== undefined ||
      !watch ||
      watch.generation !== args.generation ||
      watch.hydrationToken !== args.token ||
      watch.attempts !== args.attempt ||
      watch.hydration !== 'pending' ||
      (watch.retryAt !== undefined && watch.retryAt > Date.now()) ||
      (watch.leaseUntil !== undefined && watch.leaseUntil > Date.now())
    )
      return null;
    const leaseUntil = Date.now() + 120_000;
    await ctx.db.patch(item._id, { seriesWatch: { ...watch, leaseUntil } });
    await ctx.scheduler.runAfter(120_000, internal.library.seasonWatched.recoverSeriesHydration, {
      ...args,
      leaseUntil,
    });
    return item;
  },
});

export const recoverSeriesHydration = internalMutation({
  args: { ...hydrationAttemptArgs, leaseUntil: v.number() },
  handler: async (ctx, { leaseUntil, ...args }) => {
    const item = await ctx.db.get(args.itemId);
    const watch = item?.seriesWatch;
    if (
      !item ||
      item.userId !== args.userId ||
      item.deletingAt !== undefined ||
      !watch ||
      watch.generation !== args.generation ||
      watch.hydrationToken !== args.token ||
      watch.attempts !== args.attempt ||
      watch.hydration !== 'pending' ||
      watch.leaseUntil !== leaseUntil ||
      leaseUntil > Date.now()
    )
      return;
    const attempt = args.attempt + 1;
    await ctx.db.patch(item._id, {
      seriesWatch: {
        ...watch,
        leaseUntil: undefined,
        retryAt: undefined,
        attempts: attempt,
        hydration: attempt > 5 ? 'failed' : 'pending',
      },
    });
    if (attempt <= 5)
      await ctx.scheduler.runAfter(0, internal.library.seasonWatched.hydrateSeriesWatch, {
        ...args,
        attempt,
      });
  },
});

export const hydrateSeriesWatch = internalAction({
  args: {
    userId: v.id('users'),
    itemId: v.id('items'),
    generation: v.string(),
    token: v.string(),
    attempt: v.number(),
  },
  handler: async (ctx, { userId, itemId, generation, token, attempt }): Promise<void> => {
    try {
      const item = await ctx.runMutation(internal.library.seasonWatched.claimSeriesHydration, {
        userId,
        itemId,
        generation,
        token,
        attempt,
      });
      if (!item?.seriesWatch) return;
      await moveItemToWatchedForUser(ctx, userId, {
        itemId,
        generation,
        activityDate: item.seriesWatch.activityDate,
      });
      await ctx.runMutation(internal.library.seasonWatched.finishSeriesHydration, {
        userId,
        itemId,
        generation,
        token,
        attempt,
        succeeded: true,
      });
    } catch {
      // Keep the declaration authoritative through outages. Retry hydration, not the user's mark.
      await ctx.runMutation(internal.library.seasonWatched.finishSeriesHydration, {
        userId,
        itemId,
        generation,
        token,
        attempt,
        succeeded: false,
      });
    }
  },
});

export const moveItemToWatched = action({
  args: {
    itemId: v.id('items'),
    activityDate: v.optional(v.string()),
    beforeId: v.optional(v.id('items')),
    afterId: v.optional(v.id('items')),
  },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    const userId = await requireUser(ctx);
    return ctx.runMutation(internal.library.seasonWatched.declareSeriesWatched, {
      userId,
      ...args,
      activityDate: resolveActivityDate(args.activityDate),
    });
  },
});

export const addItemAndMarkWatched = action({
  args: { ...addItemFields, activityDate: v.optional(v.string()) },
  returns: v.id('items'),
  handler: async (ctx, { activityDate, ...args }): Promise<Id<'items'>> => {
    if (args.mediaType !== 'tv' || args.status !== 'watched')
      throw new Error('This action only adds watched TV shows');
    const userId = await requireUser(ctx);
    const watchDate = resolveActivityDate(activityDate);
    const itemId: Id<'items'> = await ctx.runMutation(internal.library.items.addItemInternal, {
      userId,
      ...args,
      status: 'watchlist',
    });
    try {
      await ctx.runMutation(internal.library.seasonWatched.declareSeriesWatched, {
        userId,
        itemId,
        activityDate: watchDate,
      });
    } catch (error) {
      await ctx
        .runMutation(internal.library.seasonWatched.discardAddedItem, { userId, itemId })
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
      await bumpCalendarRevision(ctx, userId);
      await updateProfileStatsForItem(ctx, item, null);
    }
    await ctx.scheduler.runAfter(0, internal.library.items.continueRemoveItem, { itemId });
  },
});
