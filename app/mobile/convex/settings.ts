import { getClerkUserId } from './clerkAuth';
import { mutation, query } from './_generated/server';
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
};
async function user(ctx: Parameters<typeof getClerkUserId>[0]) {
  const id = await getClerkUserId(ctx);
  if (!id) throw new Error('Authentication required');
  return id;
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
  }),
  handler: async (ctx) => {
    const userId = await user(ctx);
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await user(ctx);
    const old = await ctx.db
      .query('settings')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .unique();
    if (old) await ctx.db.patch(old._id, args);
    else await ctx.db.insert('settings', { userId, ...defaults, ...args });
  },
});
