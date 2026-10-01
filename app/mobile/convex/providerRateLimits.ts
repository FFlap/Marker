import { v } from 'convex/values';
import { internalMutation, type MutationCtx } from './_generated/server';

export async function consumeWindowBudget(
  ctx: MutationCtx,
  key: string,
  maximum: number,
  windowMs: number,
  amount = 1,
) {
  const now = Date.now();
  const row = await ctx.db
    .query('requestThrottle')
    .withIndex('by_key', (query) => query.eq('key', key))
    .unique();
  if (!row) {
    if (amount > maximum) return false;
    await ctx.db.insert('requestThrottle', { key, windowStart: now, count: amount });
    return true;
  }
  if (now - row.windowStart >= windowMs) {
    if (amount > maximum) return false;
    await ctx.db.patch(row._id, { windowStart: now, count: amount });
    return true;
  }
  if (row.count + amount > maximum) return false;
  await ctx.db.patch(row._id, { count: row.count + amount });
  return true;
}

/** User-facing provider actions share a bounded per-key request window. */
export const consumeThrottle = internalMutation({
  args: { key: v.string() },
  returns: v.boolean(),
  handler: (ctx, { key }) => consumeWindowBudget(ctx, key, 60, 60_000),
});

/** Each provider shares one budget across search, title, season, and calendar requests. */
export const consumeGlobalProviderLimiter = internalMutation({
  args: { provider: v.union(v.literal('tmdb'), v.literal('tvdb')) },
  returns: v.boolean(),
  handler: (ctx, { provider }) => consumeWindowBudget(ctx, provider + '-global', 300, 60_000),
});
