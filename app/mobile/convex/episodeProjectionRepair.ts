import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, type MutationCtx } from './_generated/server';

const MAX_TITLE_SEASONS = 1_000;
export const EPISODE_PROJECTION_REPAIR_ROW_LIMIT = 100;
export const EPISODE_PROJECTION_REPAIR_CHUNK_PAIR_LIMIT = 2;

type RepairCursor = { season: number; chunkIndex: number; afterEpisode?: number };
type RepairResult = {
  state: 'completed' | 'continued' | 'superseded' | 'skipped';
  rowsRead: number;
  patched: number;
  chunkPairsRead: number;
};

const repairResultValidator = v.object({
  state: v.union(
    v.literal('completed'),
    v.literal('continued'),
    v.literal('superseded'),
    v.literal('skipped'),
  ),
  rowsRead: v.number(),
  patched: v.number(),
  chunkPairsRead: v.number(),
});

const seasonOrderValue = (season: number) => (season === 0 ? Number.MAX_SAFE_INTEGER : season);

const savedMatchesCanonical = (
  saved: Doc<'episodes'>,
  provider: 'tmdb' | 'tvdb',
  seasonOrder: string | undefined,
  providerEpisodeId: number | undefined,
) =>
  saved.metadataProvider === provider &&
  saved.seasonOrder === (provider === 'tvdb' ? seasonOrder : undefined) &&
  (providerEpisodeId === undefined || saved.providerEpisodeId === providerEpisodeId);

async function repairContext(ctx: MutationCtx, item: Doc<'items'>) {
  const [title, mapping] = await Promise.all([
    ctx.db
      .query('resolvedTitles')
      .withIndex('by_tmdb', (query) => query.eq('mediaType', 'tv').eq('tmdbId', item.tmdbId))
      .unique(),
    ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (query) => query.eq('mediaType', 'tv').eq('tmdbId', item.tmdbId))
      .unique(),
  ]);
  if (!title || (mapping && title.orderEpoch !== mapping.orderEpoch)) return null;
  if (title.seasons.length > MAX_TITLE_SEASONS)
    throw new Error('A title has too many seasons to repair saved episode projections');
  return {
    title,
    mapping,
    seasons: [...title.seasons]
      .filter((season) => season.episodeCount > 0)
      .sort((left, right) => seasonOrderValue(left.season) - seasonOrderValue(right.season)),
  };
}

type RepairContext = NonNullable<Awaited<ReturnType<typeof repairContext>>>;

function nextSeasonCursor(context: RepairContext, seasonNumber: number) {
  const index = context.seasons.findIndex((season) => season.season === seasonNumber);
  const season = context.seasons[index < 0 ? 0 : index + 1];
  return season ? { season: season.season, chunkIndex: 0 } : undefined;
}

async function activeRepair(ctx: MutationCtx, itemId: Id<'items'>) {
  return ctx.db
    .query('episodeProjectionRepairs')
    .withIndex('by_item', (query) => query.eq('itemId', itemId))
    .unique();
}

async function finishRepair(
  ctx: MutationCtx,
  repair: Doc<'episodeProjectionRepairs'>,
  result: Omit<RepairResult, 'state'>,
): Promise<RepairResult> {
  await ctx.db.delete(repair._id);
  return { state: 'completed', ...result };
}

async function continueRepairPage(
  ctx: MutationCtx,
  item: Doc<'items'>,
  repair: Doc<'episodeProjectionRepairs'>,
  cursor: RepairCursor,
): Promise<RepairResult> {
  const context = await repairContext(ctx, item);
  const result = { rowsRead: 0, patched: 0, chunkPairsRead: 0 };
  if (!context) return finishRepair(ctx, repair, result);

  let current: RepairCursor | undefined = cursor;
  while (
    current &&
    result.rowsRead < EPISODE_PROJECTION_REPAIR_ROW_LIMIT &&
    result.chunkPairsRead < EPISODE_PROJECTION_REPAIR_CHUNK_PAIR_LIMIT
  ) {
    const seasonInfo = context.seasons.find((season) => season.season === current!.season);
    if (!seasonInfo) return finishRepair(ctx, repair, result);
    const season = await ctx.db
      .query('resolvedSeasons')
      .withIndex('by_tmdb_season', (query) =>
        query.eq('tmdbId', item.tmdbId).eq('season', current!.season),
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
      return finishRepair(ctx, repair, result);
    const seasonOrder =
      season.metadataProvider === 'tvdb' ? context.mapping?.seasonOrder : undefined;
    if (season.metadataProvider === 'tvdb' && seasonOrder === undefined)
      return finishRepair(ctx, repair, result);
    if (current.chunkIndex >= season.chunkCount) {
      current = nextSeasonCursor(context, current.season);
      continue;
    }

    const chunk = await ctx.db
      .query('resolvedSeasonChunks')
      .withIndex('by_tmdb_season_version_chunk', (query) =>
        query
          .eq('tmdbId', item.tmdbId)
          .eq('season', current!.season)
          .eq('seasonVersion', season.seasonVersion!)
          .eq('chunkIndex', current!.chunkIndex),
      )
      .unique();
    result.chunkPairsRead += 1;
    if (!chunk) return finishRepair(ctx, repair, result);
    const canonical = [...chunk.episodes].sort((left, right) => left.episode - right.episode);
    if (!canonical.length) {
      current = { season: current.season, chunkIndex: current.chunkIndex + 1 };
      continue;
    }

    const firstEpisode = canonical[0]!.episode;
    const lastEpisode = canonical[canonical.length - 1]!.episode;
    const remaining = EPISODE_PROJECTION_REPAIR_ROW_LIMIT - result.rowsRead;
    const afterEpisode = current.afterEpisode;
    const saved = await ctx.db
      .query('episodes')
      .withIndex('by_item_identity', (query) => {
        const identity = query
          .eq('itemId', item._id)
          .eq('season', current!.season)
          .eq('metadataProvider', season.metadataProvider)
          .eq('seasonOrder', seasonOrder);
        return afterEpisode === undefined
          ? identity.gte('episode', firstEpisode).lte('episode', lastEpisode)
          : identity.gt('episode', afterEpisode).lte('episode', lastEpisode);
      })
      .take(remaining + 1);
    const page = saved.slice(0, remaining);
    result.rowsRead += page.length;
    const canonicalByEpisode = new Map(canonical.map((episode) => [episode.episode, episode]));
    for (const row of page) {
      const episode = canonicalByEpisode.get(row.episode);
      if (
        !episode ||
        !savedMatchesCanonical(row, season.metadataProvider, seasonOrder, episode.providerEpisodeId)
      )
        continue;
      const display = {
        seasonName: seasonInfo.name,
        name: episode.name,
        overview: episode.overview,
        runtime: episode.runtime,
        imageUrl: episode.imageUrl,
        airDate: episode.airDate,
      };
      if (
        row.seasonName !== display.seasonName ||
        row.name !== display.name ||
        row.overview !== display.overview ||
        row.runtime !== display.runtime ||
        row.imageUrl !== display.imageUrl ||
        row.airDate !== display.airDate
      ) {
        await ctx.db.patch(row._id, display);
        result.patched += 1;
      }
    }
    current =
      saved.length > page.length
        ? {
            season: current.season,
            chunkIndex: current.chunkIndex,
            afterEpisode: page[page.length - 1]!.episode,
          }
        : { season: current.season, chunkIndex: current.chunkIndex + 1 };
  }

  if (!current) return finishRepair(ctx, repair, result);
  await ctx.db.patch(repair._id, {
    season: current.season,
    chunkIndex: current.chunkIndex,
    afterEpisode: current.afterEpisode,
  });
  await ctx.scheduler.runAfter(
    0,
    internal.episodeProjectionRepair.continueEpisodeProjectionRepair,
    {
      itemId: item._id,
      token: repair.token,
      ...current,
    },
  );
  return { state: 'continued', ...result };
}

export const startEpisodeProjectionRepair = internalMutation({
  args: { itemId: v.id('items') },
  returns: repairResultValidator,
  handler: async (ctx, args): Promise<RepairResult> => {
    const item = await ctx.db.get(args.itemId);
    if (!item || item.mediaType !== 'tv' || item.deletingAt !== undefined)
      return { state: 'skipped', rowsRead: 0, patched: 0, chunkPairsRead: 0 };
    const context = await repairContext(ctx, item);
    const first = context?.seasons[0];
    const existing = await activeRepair(ctx, item._id);
    if (!first) {
      if (existing) await ctx.db.delete(existing._id);
      return { state: 'completed', rowsRead: 0, patched: 0, chunkPairsRead: 0 };
    }
    const token = `episode-projection:${Date.now()}:${crypto.randomUUID()}`;
    const cursor = { season: first.season, chunkIndex: 0 };
    const value = { itemId: item._id, token, ...cursor };
    const repairId = existing
      ? (await ctx.db.replace(existing._id, value), existing._id)
      : await ctx.db.insert('episodeProjectionRepairs', value);
    const repair = (await ctx.db.get(repairId))!;
    return continueRepairPage(ctx, item, repair, cursor);
  },
});

export const continueEpisodeProjectionRepair = internalMutation({
  args: {
    itemId: v.id('items'),
    token: v.string(),
    season: v.number(),
    chunkIndex: v.number(),
    afterEpisode: v.optional(v.number()),
  },
  returns: repairResultValidator,
  handler: async (ctx, args): Promise<RepairResult> => {
    const [item, repair] = await Promise.all([
      ctx.db.get(args.itemId),
      activeRepair(ctx, args.itemId),
    ]);
    if (
      !item ||
      item.mediaType !== 'tv' ||
      item.deletingAt !== undefined ||
      !repair ||
      repair.token !== args.token ||
      repair.season !== args.season ||
      repair.chunkIndex !== args.chunkIndex ||
      repair.afterEpisode !== args.afterEpisode
    )
      return { state: 'superseded', rowsRead: 0, patched: 0, chunkPairsRead: 0 };
    return continueRepairPage(ctx, item, repair, args);
  },
});
