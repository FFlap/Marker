import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, type MutationCtx } from './_generated/server';
import { isEpisodeReleased } from './episodeAvailability';
import { episodeMatchesCanonicalIdentity, seasonSummaryIdentityKey } from './episodeSummaries';
import { requestRefresh } from './resolvedMetadata/touch';
import { EPISODES_PER_CHUNK } from './seasonStorage';

const MAX_TITLE_SEASONS = 1_000;
const MAX_ITEM_SUMMARIES = 1_001;
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

const seasonOrderValue = (season: number) => (season === 0 ? Number.MAX_SAFE_INTEGER : season);

async function loadMissingMetadata(ctx: MutationCtx, item: Doc<'items'>, season?: number) {
  if (item.status !== 'watching') return;
  // Provider admission runs separately so an outage or rate limit cannot roll
  // back a saved watch. Canonical publication resumes the coordinate refresh.
  await ctx.scheduler.runAfter(0, internal.nextEpisode.requestMissingMetadata, {
    itemId: item._id,
    ...(season !== undefined && { season }),
  });
}

export const requestMissingMetadata = internalMutation({
  args: { itemId: v.id('items'), season: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { itemId, season }) => {
    const item = await ctx.db.get(itemId);
    if (
      !item ||
      item.mediaType !== 'tv' ||
      item.status !== 'watching' ||
      item.deletingAt !== undefined
    )
      return;
    await requestRefresh(ctx, {
      userId: item.userId,
      mediaType: 'tv',
      tmdbId: item.tmdbId,
      title: item.title,
      season,
    });
  },
});

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
  if (season.episodeCountVerified === false) return true;
  if (season.episodeCount <= 0) return false;
  const summary = context.summaryBySeason.get(season.season);
  if (!summary) return true;
  const key = seasonSummaryIdentityKey(context.title, context.mapping?.seasonOrder);
  return (
    summary.currentIdentityKey !== key ||
    (summary.currentWatchedCount ?? 0) < Math.max(summary.currentTotal ?? 0, season.episodeCount)
  );
}

function currentCoordinateCursor(item: Doc<'items'>, hint: WatchedEpisodeHint) {
  const coordinate = item.nextEpisode;
  if (coordinate?.season !== hint.season || coordinate.episode !== hint.episode) return undefined;
  return { season: coordinate.season, chunkIndex: coordinate.chunkIndex };
}

function firstCursor(context: RefreshContext, item: Doc<'items'>, hint?: WatchedEpisodeHint) {
  if (hint) {
    const fastCursor = currentCoordinateCursor(item, hint);
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
  context: RefreshContext | null,
): Promise<RefreshResult> {
  if (!context) {
    await loadMissingMetadata(ctx, item);
    return finishRefresh(ctx, item, refresh, undefined, 0);
  }

  let current: CoordinateCursor | undefined = cursor;
  let chunkPairsRead = 0;
  let requestedMissingSeason = false;
  while (current && chunkPairsRead < COORDINATE_CHUNK_PAIR_LIMIT) {
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
    ) {
      if (!requestedMissingSeason) {
        await loadMissingMetadata(ctx, item, current.season);
        requestedMissingSeason = true;
      }
      if (seasonInfo.episodeCountVerified !== false)
        return finishRefresh(ctx, item, refresh, undefined, chunkPairsRead);
      current = nextSeasonCursor(context, current.season);
      continue;
    }
    const seasonOrder =
      season.metadataProvider === 'tvdb' ? context.mapping?.seasonOrder : undefined;
    if (season.metadataProvider === 'tvdb' && seasonOrder === undefined)
      return finishRefresh(ctx, item, refresh, undefined, chunkPairsRead);

    if (
      !requestedMissingSeason &&
      seasonInfo.episodeCount > (season.episodeCount ?? 0) &&
      season.refreshedAt < context.title.refreshedAt
    ) {
      await loadMissingMetadata(ctx, item, current.season);
      requestedMissingSeason = true;
    }

    if (current.chunkIndex >= season.chunkCount) {
      current = nextSeasonCursor(context, current.season);
      continue;
    }
    const chunkIndex = current.chunkIndex;
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
    chunkPairsRead += 1;
    if (!chunk) {
      await loadMissingMetadata(ctx, item, current.season);
      return finishRefresh(ctx, item, refresh, undefined, chunkPairsRead);
    }
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
        const matches = episodeMatchesCanonicalIdentity(
          state,
          season.metadataProvider,
          seasonOrder,
          candidate.providerEpisodeId,
        );
        if (!state?.watched || !matches) {
          const nextEpisode: NonNullable<Doc<'items'>['nextEpisode']> = {
            season: candidate.season,
            episode: candidate.episode,
            chunkIndex,
            seasonName: seasonInfo.name,
            ...(candidate.name && { name: candidate.name }),
            ...(candidate.overview && { overview: candidate.overview }),
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
  if (!context || context.title.refreshAfter <= Date.now()) await loadMissingMetadata(ctx, item);
  const cursor = context ? firstCursor(context, item, watchedEpisode) : undefined;
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
  return continueRefreshPage(ctx, item, refresh, cursor, context);
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
    return continueRefreshPage(ctx, item, refresh, args, await loadRefreshContext(ctx, item));
  },
});
