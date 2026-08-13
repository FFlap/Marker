import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, type MutationCtx } from './_generated/server';
import { EPISODES_PER_CHUNK } from './seasonStorage';
import { refreshNextEpisode } from './nextEpisode';

type EpisodeSummaryDelta = {
  userId: Id<'users'>;
  itemId: Id<'items'>;
  season: number;
  total: number;
  watchedCount: number;
  watchedRuntimeMinutes: number;
  watchedRuntimeFallbackCount: number;
  tagDeltas: { tag: string; count: number }[];
};

export type CurrentEpisodeIdentityDelta = {
  key: string;
  total: number;
  existingMatches: boolean;
  nextMatches: boolean;
};

const SUMMARY_RECONCILE_ITEM_BATCH_SIZE = 10;

export function seasonSummaryIdentityKey(
  season: Pick<Doc<'resolvedSeasons'>, 'metadataProvider' | 'orderEpoch'>,
  seasonOrder?: string,
) {
  return JSON.stringify([
    season.metadataProvider,
    season.metadataProvider === 'tvdb' ? seasonOrder : undefined,
    season.orderEpoch,
  ]);
}

export function episodeMatchesCanonicalIdentity(
  episode: Doc<'episodes'> | null | undefined,
  provider: 'tmdb' | 'tvdb',
  seasonOrder: string | undefined,
  canonicalProviderEpisodeId?: number,
) {
  if (!episode) return false;
  if (
    episode.metadataProvider !== provider ||
    episode.seasonOrder !== (provider === 'tvdb' ? seasonOrder : undefined)
  )
    return false;
  return (
    canonicalProviderEpisodeId === undefined ||
    episode.providerEpisodeId === canonicalProviderEpisodeId
  );
}

async function currentSummaryIdentity(
  ctx: Pick<MutationCtx, 'db'>,
  itemId: Id<'items'>,
  seasonNumber: number,
) {
  const item = await ctx.db.get(itemId);
  if (!item || item.deletingAt !== undefined || item.mediaType !== 'tv') return null;
  const [mapping, season] = await Promise.all([
    ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (query) => query.eq('mediaType', 'tv').eq('tmdbId', item.tmdbId))
      .unique(),
    ctx.db
      .query('resolvedSeasons')
      .withIndex('by_tmdb_season', (query) =>
        query.eq('tmdbId', item.tmdbId).eq('season', seasonNumber),
      )
      .unique(),
  ]);
  if (
    !mapping ||
    !season ||
    season.orderEpoch !== mapping.orderEpoch ||
    season.chunkCount === undefined ||
    season.seasonVersion === undefined ||
    season.chunksComplete !== true ||
    season.episodeCount === undefined ||
    (season.metadataProvider === 'tvdb' && mapping.seasonOrder === undefined)
  )
    return null;
  return {
    item,
    mapping,
    season,
    key: seasonSummaryIdentityKey(season, mapping.seasonOrder),
    episodeCount: season.episodeCount,
  };
}

async function canonicalEpisodeBatch(
  ctx: Pick<MutationCtx, 'db'>,
  season: Doc<'resolvedSeasons'>,
  offset: number,
) {
  if (
    season.chunkCount === undefined ||
    season.orderEpoch === undefined ||
    season.seasonVersion === undefined
  )
    return [];
  const chunkIndex = Math.floor(offset / EPISODES_PER_CHUNK);
  const chunk = await ctx.db
    .query('resolvedSeasonChunks')
    .withIndex('by_tmdb_season_version_chunk', (query) =>
      query
        .eq('tmdbId', season.tmdbId)
        .eq('season', season.season)
        .eq('seasonVersion', season.seasonVersion!)
        .eq('chunkIndex', chunkIndex),
    )
    .unique();
  if (!chunk) return [];
  const withinChunk = offset % EPISODES_PER_CHUNK;
  return chunk.episodes.slice(withinChunk, withinChunk + EPISODES_PER_CHUNK);
}

async function beginEpisodeSummaryRebuild(
  ctx: MutationCtx,
  summary: Doc<'episodeSummaries'>,
  identityKey: string,
  force = false,
  restart = false,
) {
  if (!force && summary.rebuildIdentityKey === identityKey) return false;
  const rebuildAttempts = restart ? (summary.rebuildAttempts ?? 0) + 1 : 0;
  if (rebuildAttempts > 3) {
    await ctx.db.patch(summary._id, {
      rebuildIdentityKey: undefined,
      rebuildOffset: undefined,
      rebuildTotal: undefined,
      rebuildWatchedCount: undefined,
      rebuildRevision: undefined,
      rebuildAttempts: undefined,
    });
    return false;
  }
  const revision = (summary.rebuildRevision ?? 0) + 1;
  await ctx.db.patch(summary._id, {
    rebuildIdentityKey: identityKey,
    rebuildOffset: 0,
    rebuildTotal: 0,
    rebuildWatchedCount: 0,
    rebuildRevision: revision,
    rebuildAttempts,
  });
  await ctx.scheduler.runAfter(0, internal.episodeSummaries.rebuildEpisodeSummary, {
    summaryId: summary._id,
    revision,
  });
  return true;
}

/** Applies one aggregate delta without reading any other episode rows. */
export async function applyEpisodeSummaryDelta(ctx: MutationCtx, delta: EpisodeSummaryDelta) {
  if (
    delta.total === 0 &&
    delta.watchedCount === 0 &&
    delta.watchedRuntimeMinutes === 0 &&
    delta.watchedRuntimeFallbackCount === 0 &&
    delta.tagDeltas.length === 0
  )
    return;
  const summary = await ctx.db
    .query('episodeSummaries')
    .withIndex('by_item', (query) => query.eq('itemId', delta.itemId).eq('season', delta.season))
    .unique();
  const total = (summary?.total ?? 0) + delta.total;
  const watchedCount = (summary?.watchedCount ?? 0) + delta.watchedCount;
  const watchedRuntimeMinutes = (summary?.watchedRuntimeMinutes ?? 0) + delta.watchedRuntimeMinutes;
  const watchedRuntimeFallbackCount =
    (summary?.watchedRuntimeFallbackCount ?? 0) + delta.watchedRuntimeFallbackCount;
  const tagCounts = new Map(
    (summary?.tagCounts ?? []).map(({ tag, count }) => [tag.toLocaleLowerCase(), { tag, count }]),
  );
  for (const { tag, count } of delta.tagDeltas) {
    const key = tag.toLocaleLowerCase();
    const current = tagCounts.get(key);
    const nextCount = (current?.count ?? 0) + count;
    if (nextCount < 0) throw new Error('Episode summary tag counters would become invalid');
    if (nextCount === 0) tagCounts.delete(key);
    else tagCounts.set(key, { tag: current?.tag ?? tag, count: nextCount });
  }
  if (tagCounts.size > 200) throw new Error('A season is limited to 200 distinct episode tags');
  if (
    total < 0 ||
    watchedCount < 0 ||
    watchedCount > total ||
    watchedRuntimeMinutes < 0 ||
    watchedRuntimeFallbackCount < 0
  )
    throw new Error('Episode summary counters would become invalid');
  if (summary) {
    if (total === 0) await ctx.db.delete(summary._id);
    else
      await ctx.db.patch(summary._id, {
        total,
        watchedCount,
        watchedRuntimeMinutes,
        watchedRuntimeFallbackCount,
        tagCounts: [...tagCounts.values()],
      });
    return;
  }
  if (total === 0) return;
  await ctx.db.insert('episodeSummaries', {
    userId: delta.userId,
    itemId: delta.itemId,
    season: delta.season,
    total,
    watchedCount,
    watchedRuntimeMinutes,
    watchedRuntimeFallbackCount,
    tagCounts: [...tagCounts.values()],
  });
}

const runtimeContribution = (episode: {
  watched: boolean;
  runtime?: number;
  unverified?: boolean;
}) => ({
  minutes: episode.watched && !episode.unverified ? (episode.runtime ?? 0) : 0,
  fallback: Number(episode.watched && !episode.unverified && episode.runtime === undefined),
});

const tagDelta = (before: string[], after: string[]) => {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const [tags, direction] of [
    [before, -1],
    [after, 1],
  ] as const)
    for (const tag of tags) {
      const key = tag.toLocaleLowerCase();
      const current = counts.get(key);
      counts.set(key, { tag: current?.tag ?? tag, count: (current?.count ?? 0) + direction });
    }
  return [...counts.values()].filter(({ count }) => count !== 0);
};

/** Accounts for an episode upsert in the matching season summary. */
export async function updateSummaryForEpisodeUpsert(
  ctx: MutationCtx,
  userId: Id<'users'>,
  itemId: Id<'items'>,
  season: number,
  watched: boolean,
  existing?: Doc<'episodes'> | null,
  identity?: CurrentEpisodeIdentityDelta,
  next?: { runtime?: number; unverified?: boolean; tags?: string[] },
) {
  const before = await ctx.db
    .query('episodeSummaries')
    .withIndex('by_item', (query) => query.eq('itemId', itemId).eq('season', season))
    .unique();
  const existingCounted = existing !== undefined && existing !== null;
  const beforeRuntime = runtimeContribution({
    watched: existing?.watched ?? false,
    runtime: existing?.runtime,
    unverified: existing?.unverified,
  });
  const afterRuntime = runtimeContribution({
    watched,
    runtime: next?.runtime ?? existing?.runtime,
    unverified: next?.unverified ?? existing?.unverified,
  });
  await applyEpisodeSummaryDelta(ctx, {
    userId,
    itemId,
    season,
    total: existingCounted ? 0 : 1,
    watchedCount: Number(watched) - (existingCounted ? Number(existing.watched) : 0),
    watchedRuntimeMinutes: afterRuntime.minutes - beforeRuntime.minutes,
    watchedRuntimeFallbackCount: afterRuntime.fallback - beforeRuntime.fallback,
    tagDeltas: tagDelta(existing?.tags ?? [], next?.tags ?? existing?.tags ?? []),
  });
  const summary = await ctx.db
    .query('episodeSummaries')
    .withIndex('by_item', (query) => query.eq('itemId', itemId).eq('season', season))
    .unique();
  if (!summary || !identity) return;

  if (!before) {
    await ctx.db.patch(summary._id, {
      currentIdentityKey: identity.key,
      currentTotal: identity.total,
      currentWatchedCount: Number(identity.nextMatches && watched),
    });
    return;
  }

  const sameIdentity = summary.currentIdentityKey === identity.key;
  if (!sameIdentity) {
    await beginEpisodeSummaryRebuild(ctx, summary, identity.key, true);
    return;
  }

  const currentTotal = identity.total;
  const currentWatchedCount =
    (summary.currentWatchedCount ?? 0) +
    Number(Boolean(identity.nextMatches && watched)) -
    Number(Boolean(identity.existingMatches && existing?.watched));
  if (currentTotal < 0 || currentWatchedCount < 0 || currentWatchedCount > currentTotal)
    throw new Error('Current episode summary counters would become invalid');
  await ctx.db.patch(summary._id, { currentTotal, currentWatchedCount });
  if (summary.rebuildIdentityKey !== undefined)
    await beginEpisodeSummaryRebuild(ctx, summary, summary.rebuildIdentityKey, true);
}

export const rebuildEpisodeSummary = internalMutation({
  args: { summaryId: v.id('episodeSummaries'), revision: v.number() },
  handler: async (ctx, args) => {
    const summary = await ctx.db.get(args.summaryId);
    if (!summary || summary.rebuildIdentityKey === undefined) return { work: 0, isDone: true };
    if (summary.rebuildRevision !== args.revision) return { work: 0, isDone: true };
    const identity = await currentSummaryIdentity(ctx, summary.itemId, summary.season);
    if (!identity) {
      await ctx.db.patch(summary._id, {
        rebuildIdentityKey: undefined,
        rebuildOffset: undefined,
        rebuildTotal: undefined,
        rebuildWatchedCount: undefined,
        rebuildRevision: undefined,
        rebuildAttempts: undefined,
      });
      return { work: 0, isDone: true };
    }
    if (identity.key !== summary.rebuildIdentityKey) {
      await beginEpisodeSummaryRebuild(ctx, summary, identity.key, true, true);
      return { work: 0, isDone: false };
    }

    const offset = summary.rebuildOffset ?? 0;
    const batch = await canonicalEpisodeBatch(ctx, identity.season, offset);
    if (offset < identity.episodeCount && batch.length === 0) {
      await beginEpisodeSummaryRebuild(ctx, summary, identity.key, true, true);
      return { work: 0, isDone: false };
    }
    const saved = await Promise.all(
      batch.map((episode) =>
        ctx.db
          .query('episodes')
          .withIndex('by_item', (query) =>
            query
              .eq('itemId', summary.itemId)
              .eq('season', summary.season)
              .eq('episode', episode.episode),
          )
          .unique(),
      ),
    );
    let total = summary.rebuildTotal ?? 0;
    let watchedCount = summary.rebuildWatchedCount ?? 0;
    for (const [index, episode] of batch.entries()) {
      const row = saved[index];
      if (
        !episodeMatchesCanonicalIdentity(
          row,
          identity.season.metadataProvider,
          identity.mapping.seasonOrder,
          episode.providerEpisodeId,
        )
      )
        continue;
      total += 1;
      watchedCount += Number(row!.watched);
    }
    const nextOffset = offset + batch.length;
    if (nextOffset >= identity.episodeCount) {
      await ctx.db.patch(summary._id, {
        currentIdentityKey: identity.key,
        currentTotal: identity.episodeCount,
        currentWatchedCount: watchedCount,
        rebuildIdentityKey: undefined,
        rebuildOffset: undefined,
        rebuildTotal: undefined,
        rebuildWatchedCount: undefined,
        rebuildRevision: undefined,
        rebuildAttempts: undefined,
      });
      await refreshNextEpisode(ctx, summary.itemId);
      return { work: batch.length, isDone: true };
    }
    await ctx.db.patch(summary._id, {
      rebuildOffset: nextOffset,
      rebuildTotal: total,
      rebuildWatchedCount: watchedCount,
    });
    await ctx.scheduler.runAfter(0, internal.episodeSummaries.rebuildEpisodeSummary, args);
    return { work: batch.length, isDone: false };
  },
});

/** Fans a published canonical season out to affected personal summaries in bounded pages. */
export const reconcileSeasonSummaries = internalMutation({
  args: { tmdbId: v.number(), season: v.number(), cursor: v.optional(v.string()) },
  returns: v.object({ work: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query('items')
      .withIndex('by_media_tmdb', (query) => query.eq('mediaType', 'tv').eq('tmdbId', args.tmdbId))
      .paginate({ cursor: args.cursor ?? null, numItems: SUMMARY_RECONCILE_ITEM_BATCH_SIZE });
    let work = 0;
    for (const item of page.page) {
      if (item.deletingAt !== undefined) continue;
      await ctx.scheduler.runAfter(0, internal.nextEpisode.startNextEpisodeRefresh, {
        itemId: item._id,
      });
      await ctx.scheduler.runAfter(
        0,
        internal.episodeProjectionRepair.startEpisodeProjectionRepair,
        { itemId: item._id },
      );
      const summary = await ctx.db
        .query('episodeSummaries')
        .withIndex('by_item', (query) => query.eq('itemId', item._id).eq('season', args.season))
        .unique();
      const identity = await currentSummaryIdentity(ctx, item._id, args.season);
      if (!identity) continue;
      if (!summary) {
        await ctx.db.insert('episodeSummaries', {
          userId: item.userId,
          itemId: item._id,
          season: args.season,
          total: 0,
          watchedCount: 0,
          watchedRuntimeMinutes: 0,
          watchedRuntimeFallbackCount: 0,
          tagCounts: [],
          currentIdentityKey: identity.key,
          currentTotal: identity.episodeCount,
          currentWatchedCount: 0,
        });
        work += 1;
      } else if (summary.rebuildIdentityKey !== identity.key) {
        if (await beginEpisodeSummaryRebuild(ctx, summary, identity.key, true)) work += 1;
      }
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.episodeSummaries.reconcileSeasonSummaries, {
        ...args,
        cursor: page.continueCursor,
      });
    return { work, isDone: page.isDone };
  },
});
