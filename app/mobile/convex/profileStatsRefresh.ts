import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { internalMutation, type MutationCtx } from './_generated/server';

const BATCH_SIZE = 100;
const MAX_DISTINCT_TAGS = 1_000;
const ABANDONED_AFTER_MS = 5 * 60 * 1_000;

const addTags = (
  existing: { tag: string; count: number }[],
  additions: { tag: string; count: number }[],
) => {
  const counts = new Map(
    existing.map(({ tag, count }) => [tag.toLocaleLowerCase(), { tag, count }]),
  );
  for (const { tag, count } of additions) {
    const key = tag.toLocaleLowerCase();
    const current = counts.get(key);
    if (current || counts.size < MAX_DISTINCT_TAGS)
      counts.set(key, { tag: current?.tag ?? tag, count: (current?.count ?? 0) + count });
  }
  return [...counts.values()];
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
    restartRequested: false,
    lastProgressAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.profileStatsRefresh.processBatch, { refreshId });
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
      await ctx.db.patch(refreshId, {
        totalWatchMinutes,
        moviesWatched,
        showsWatched,
        totalItems,
        ratingTotal,
        ratingCount,
        tagCounts: addTags(refresh.tagCounts, tags),
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
    for (const summary of page.page) {
      const item = await ctx.db.get(summary.itemId);
      if (!item || item.deletingAt !== undefined) continue;
      episodesWatched += summary.watchedCount;
      totalWatchMinutes +=
        summary.watchedRuntimeMinutes + summary.watchedRuntimeFallbackCount * (item.runtime ?? 30);
      tags.push(...summary.tagCounts);
    }
    const tagCounts = addTags(refresh.tagCounts, tags);
    if (!page.isDone) {
      await ctx.db.patch(refreshId, {
        totalWatchMinutes,
        episodesWatched,
        tagCounts,
        cursor: page.continueCursor,
        lastProgressAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.profileStatsRefresh.processBatch, { refreshId });
      return null;
    }
    const topTags = tagCounts
      .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag))
      .slice(0, 5);
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
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert('profileStats', value);
    const restart = refresh.restartRequested;
    const userId = refresh.userId;
    await ctx.db.delete(refreshId);
    if (restart) await ctx.scheduler.runAfter(0, internal.profileStatsRefresh.start, { userId });
    return null;
  },
});
