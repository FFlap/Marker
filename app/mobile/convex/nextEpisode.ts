import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, type MutationCtx } from './_generated/server';
import { isEpisodeReleased } from './episodeAvailability';
import { EPISODES_PER_CHUNK } from './seasonStorage';

const MAX_TITLE_SEASONS = 1_000;
const MAX_ITEM_SUMMARIES = 1_001;
const ITEM_FAN_OUT_BATCH_SIZE = 10;
const FAVORITE_DISPLAY_PATCH_LIMIT = 20;
export const COORDINATE_CHUNK_PAIR_LIMIT = 2;

type CoordinateCursor = { season: number; chunkIndex: number };
type WatchedEpisodeHint = { season: number; episode: number };
type RefreshResult = {
  state: 'completed' | 'continued' | 'superseded' | 'skipped';
  chunkPairsRead: number;
};

const refreshResultValidator = v.object({
  state: v.union(
    v.literal('completed'),
    v.literal('continued'),
    v.literal('superseded'),
    v.literal('skipped'),
  ),
  chunkPairsRead: v.number(),
});

const identityKey = (
  value: Pick<Doc<'resolvedSeasons'>, 'metadataProvider' | 'orderEpoch'>,
  seasonOrder?: string,
) =>
  JSON.stringify([
    value.metadataProvider,
    value.metadataProvider === 'tvdb' ? seasonOrder : undefined,
    value.orderEpoch,
  ]);

const seasonOrderValue = (season: number) => (season === 0 ? Number.MAX_SAFE_INTEGER : season);

const savedMatchesCanonical = (
  saved: Doc<'episodes'> | undefined,
  provider: 'tmdb' | 'tvdb',
  seasonOrder: string | undefined,
  providerEpisodeId: number | undefined,
) =>
  !!saved &&
  saved.metadataProvider === provider &&
  saved.seasonOrder === (provider === 'tvdb' ? seasonOrder : undefined) &&
  (providerEpisodeId === undefined || saved.providerEpisodeId === providerEpisodeId);

/**
 * Returns the only chunk indexes a coordinate transaction may inspect. The
 * injectable limit makes the transaction bound directly testable without
 * relying on Convex's internal read counters.
 */
export function coordinateChunkWindow(
  startChunkIndex: number,
  chunkCount: number,
  maximum = COORDINATE_CHUNK_PAIR_LIMIT,
) {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > COORDINATE_CHUNK_PAIR_LIMIT)
    throw new Error(`Coordinate refreshes are limited to ${COORDINATE_CHUNK_PAIR_LIMIT} chunks`);
  const start = Math.max(0, startChunkIndex);
  return Array.from(
    { length: Math.min(maximum, Math.max(0, chunkCount - start)) },
    (_, offset) => start + offset,
  );
}

export function coordinateChunkPairBudget(maximum = COORDINATE_CHUNK_PAIR_LIMIT) {
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > COORDINATE_CHUNK_PAIR_LIMIT)
    throw new Error(`Coordinate refreshes are limited to ${COORDINATE_CHUNK_PAIR_LIMIT} chunks`);
  let reads = 0;
  return {
    canRead: () => reads < maximum,
    recordRead: () => {
      if (reads >= maximum)
        throw new Error(`Coordinate refreshes are limited to ${maximum} chunks`);
      reads += 1;
      return reads;
    },
  };
}

async function loadRefreshContext(ctx: MutationCtx, item: Doc<'items'>) {
  const [title, mapping, summaries] = await Promise.all([
    ctx.db
      .query('resolvedTitles')
      .withIndex('by_tmdb', (query) => query.eq('mediaType', 'tv').eq('tmdbId', item.tmdbId))
      .unique(),
    ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (query) => query.eq('mediaType', 'tv').eq('tmdbId', item.tmdbId))
      .unique(),
    ctx.db
      .query('episodeSummaries')
      .withIndex('by_item', (query) => query.eq('itemId', item._id))
      .take(MAX_ITEM_SUMMARIES),
  ]);
  if (!title || (mapping && title.orderEpoch !== mapping.orderEpoch)) return null;
  if (title.seasons.length > MAX_TITLE_SEASONS || summaries.length >= MAX_ITEM_SUMMARIES)
    throw new Error('A title has too many seasons to maintain its next episode');
  return {
    title,
    mapping,
    summaryBySeason: new Map(summaries.map((summary) => [summary.season, summary])),
    seasons: [...title.seasons].sort(
      (left, right) => seasonOrderValue(left.season) - seasonOrderValue(right.season),
    ),
  };
}

type RefreshContext = NonNullable<Awaited<ReturnType<typeof loadRefreshContext>>>;

function seasonNeedsCoordinate(context: RefreshContext, season: RefreshContext['seasons'][number]) {
  if (season.episodeCount <= 0) return false;
  const summary = context.summaryBySeason.get(season.season);
  if (!summary) return true;
  const key = identityKey(context.title, context.mapping?.seasonOrder);
  return (
    summary.currentIdentityKey !== key ||
    (summary.currentWatchedCount ?? 0) < (summary.currentTotal ?? season.episodeCount)
  );
}

async function currentCoordinateCursor(
  ctx: MutationCtx,
  context: RefreshContext,
  item: Doc<'items'>,
  hint: WatchedEpisodeHint,
) {
  const coordinate = item.nextEpisode;
  if (coordinate?.season !== hint.season || coordinate.episode !== hint.episode) return undefined;
  if (coordinate.chunkIndex !== undefined)
    return { season: coordinate.season, chunkIndex: coordinate.chunkIndex };

  // Coordinates written before chunkIndex was introduced are located with a
  // six-read binary search (50 chunks maximum), then gain chunkIndex when the
  // new coordinate is atomically published.
  const season = await ctx.db
    .query('resolvedSeasons')
    .withIndex('by_tmdb_season', (query) =>
      query.eq('tmdbId', item.tmdbId).eq('season', coordinate.season),
    )
    .unique();
  if (
    !season ||
    season.chunksComplete !== true ||
    season.chunkCount === undefined ||
    season.seasonVersion === undefined ||
    season.orderEpoch !== context.title.orderEpoch ||
    (context.mapping && season.orderEpoch !== context.mapping.orderEpoch)
  )
    return undefined;
  let low = 0;
  let high = season.chunkCount - 1;
  while (low <= high) {
    const chunkIndex = Math.floor((low + high) / 2);
    const chunk = await ctx.db
      .query('resolvedSeasonChunks')
      .withIndex('by_tmdb_season_version_chunk', (query) =>
        query
          .eq('tmdbId', item.tmdbId)
          .eq('season', coordinate.season)
          .eq('seasonVersion', season.seasonVersion!)
          .eq('chunkIndex', chunkIndex),
      )
      .unique();
    if (!chunk?.episodes.length) return undefined;
    const firstEpisode = Math.min(...chunk.episodes.map((episode) => episode.episode));
    const lastEpisode = Math.max(...chunk.episodes.map((episode) => episode.episode));
    if (coordinate.episode < firstEpisode) high = chunkIndex - 1;
    else if (coordinate.episode > lastEpisode) low = chunkIndex + 1;
    else if (chunk.episodes.some((episode) => episode.episode === coordinate.episode))
      return { season: coordinate.season, chunkIndex };
    else return undefined;
  }
  return undefined;
}

async function firstCursor(
  ctx: MutationCtx,
  context: RefreshContext,
  item: Doc<'items'>,
  hint?: WatchedEpisodeHint,
) {
  if (hint) {
    const fastCursor = await currentCoordinateCursor(ctx, context, item, hint);
    if (fastCursor) return fastCursor;
  }
  const season = context.seasons.find((candidate) => seasonNeedsCoordinate(context, candidate));
  return season ? { season: season.season, chunkIndex: 0 } : undefined;
}

function nextSeasonCursor(context: RefreshContext, seasonNumber: number) {
  const index = context.seasons.findIndex((season) => season.season === seasonNumber);
  const season = context.seasons
    .slice(index < 0 ? 0 : index + 1)
    .find((candidate) => seasonNeedsCoordinate(context, candidate));
  return season ? { season: season.season, chunkIndex: 0 } : undefined;
}

async function activeRefresh(ctx: MutationCtx, itemId: Id<'items'>) {
  return ctx.db
    .query('nextEpisodeRefreshes')
    .withIndex('by_item', (query) => query.eq('itemId', itemId))
    .unique();
}

async function finishRefresh(
  ctx: MutationCtx,
  item: Doc<'items'>,
  refresh: Doc<'nextEpisodeRefreshes'>,
  nextEpisode: Doc<'items'>['nextEpisode'],
  chunkPairsRead: number,
): Promise<RefreshResult> {
  if (JSON.stringify(item.nextEpisode) !== JSON.stringify(nextEpisode))
    await ctx.db.patch(item._id, { nextEpisode });
  await ctx.db.delete(refresh._id);
  return { state: 'completed', chunkPairsRead };
}

async function continueRefreshPage(
  ctx: MutationCtx,
  item: Doc<'items'>,
  refresh: Doc<'nextEpisodeRefreshes'>,
  cursor: CoordinateCursor,
): Promise<RefreshResult> {
  const context = await loadRefreshContext(ctx, item);
  if (!context) return finishRefresh(ctx, item, refresh, undefined, 0);

  let current: CoordinateCursor | undefined = cursor;
  let chunkPairsRead = 0;
  let displayPatches = 0;
  const chunkPairBudget = coordinateChunkPairBudget();
  while (current && chunkPairBudget.canRead()) {
    const seasonInfo = context.seasons.find((season) => season.season === current!.season);
    if (!seasonInfo) return finishRefresh(ctx, item, refresh, undefined, chunkPairsRead);
    const season = await ctx.db
      .query('resolvedSeasons')
      .withIndex('by_tmdb_season', (query) =>
        query.eq('tmdbId', item.tmdbId).eq('season', seasonInfo.season),
      )
      .unique();
    if (
      !season ||
      season.chunksComplete !== true ||
      season.chunkCount === undefined ||
      season.seasonVersion === undefined ||
      (context.mapping && season.orderEpoch !== context.mapping.orderEpoch) ||
      season.orderEpoch !== context.title.orderEpoch
    )
      return finishRefresh(ctx, item, refresh, undefined, chunkPairsRead);
    const seasonOrder =
      season.metadataProvider === 'tvdb' ? context.mapping?.seasonOrder : undefined;
    if (season.metadataProvider === 'tvdb' && seasonOrder === undefined)
      return finishRefresh(ctx, item, refresh, undefined, chunkPairsRead);

    if (current.chunkIndex >= season.chunkCount) {
      current = nextSeasonCursor(context, current.season);
      continue;
    }
    const [chunkIndex] = coordinateChunkWindow(current.chunkIndex, season.chunkCount, 1);
    if (chunkIndex === undefined) {
      current = nextSeasonCursor(context, current.season);
      continue;
    }
    const chunk = await ctx.db
      .query('resolvedSeasonChunks')
      .withIndex('by_tmdb_season_version_chunk', (query) =>
        query
          .eq('tmdbId', item.tmdbId)
          .eq('season', seasonInfo.season)
          .eq('seasonVersion', season.seasonVersion!)
          .eq('chunkIndex', chunkIndex),
      )
      .unique();
    chunkPairsRead = chunkPairBudget.recordRead();
    if (!chunk) return finishRefresh(ctx, item, refresh, undefined, chunkPairsRead);
    const canonical = [...chunk.episodes].sort((left, right) => left.episode - right.episode);
    if (canonical.length) {
      const firstEpisode = canonical[0]!.episode;
      const lastEpisode = canonical[canonical.length - 1]!.episode;
      const saved = await ctx.db
        .query('episodes')
        .withIndex('by_item_identity', (query) =>
          query
            .eq('itemId', item._id)
            .eq('season', seasonInfo.season)
            .eq('metadataProvider', season.metadataProvider)
            .eq('seasonOrder', seasonOrder)
            .gte('episode', firstEpisode)
            .lte('episode', lastEpisode),
        )
        .take(EPISODES_PER_CHUNK + 1);
      if (saved.length > EPISODES_PER_CHUNK)
        throw new Error('A canonical episode chunk has too many saved coordinates in its range');
      const savedByEpisode = new Map(saved.map((entry) => [entry.episode, entry]));
      for (const candidate of canonical) {
        const state = savedByEpisode.get(candidate.episode);
        const matches = savedMatchesCanonical(
          state,
          season.metadataProvider,
          seasonOrder,
          candidate.providerEpisodeId,
        );
        if (matches && state && displayPatches < FAVORITE_DISPLAY_PATCH_LIMIT) {
          const display = {
            seasonName: seasonInfo.name,
            name: candidate.name,
            overview: candidate.overview,
            runtime: candidate.runtime,
            imageUrl: candidate.imageUrl,
            airDate: candidate.airDate,
          };
          if (
            state.seasonName !== display.seasonName ||
            state.name !== display.name ||
            state.overview !== display.overview ||
            state.runtime !== display.runtime ||
            state.imageUrl !== display.imageUrl ||
            state.airDate !== display.airDate
          ) {
            await ctx.db.patch(state._id, display);
            displayPatches += 1;
          }
        }
        if (!state?.watched || !matches) {
          const nextEpisode: NonNullable<Doc<'items'>['nextEpisode']> = {
            season: candidate.season,
            episode: candidate.episode,
            chunkIndex,
            seasonName: seasonInfo.name,
            ...(candidate.name && { name: candidate.name }),
            ...(candidate.airDate && { airDate: candidate.airDate }),
            ...(candidate.airDate === undefined && {
              undatedReleased: isEpisodeReleased(candidate),
            }),
            ...(candidate.runtime !== undefined && { runtime: candidate.runtime }),
            ...(candidate.imageUrl && { imageUrl: candidate.imageUrl }),
            ...(candidate.providerEpisodeId !== undefined && {
              providerEpisodeId: candidate.providerEpisodeId,
            }),
          };
          return finishRefresh(ctx, item, refresh, nextEpisode, chunkPairsRead);
        }
      }
    }
    current = { season: current.season, chunkIndex: chunkIndex + 1 };
  }

  if (!current) return finishRefresh(ctx, item, refresh, undefined, chunkPairsRead);
  await ctx.db.patch(refresh._id, current);
  await ctx.scheduler.runAfter(0, internal.nextEpisode.continueNextEpisodeRefresh, {
    itemId: item._id,
    token: refresh.token,
    ...current,
  });
  return { state: 'continued', chunkPairsRead };
}

/**
 * Starts a fresh per-item chain. A watch of the persisted coordinate resumes at
 * that coordinate's chunk; all other triggers begin at the first relevant season.
 */
export async function refreshNextEpisode(
  ctx: MutationCtx,
  itemOrId: Doc<'items'> | Id<'items'>,
  watchedEpisode?: WatchedEpisodeHint,
): Promise<RefreshResult> {
  const item =
    typeof itemOrId === 'string' ? await ctx.db.get(itemOrId) : await ctx.db.get(itemOrId._id);
  if (!item || item.mediaType !== 'tv' || item.deletingAt !== undefined)
    return { state: 'skipped', chunkPairsRead: 0 };
  const context = await loadRefreshContext(ctx, item);
  const cursor = context ? await firstCursor(ctx, context, item, watchedEpisode) : undefined;
  const existing = await activeRefresh(ctx, item._id);
  if (!cursor) {
    if (existing) await ctx.db.delete(existing._id);
    if (item.nextEpisode !== undefined) await ctx.db.patch(item._id, { nextEpisode: undefined });
    return { state: 'completed', chunkPairsRead: 0 };
  }
  const token = `coordinate:${Date.now()}:${crypto.randomUUID()}`;
  const value = { itemId: item._id, token, ...cursor };
  const refreshId = existing
    ? (await ctx.db.replace(existing._id, value), existing._id)
    : await ctx.db.insert('nextEpisodeRefreshes', value);
  const refresh = (await ctx.db.get(refreshId))!;
  return continueRefreshPage(ctx, item, refresh, cursor);
}

export const startNextEpisodeRefresh = internalMutation({
  args: {
    itemId: v.id('items'),
    watchedEpisode: v.optional(v.object({ season: v.number(), episode: v.number() })),
  },
  returns: refreshResultValidator,
  handler: (ctx, args) => refreshNextEpisode(ctx, args.itemId, args.watchedEpisode),
});

export const continueNextEpisodeRefresh = internalMutation({
  args: {
    itemId: v.id('items'),
    token: v.string(),
    season: v.number(),
    chunkIndex: v.number(),
  },
  returns: refreshResultValidator,
  handler: async (ctx, args): Promise<RefreshResult> => {
    const [item, refresh] = await Promise.all([
      ctx.db.get(args.itemId),
      activeRefresh(ctx, args.itemId),
    ]);
    if (
      !item ||
      item.mediaType !== 'tv' ||
      item.deletingAt !== undefined ||
      !refresh ||
      refresh.token !== args.token ||
      refresh.season !== args.season ||
      refresh.chunkIndex !== args.chunkIndex
    )
      return { state: 'superseded', chunkPairsRead: 0 };
    return continueRefreshPage(ctx, item, refresh, args);
  },
});

/** Fans title/mapping publications out by scheduling independent item transactions. */
export const refreshForTitle = internalMutation({
  args: {
    tmdbId: v.number(),
    cursor: v.optional(v.string()),
  },
  returns: v.object({ updated: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query('items')
      .withIndex('by_media_tmdb', (query) => query.eq('mediaType', 'tv').eq('tmdbId', args.tmdbId))
      .paginate({ cursor: args.cursor ?? null, numItems: ITEM_FAN_OUT_BATCH_SIZE });
    for (const item of page.page) {
      await ctx.scheduler.runAfter(0, internal.nextEpisode.startNextEpisodeRefresh, {
        itemId: item._id,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.episodeProjectionRepair.startEpisodeProjectionRepair,
        {
          itemId: item._id,
        },
      );
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.nextEpisode.refreshForTitle, {
        tmdbId: args.tmdbId,
        cursor: page.continueCursor,
      });
    return { updated: page.page.length, isDone: page.isDone };
  },
});
