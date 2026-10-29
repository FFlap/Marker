import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';

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
  const counter = await ctx.db
    .query('activityEventCounts')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .unique();
  let previousCount = counter?.count;
  if (previousCount === undefined) {
    const history = await ctx.db
      .query('activityEvents')
      .withIndex('by_actor_time', (q) => q.eq('userId', userId))
      .take(HISTORY_LIMIT + 1);
    if (history.length > HISTORY_LIMIT) throw new Error('Activity history exceeds retention limit');
    previousCount = history.length;
  }
  const now = Date.now();
  for (const [index, event] of events.entries()) {
    const { createdAt = now + index / 1_000, ...value } = event;
    await ctx.db.insert('activityEvents', { ...value, createdAt });
  }
  const count = previousCount + events.length;
  if (count > HISTORY_LIMIT) {
    const stale = await ctx.db
      .query('activityEvents')
      .withIndex('by_actor_time', (q) => q.eq('userId', userId))
      .order('asc')
      .take(count - HISTORY_LIMIT);
    for (const event of stale) await ctx.db.delete(event._id);
  }
  const retainedCount = Math.min(count, HISTORY_LIMIT);
  if (!counter) await ctx.db.insert('activityEventCounts', { userId, count: retainedCount });
  else if (retainedCount !== counter.count)
    await ctx.db.patch(counter._id, { count: retainedCount });
}

export const itemActivityBase = (item: Doc<'items'>) => ({
  userId: item.userId,
  itemId: item._id,
  title: item.title,
  ...(item.posterPath !== undefined && { posterPath: item.posterPath }),
});
