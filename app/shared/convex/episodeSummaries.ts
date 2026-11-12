import { summaryRebuildState } from './lifecycles';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, type MutationCtx } from './_generated/server';
import { EPISODES_PER_CHUNK } from './seasonStorage';
import { refreshNextEpisode } from './nextEpisode';
import { currentSeriesOverride } from './library/seriesWatchState';
import { applyProfileStatsDelta } from './profileStatsRefresh';

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

type CurrentEpisodeIdentityDelta = {
  key: string;
  seasonVersion: string;
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
    seasonVersion: season.seasonVersion,
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
  seasonVersion: string,
  force = false,
  restart = false,
) {
  const item = await ctx.db.get(summary.itemId);
  const seriesGeneration = item?.seriesWatch?.generation;
  if (
    !force &&
    summary.rebuildSeriesWatchGeneration === seriesGeneration &&
    summary.rebuildIdentityKey === identityKey &&
    summary.rebuildSeasonVersion === seasonVersion
  )
    return false;
  const rebuildAttempts = restart ? (summary.rebuildAttempts ?? 0) + 1 : 0;
  if (rebuildAttempts > 3) {
    await ctx.db.patch(summary._id, {
      rebuildIdentityKey: undefined,
      rebuildSeasonVersion: undefined,
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
    rebuildSeasonVersion: seasonVersion,
    rebuildOffset: 0,
    rebuildTotal: 0,
    rebuildWatchedCount: 0,
    rebuildSeriesUnwatchedCount: 0,
    rebuildSeriesWatchGeneration: seriesGeneration,
    rebuildRevision: revision,
    rebuildAttempts,
  });
  await ctx.scheduler.runAfter(0, internal.episodeSummaries.rebuildEpisodeSummary, {
    summaryId: summary._id,
    revision,
  });
  return true;
}

async function applyEpisodeSummaryDelta(ctx: MutationCtx, delta: EpisodeSummaryDelta) {
  if (
    delta.total === 0 &&
    delta.watchedCount === 0 &&
    delta.watchedRuntimeMinutes === 0 &&
    delta.watchedRuntimeFallbackCount === 0 &&
    delta.tagDeltas.length === 0
  )
    return;
  const item = await ctx.db.get(delta.itemId);
  if (item && item.deletingAt === undefined)
    await applyProfileStatsDelta(ctx, delta.userId, {
      episodesWatched: delta.watchedCount,
      totalWatchMinutes:
        delta.watchedRuntimeMinutes + delta.watchedRuntimeFallbackCount * (item.runtime ?? 30),
      tagDeltas: delta.tagDeltas,
    });
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

export async function updateSummaryForEpisodeUpsert(
  ctx: MutationCtx,
  userId: Id<'users'>,
  itemId: Id<'items'>,
  season: number,
  watched: boolean,
  existing?: Doc<'episodes'> | null,
  identity?: CurrentEpisodeIdentityDelta,
  next?: { runtime?: number; unverified?: boolean; tags?: string[] },
  series?: EpisodeSummaryUpsert['series'],
) {
  return updateSummaryForEpisodeUpserts(ctx, userId, itemId, season, [
    { watched, existing, identity, next, series },
  ]);
}

export type EpisodeSummaryUpsert = {
  series?: { generation: string; beforeUnwatched: boolean; afterUnwatched: boolean };
  watched: boolean;
  existing?: Doc<'episodes'> | null;
  identity?: CurrentEpisodeIdentityDelta;
  next?: { runtime?: number; unverified?: boolean; tags?: string[] };
};

/** Apply counters once per chunk rather than once per episode. */
export async function updateSummaryForEpisodeUpserts(
  ctx: MutationCtx,
  userId: Id<'users'>,
  itemId: Id<'items'>,
  season: number,
  upserts: EpisodeSummaryUpsert[],
) {
  if (upserts.length === 0) return;
  const before = await ctx.db
    .query('episodeSummaries')
    .withIndex('by_item', (query) => query.eq('itemId', itemId).eq('season', season))
    .unique();
  const delta: EpisodeSummaryDelta = {
    userId,
    itemId,
    season,
    total: 0,
    watchedCount: 0,
    watchedRuntimeMinutes: 0,
    watchedRuntimeFallbackCount: 0,
    tagDeltas: [],
  };
  const tags = new Map<string, { tag: string; count: number }>();
  const identity = upserts[0]!.identity;
  let currentWatchedDelta = 0;
  let newCurrentWatched = 0;
  for (const { watched, existing, identity: entryIdentity, next } of upserts) {
    if (
      entryIdentity?.key !== identity?.key ||
      entryIdentity?.seasonVersion !== identity?.seasonVersion ||
      entryIdentity?.total !== identity?.total
    )
      throw new Error('Episode summary batches must share one metadata identity');
    const beforeRuntime = runtimeContribution({
      watched: existing?.watched ?? false,
      runtime: existing?.runtime,
      unverified: existing?.unverified,
    });
    const afterRuntime = runtimeContribution({
      watched,
      runtime: next && 'runtime' in next ? next.runtime : existing?.runtime,
      unverified: next?.unverified ?? existing?.unverified,
    });
    delta.total += Number(!existing);
    delta.watchedCount += Number(watched) - Number(existing?.watched ?? false);
    delta.watchedRuntimeMinutes += afterRuntime.minutes - beforeRuntime.minutes;
    delta.watchedRuntimeFallbackCount += afterRuntime.fallback - beforeRuntime.fallback;
    for (const change of tagDelta(existing?.tags ?? [], next?.tags ?? existing?.tags ?? [])) {
      const key = change.tag.toLocaleLowerCase();
      const current = tags.get(key);
      tags.set(key, {
        tag: current?.tag ?? change.tag,
        count: (current?.count ?? 0) + change.count,
      });
    }
    newCurrentWatched += Number(Boolean(entryIdentity?.nextMatches && watched));
    currentWatchedDelta +=
      Number(Boolean(entryIdentity?.nextMatches && watched)) -
      Number(Boolean(entryIdentity?.existingMatches && existing?.watched));
  }
  delta.tagDeltas = [...tags.values()].filter((entry) => entry.count !== 0);
  await applyEpisodeSummaryDelta(ctx, delta);
  const summary = await ctx.db
    .query('episodeSummaries')
    .withIndex('by_item', (query) => query.eq('itemId', itemId).eq('season', season))
    .unique();
  if (summary && upserts[0]!.series) {
    const generation = upserts[0]!.series.generation;
    const delta = upserts.reduce(
      (sum, upsert) =>
        sum + Number(upsert.series?.afterUnwatched) - Number(upsert.series?.beforeUnwatched),
      0,
    );
    await ctx.db.patch(summary._id, {
      seriesWatchGeneration: generation,
      seriesUnwatchedCount: Math.max(
        0,
        (summary.seriesWatchGeneration === generation ? (summary.seriesUnwatchedCount ?? 0) : 0) +
          delta,
      ),
    });
  }
  if (!summary || !identity) return;
  if (!before) {
    await ctx.db.patch(summary._id, {
      currentIdentityKey: identity.key,
      currentSeasonVersion: identity.seasonVersion,
      currentTotal: identity.total,
      currentWatchedCount: newCurrentWatched,
    });
    return;
  }
  const sameIdentity =
    summary.currentIdentityKey === identity.key &&
    summary.currentSeasonVersion === identity.seasonVersion;
  if (!sameIdentity) {
    await beginEpisodeSummaryRebuild(ctx, summary, identity.key, identity.seasonVersion, true);
    return;
  }
  const currentTotal = identity.total;
  const currentWatchedCount = (summary.currentWatchedCount ?? 0) + currentWatchedDelta;
  if (currentTotal < 0 || currentWatchedCount < 0 || currentWatchedCount > currentTotal)
    throw new Error('Current episode summary counters would become invalid');
  await ctx.db.patch(summary._id, { currentTotal, currentWatchedCount });
  if (summary.rebuildIdentityKey !== undefined)
    await beginEpisodeSummaryRebuild(ctx, summary, identity.key, identity.seasonVersion, true);
}

export const rebuildEpisodeSummary = internalMutation({
  args: { summaryId: v.id('episodeSummaries'), revision: v.number() },
  handler: async (ctx, args) => {
    const summary = await ctx.db.get(args.summaryId);
    const rebuild = summaryRebuildState(summary, args.revision);
    if (!summary || rebuild.state !== 'rebuilding') return { work: 0, isDone: true };
    const identity = await currentSummaryIdentity(ctx, summary.itemId, summary.season);
    if (!identity) {
      await ctx.db.patch(summary._id, {
        rebuildIdentityKey: undefined,
        rebuildSeasonVersion: undefined,
        rebuildOffset: undefined,
        rebuildTotal: undefined,
        rebuildWatchedCount: undefined,
        rebuildRevision: undefined,
        rebuildAttempts: undefined,
      });
      return { work: 0, isDone: true };
    }
    if (
      identity.key !== summary.rebuildIdentityKey ||
      identity.seasonVersion !== summary.rebuildSeasonVersion ||
      identity.item.seriesWatch?.generation !== summary.rebuildSeriesWatchGeneration
    ) {
      await beginEpisodeSummaryRebuild(
        ctx,
        summary,
        identity.key,
        identity.seasonVersion,
        true,
        true,
      );
      return { work: 0, isDone: false };
    }

    const offset = rebuild.offset;
    const batch = await canonicalEpisodeBatch(ctx, identity.season, offset);
    if (offset < identity.episodeCount && batch.length === 0) {
      await beginEpisodeSummaryRebuild(
        ctx,
        summary,
        identity.key,
        identity.seasonVersion,
        true,
        true,
      );
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
    let seriesUnwatchedCount = summary.rebuildSeriesUnwatchedCount ?? 0;
    for (const [index, episode] of batch.entries()) {
      const row = saved[index];
      if (
        currentSeriesOverride(identity.item.seriesWatch, row, {
          metadataProvider: identity.season.metadataProvider,
          seasonOrder: identity.mapping.seasonOrder,
          providerEpisodeId: episode.providerEpisodeId,
        }) &&
        !row!.watched
      )
        seriesUnwatchedCount += 1;
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
        currentSeasonVersion: identity.seasonVersion,
        currentTotal: identity.episodeCount,
        currentWatchedCount: watchedCount,
        seriesWatchGeneration: identity.item.seriesWatch?.generation,
        seriesUnwatchedCount,
        rebuildSeriesWatchGeneration: undefined,
        rebuildSeriesUnwatchedCount: undefined,
        rebuildIdentityKey: undefined,
        rebuildSeasonVersion: undefined,
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
      rebuildSeriesUnwatchedCount: seriesUnwatchedCount,
    });
    await ctx.scheduler.runAfter(0, internal.episodeSummaries.rebuildEpisodeSummary, args);
    return { work: batch.length, isDone: false };
  },
});

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
        { itemId: item._id, season: args.season },
      );
      const summary = await ctx.db
        .query('episodeSummaries')
        .withIndex('by_item', (query) => query.eq('itemId', item._id).eq('season', args.season))
        .unique();
      const identity = await currentSummaryIdentity(ctx, item._id, args.season);
      if (!identity) continue;
      if (item.seriesWatch)
        await ctx.scheduler.runAfter(0, internal.library.seasonWatched.resumeSeriesWatch, {
          itemId: item._id,
          refreshedAt: identity.season.refreshedAt,
        });
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
          currentSeasonVersion: identity.seasonVersion,
          currentTotal: identity.episodeCount,
          currentWatchedCount: 0,
        });
        work += 1;
      } else if (
        (summary.currentIdentityKey !== identity.key ||
          summary.currentSeasonVersion !== identity.seasonVersion) &&
        (summary.rebuildIdentityKey !== identity.key ||
          summary.rebuildSeasonVersion !== identity.seasonVersion)
      ) {
        if (
          await beginEpisodeSummaryRebuild(ctx, summary, identity.key, identity.seasonVersion, true)
        )
          work += 1;
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
