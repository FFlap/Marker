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

/** Inserts semantic events and bounds the actor's retained history in one mutation. */
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
  const retained = await ctx.db
    .query('activityEvents')
    .withIndex('by_actor_time', (query) => query.eq('userId', userId))
    .order('desc')
    .take(HISTORY_LIMIT + MAX_WRITE_BATCH);
  for (const stale of retained.slice(HISTORY_LIMIT)) await ctx.db.delete(stale._id);
}

export const itemActivityBase = (item: Doc<'items'>) => ({
  userId: item.userId,
  itemId: item._id,
  title: item.title,
  ...(item.posterPath !== undefined && { posterPath: item.posterPath }),
});
