import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';

type ItemStatus = 'watched' | 'watching' | 'watchlist' | 'dropped';

export async function rankAtEnd(ctx: MutationCtx, userId: Id<'users'>, status: ItemStatus) {
  const last = await ctx.db
    .query('items')
    .withIndex('by_user_status_active', (q) =>
      q.eq('userId', userId).eq('status', status).eq('deletingAt', undefined),
    )
    .order('desc')
    .first();
  return (last?.rank ?? 0) + 1;
}
