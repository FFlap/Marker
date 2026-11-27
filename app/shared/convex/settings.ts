import { requireUser } from './clerkAuth';
import { internal } from './_generated/api';
import { mutation, query, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { v } from 'convex/values';
const view = v.union(v.literal('list'), v.literal('posters'));
const gridColumns = v.union(v.literal(3), v.literal(4), v.literal(5));
const listTextSize = v.union(v.literal('small'), v.literal('medium'), v.literal('large'));
const listColumns = v.union(v.literal(1), v.literal(2));
const defaults = {
  defaultView: 'list' as const,
  gridColumns: 3 as const,
  listTextSize: 'medium' as const,
  listColumns: 1 as const,
  activityRatings: true,
  activityWatching: true,
  activityWatched: true,
  confirmWatchedMove: true,
  /** Watched shows with a new episode out are also listed under Watching. */
  airingInWatching: true,
};

/** Whether watched shows join Watching automatically when a new episode airs. */
export async function airingInWatchingFor(ctx: QueryCtx, userId: Id<'users'>) {
  const stored = await ctx.db
    .query('settings')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .unique();
  return stored?.airingInWatching ?? defaults.airingInWatching;
}
/** Whether a show's next episode has aired by `today` (a local YYYY-MM-DD date). */
export function newEpisodeOut(item: Pick<Doc<'items'>, 'nextEpisode'>, today: string) {
  const next = item.nextEpisode;
  if (!next) return false;
  return next.airDate !== undefined ? next.airDate <= today : next.undatedReleased === true;
}

/**
 * Shows in `status` whose next episode has aired by `today`, read from the release-date
 * indexes so movies, caught-up shows and the size of the library never use up the limit.
 */
export async function showsWithNewEpisode(
  ctx: QueryCtx,
  userId: Id<'users'>,
  status: 'watching' | 'watched',
  today: string,
  limit: number,
) {
  const [dated, undated] = await Promise.all([
    ctx.db
      .query('items')
      .withIndex('by_user_status_tv_air_date', (q) =>
        q
          .eq('userId', userId)
          .eq('status', status)
          .eq('mediaType', 'tv')
          .gt('nextEpisode.airDate', '')
          .lte('nextEpisode.airDate', today),
      )
      .order('desc')
      .take(limit),
    ctx.db
      .query('items')
      .withIndex('by_user_status_tv_undated', (q) =>
        q
          .eq('userId', userId)
          .eq('status', status)
          .eq('mediaType', 'tv')
          .eq('nextEpisode.undatedReleased', true),
      )
      .take(limit),
  ]);
  return [...dated, ...undated];
}

/** Shows set by hand to also appear under Watching. */
export async function handPickedAlsoWatching(ctx: QueryCtx, userId: Id<'users'>, limit: number) {
  const flagged = await ctx.db
    .query('items')
    .withIndex('by_user_also_watching', (q) => q.eq('userId', userId).eq('alsoWatching', true))
    .take(limit);
  return flagged.filter((item) => item.status === 'watched' && item.mediaType === 'tv');
}

export const getSettings = query({
  args: {},
  returns: v.object({
    _id: v.optional(v.id('settings')),
    _creationTime: v.optional(v.number()),
    userId: v.id('users'),
    defaultView: view,
    gridColumns,
    listTextSize,
    listColumns,
    activityRatings: v.boolean(),
    activityWatching: v.boolean(),
    activityWatched: v.boolean(),
    confirmWatchedMove: v.boolean(),
    airingInWatching: v.boolean(),
  }),
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const stored = await ctx.db
      .query('settings')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .unique();
    return { userId, ...defaults, ...stored };
  },
});
export const setSettings = mutation({
  args: {
    defaultView: v.optional(view),
    gridColumns: v.optional(gridColumns),
    listTextSize: v.optional(listTextSize),
    listColumns: v.optional(listColumns),
    activityRatings: v.optional(v.boolean()),
    activityWatching: v.optional(v.boolean()),
    activityWatched: v.optional(v.boolean()),
    confirmWatchedMove: v.optional(v.boolean()),
    airingInWatching: v.optional(v.boolean()),
    /** The client's local date, used when switching airing shows to manual. */
    today: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { today, ...args }) => {
    const userId = await requireUser(ctx);
    const old = await ctx.db
      .query('settings')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .unique();
    const wasAutomatic = old?.airingInWatching ?? defaults.airingInWatching;
    if (old) await ctx.db.patch(old._id, args);
    else await ctx.db.insert('settings', { userId, ...defaults, ...args });
    // Manual mode starts from what Watching showed: shows with a new episode out stay there,
    // and earlier hand-set choices no longer apply.
    if (wasAutomatic && args.airingInWatching === false) {
      const date = today ?? new Date().toISOString().slice(0, 10);
      const [airing, flagged] = await Promise.all([
        showsWithNewEpisode(ctx, userId, 'watched', date, 1000),
        ctx.db
          .query('items')
          .withIndex('by_user_also_watching', (q) =>
            q.eq('userId', userId).eq('alsoWatching', true),
          )
          .take(1000),
      ]);
      const airingIds = new Set(airing.map((show) => show._id));
      for (const show of flagged)
        if (!airingIds.has(show._id)) await ctx.db.patch(show._id, { alsoWatching: undefined });
      for (const show of airing)
        if (!show.alsoWatching) await ctx.db.patch(show._id, { alsoWatching: true });
    } else if (!wasAutomatic && args.airingInWatching === true) {
      // Watched shows were not checked for new episodes while this was off.
      await ctx.scheduler.runAfter(0, internal.episodeHub.continueWatchingRefresh, {
        userId,
        cursor: null,
        status: 'watched',
      });
    }
  },
});
