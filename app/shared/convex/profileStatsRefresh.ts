import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { internalMutation, type MutationCtx } from './_generated/server';

const BATCH_SIZE = 100;
const MAX_DISTINCT_TAGS = 1_000;
const REFRESH_DELAY_MS = 1_000;
const ABANDONED_AFTER_MS = 5 * 60 * 1_000;

const addTags = (
  existing: { tag: string; count: number }[],
  additions: { tag: string; count: number }[],
) => {
  const counts = new Map(
    existing.map(({ tag, count }) => [tag.toLocaleLowerCase(), { tag, count }]),
  );
  let complete = true;
  for (const { tag, count } of additions) {
    const key = tag.toLocaleLowerCase();
    const current = counts.get(key);
    const nextCount = (current?.count ?? 0) + count;
    if (nextCount < 0) complete = false;
    if (nextCount <= 0) counts.delete(key);
    else if (current || counts.size < MAX_DISTINCT_TAGS)
      counts.set(key, { tag: current?.tag ?? tag, count: nextCount });
    else complete = false;
  }
  return { tagCounts: [...counts.values()], complete };
};

export async function requestProfileStatsRefresh(ctx: MutationCtx, userId: Id<'users'>) {
  const existing = await ctx.db
    .query('profileStatsRefreshes')
    .withIndex('by_user', (query) => query.eq('userId', userId))
    .unique();
  if (existing) {
    const now = Date.now();
    const abandoned =
      existing.lastProgressAt === undefined || now - existing.lastProgressAt > ABANDONED_AFTER_MS;
    // Changes before the first batch are already included in its snapshot.
    if (abandoned || (existing.hasStarted !== false && !existing.restartRequested))
      await ctx.db.patch(existing._id, {
        restartRequested: true,
        ...(abandoned && { lastProgressAt: now }),
      });
    if (abandoned)
      await ctx.scheduler.runAfter(0, internal.profileStatsRefresh.processBatch, {
        refreshId: existing._id,
      });
    return;
  }
  const now = Date.now();
  const refreshId = await ctx.db.insert('profileStatsRefreshes', {
    userId,
    phase: 'items',
    totalWatchMinutes: 0,
    episodesWatched: 0,
    moviesWatched: 0,
    showsWatched: 0,
    totalItems: 0,
    ratingTotal: 0,
    ratingCount: 0,
    tagCounts: [],
    tagCountsComplete: true,
    hasStarted: false,
    restartRequested: false,
    lastProgressAt: now,
  });
  await ctx.scheduler.runAfter(REFRESH_DELAY_MS, internal.profileStatsRefresh.processBatch, {
    refreshId,
  });
}

export const start = internalMutation({
  args: { userId: v.id('users') },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    await requestProfileStatsRefresh(ctx, userId);
    return null;
  },
});

export const processBatch = internalMutation({
  args: { refreshId: v.id('profileStatsRefreshes') },
  returns: v.null(),
  handler: async (ctx, { refreshId }) => {
    const refresh = await ctx.db.get(refreshId);
    if (!refresh) return null;
    if (refresh.phase === 'items') {
      const page = await ctx.db
        .query('items')
        .withIndex('by_user', (query) => query.eq('userId', refresh.userId))
        .paginate({ cursor: refresh.cursor ?? null, numItems: BATCH_SIZE });
      let totalWatchMinutes = refresh.totalWatchMinutes;
      let moviesWatched = refresh.moviesWatched;
      let showsWatched = refresh.showsWatched;
      let totalItems = refresh.totalItems;
      let ratingTotal = refresh.ratingTotal;
      let ratingCount = refresh.ratingCount;
      const tags: { tag: string; count: number }[] = [];
      for (const item of page.page) {
        if (item.deletingAt !== undefined) continue;
        totalItems += 1;
        if (item.mediaType === 'movie' && item.status === 'watched') {
          moviesWatched += 1;
          totalWatchMinutes += (item.runtime ?? 0) * item.timesWatched;
        } else if (item.mediaType === 'tv' && item.status === 'watched') showsWatched += 1;
        if (item.rating !== undefined) {
          ratingTotal += item.rating;
          ratingCount += 1;
        }
        tags.push(...item.tags.map((tag) => ({ tag, count: 1 })));
      }
      const combined = addTags(refresh.tagCounts, tags);
      await ctx.db.patch(refreshId, {
        hasStarted: true,
        totalWatchMinutes,
        moviesWatched,
        showsWatched,
        totalItems,
        ratingTotal,
        ratingCount,
        tagCounts: combined.tagCounts,
        tagCountsComplete: refresh.tagCountsComplete === true && combined.complete,
        phase: page.isDone ? 'summaries' : 'items',
        cursor: page.isDone ? undefined : page.continueCursor,
        lastProgressAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.profileStatsRefresh.processBatch, { refreshId });
      return null;
    }

    const page = await ctx.db
      .query('episodeSummaries')
      .withIndex('by_user', (query) => query.eq('userId', refresh.userId))
      .paginate({ cursor: refresh.cursor ?? null, numItems: BATCH_SIZE });
    let totalWatchMinutes = refresh.totalWatchMinutes;
    let episodesWatched = refresh.episodesWatched;
    const tags: { tag: string; count: number }[] = [];
    const items = new Map<Id<'items'>, Doc<'items'> | null>();
    for (const summary of page.page) {
      if (!items.has(summary.itemId)) items.set(summary.itemId, await ctx.db.get(summary.itemId));
      const item = items.get(summary.itemId);
      if (!item || item.deletingAt !== undefined) continue;
      episodesWatched += summary.watchedCount;
      totalWatchMinutes +=
        summary.watchedRuntimeMinutes + summary.watchedRuntimeFallbackCount * (item.runtime ?? 30);
      tags.push(...summary.tagCounts);
    }
    const combined = addTags(refresh.tagCounts, tags);
    const { tagCounts } = combined;
    const tagCountsComplete = refresh.tagCountsComplete === true && combined.complete;
    if (!page.isDone) {
      await ctx.db.patch(refreshId, {
        totalWatchMinutes,
        episodesWatched,
        tagCounts,
        tagCountsComplete,
        cursor: page.continueCursor,
        lastProgressAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.profileStatsRefresh.processBatch, { refreshId });
      return null;
    }
    if (refresh.restartRequested) {
      await ctx.db.delete(refreshId);
      await requestProfileStatsRefresh(ctx, refresh.userId);
      return null;
    }
    const topTags = topProfileTags(tagCounts);
    const existing = await ctx.db
      .query('profileStats')
      .withIndex('by_user', (query) => query.eq('userId', refresh.userId))
      .unique();
    const value = {
      userId: refresh.userId,
      totalWatchMinutes,
      episodesWatched,
      moviesWatched: refresh.moviesWatched,
      showsWatched: refresh.showsWatched,
      totalItems: refresh.totalItems,
      ratingTotal: refresh.ratingTotal,
      ratingCount: refresh.ratingCount,
      topTags,
      tagCounts: tagCountsComplete ? tagCounts : undefined,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert('profileStats', value);
    await ctx.db.delete(refreshId);
    return null;
  },
});

type ProfileStatsDelta = Partial<
  Pick<
    Doc<'profileStats'>,
    | 'totalWatchMinutes'
    | 'episodesWatched'
    | 'moviesWatched'
    | 'showsWatched'
    | 'totalItems'
    | 'ratingTotal'
    | 'ratingCount'
  >
> & { tagDeltas?: { tag: string; count: number }[] };

const topProfileTags = (tags: { tag: string; count: number }[]) =>
  [...tags].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)).slice(0, 5);

export async function applyProfileStatsDelta(
  ctx: MutationCtx,
  userId: Id<'users'>,
  delta: ProfileStatsDelta,
) {
  const { tagDeltas = [], ...counters } = delta;
  const changes = Object.entries(counters) as [keyof typeof counters, number][];
  if (!changes.some(([, value]) => value !== 0) && !tagDeltas.length) return;
  const refresh = await ctx.db
    .query('profileStatsRefreshes')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .unique();
  if (refresh) return requestProfileStatsRefresh(ctx, userId);
  const stats = await ctx.db
    .query('profileStats')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .unique();
  // Existing accounts initialize once. Oversized tag sets retain the bounded rebuild path.
  if (!stats || stats.tagCounts === undefined) return requestProfileStatsRefresh(ctx, userId);
  const tags = addTags(stats.tagCounts, tagDeltas);
  if (!tags.complete) return requestProfileStatsRefresh(ctx, userId);
  const patch: Partial<Doc<'profileStats'>> = { updatedAt: Date.now() };
  for (const [key, value] of changes) {
    const next = stats[key] + value;
    if (next < -0.000001) return requestProfileStatsRefresh(ctx, userId);
    patch[key] = Math.max(0, next);
  }
  if (tagDeltas.length) {
    patch.tagCounts = tags.tagCounts;
    patch.topTags = topProfileTags(tags.tagCounts);
  }
  await ctx.db.patch(stats._id, patch);
}

export async function updateProfileStatsForItem(
  ctx: MutationCtx,
  before: Doc<'items'> | null,
  after: Doc<'items'> | null,
) {
  const item = after ?? before;
  if (!item) return;
  const activeBefore = before?.deletingAt === undefined ? before : null;
  const activeAfter = after?.deletingAt === undefined ? after : null;
  const contribution = (row: Doc<'items'> | null) => ({
    totalItems: Number(row !== null),
    moviesWatched: Number(row?.mediaType === 'movie' && row.status === 'watched'),
    showsWatched: Number(row?.mediaType === 'tv' && row.status === 'watched'),
    totalWatchMinutes:
      row?.mediaType === 'movie' && row.status === 'watched'
        ? (row.runtime ?? 0) * row.timesWatched
        : 0,
    ratingTotal: row?.rating ?? 0,
    ratingCount: Number(row?.rating !== undefined),
  });
  const previous = contribution(activeBefore);
  const next = contribution(activeAfter);
  const delta: ProfileStatsDelta = {};
  for (const key of Object.keys(previous) as (keyof typeof previous)[])
    delta[key] = next[key] - previous[key];
  const tags = new Map<string, { tag: string; count: number }>();
  for (const [row, direction] of [
    [activeBefore, -1],
    [activeAfter, 1],
  ] as const)
    for (const tag of row?.tags ?? []) {
      const key = tag.toLocaleLowerCase();
      const current = tags.get(key);
      tags.set(key, { tag: current?.tag ?? tag, count: (current?.count ?? 0) + direction });
    }
  delta.tagDeltas = [...tags.values()].filter((t) => t.count !== 0);
  // Only removals and runtime corrections need this title's season summaries.
  if (activeBefore && (!activeAfter || activeBefore.runtime !== activeAfter.runtime)) {
    const summaries = await ctx.db
      .query('episodeSummaries')
      .withIndex('by_item', (q) => q.eq('itemId', item._id))
      .take(1_001);
    if (summaries.length > 1_000) return requestProfileStatsRefresh(ctx, item.userId);
    for (const summary of summaries) {
      if (!activeAfter) {
        delta.episodesWatched = (delta.episodesWatched ?? 0) - summary.watchedCount;
        delta.totalWatchMinutes! -=
          summary.watchedRuntimeMinutes +
          summary.watchedRuntimeFallbackCount * (activeBefore.runtime ?? 30);
        delta.tagDeltas.push(...summary.tagCounts.map((t) => ({ tag: t.tag, count: -t.count })));
      } else {
        delta.totalWatchMinutes! +=
          summary.watchedRuntimeFallbackCount *
          ((activeAfter.runtime ?? 30) - (activeBefore.runtime ?? 30));
      }
    }
  }
  await applyProfileStatsDelta(ctx, item.userId, delta);
}
