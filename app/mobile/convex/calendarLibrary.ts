import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import { query, type MutationCtx } from './_generated/server';
import { requireUser } from './clerkAuth';

/** Changes only when the library projection used by the calendar changes. */
export const revision = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const user = await ctx.db.get(userId);
    return user?.calendarRevision ?? 0;
  },
});

export async function bumpCalendarRevision(ctx: MutationCtx, userId: Id<'users'>) {
  const user = await ctx.db.get(userId);
  if (!user) throw new Error('User not found');
  await ctx.db.patch(userId, { calendarRevision: (user.calendarRevision ?? 0) + 1 });
}
