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

export const consumeThrottle = internalMutation({
  args: { key: v.string() },
  returns: v.boolean(),
  handler: (ctx, { key }) => consumeWindowBudget(ctx, key, 60, 60_000),
});

export const consumeGlobalProviderLimiter = internalMutation({
  args: { provider: v.union(v.literal('tmdb'), v.literal('tvdb')), amount: v.optional(v.number()) },
  returns: v.boolean(),
  handler: (ctx, { provider, amount = 1 }) => {
    if (!Number.isInteger(amount) || amount < 1 || amount > 10)
      throw new Error('Invalid provider budget reservation');
    return consumeWindowBudget(ctx, provider + '-global', 300, 60_000, amount);
  },
});

/** Small prepaid batches for a single action's parallel provider work. */
export const reserveProviderBudget = internalMutation({
  args: { provider: v.union(v.literal('tmdb'), v.literal('tvdb')) },
  returns: v.union(v.null(), v.object({ amount: v.number(), expiresAt: v.number() })),
  handler: async (ctx, { provider }) => {
    const key = provider + '-global';
    let amount = 8;
    if (!(await consumeWindowBudget(ctx, key, 300, 60_000, amount))) {
      amount = 1;
      if (!(await consumeWindowBudget(ctx, key, 300, 60_000, amount))) return null;
    }
    const row = await ctx.db
      .query('requestThrottle')
      .withIndex('by_key', (q) => q.eq('key', key))
      .unique();
    return { amount, expiresAt: row!.windowStart + 60_000 };
  },
});
