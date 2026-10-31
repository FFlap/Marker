import type { Doc, Id } from './_generated/dataModel';
import { internalMutation, type MutationCtx } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';

export type ActivityEventWrite = {
  userId: Id<'users'>;
  kind: Doc<'activityEvents'>['kind'];
  itemId: Id<'items'>;
  title: string;
  posterPath?: string;
  season?: number;
  episode?: number;
  rating?: number;
  status?: Doc<'items'>['status'];
  createdAt?: number;
};

const HISTORY_LIMIT = 200;
const MAX_WRITE_BATCH = 120;

export async function writeActivityEvents(ctx: MutationCtx, events: ActivityEventWrite[]) {
  if (events.length === 0) return;
  if (events.length > MAX_WRITE_BATCH) throw new Error('Too many activity events in one write');
  const userId = events[0]!.userId;
  if (events.some((event) => event.userId !== userId))
    throw new Error('Activity event batches must have one actor');
  const now = Date.now();
  for (const [index, event] of events.entries()) {
    const { createdAt = now + index / 1_000, ...value } = event;
    await ctx.db.insert('activityEvents', { ...value, createdAt });
  }
  const counter = await ctx.db
    .query('activityEventCounts')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .unique();
  if (!counter) return bootstrapActivityHistory(ctx, userId);
  const count = counter.count + events.length;
  if (count > HISTORY_LIMIT) {
    const stale = await ctx.db
      .query('activityEvents')
      .withIndex('by_actor_time', (q) => q.eq('userId', userId))
      .order('asc')
      .take(count - HISTORY_LIMIT);
    for (const event of stale) await ctx.db.delete(event._id);
  }
  const retainedCount = Math.min(count, HISTORY_LIMIT);
  if (retainedCount !== counter.count) await ctx.db.patch(counter._id, { count: retainedCount });
}

export const itemActivityBase = (item: Doc<'items'>) => ({
  userId: item.userId,
  itemId: item._id,
  title: item.title,
  ...(item.posterPath !== undefined && { posterPath: item.posterPath }),
});

/** Only install a counter once every legacy row is accounted for. */
async function bootstrapActivityHistory(ctx: MutationCtx, userId: Id<'users'>) {
  const batchSize = HISTORY_LIMIT + MAX_WRITE_BATCH + 1;
  const retained = await ctx.db
    .query('activityEvents')
    .withIndex('by_actor_time', (q) => q.eq('userId', userId))
    .order('desc')
    .take(batchSize);
  for (const stale of retained.slice(HISTORY_LIMIT)) await ctx.db.delete(stale._id);
  if (retained.length === batchSize) {
    // A full batch may hide older rows. Continue even if no further user writes arrive.
    await ctx.scheduler.runAfter(0, internal.activityEvents.pruneLegacyHistory, { userId });
  } else {
    await ctx.db.insert('activityEventCounts', {
      userId,
      count: Math.min(retained.length, HISTORY_LIMIT),
    });
  }
}

export const pruneLegacyHistory = internalMutation({
  args: { userId: v.id('users') },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const counter = await ctx.db
      .query('activityEventCounts')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .unique();
    if (!counter) await bootstrapActivityHistory(ctx, userId);
    return null;
  },
});
