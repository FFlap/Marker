import type { Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { activityDayNumber, activityDateFromDayNumber } from './watchActivityStats';

// Bound profile reads to the latest 3,660 active days (at least ten years).
const MAX_ACTIVITY_DAYS = 3_660;
const DAY_MS = 86_400_000;

const validDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
};

/**
 * Resolves the viewer's local calendar day for an activity write. Local dates
 * can only differ from UTC by one day, so anything else falls back to UTC.
 */
export function resolveActivityDate(localDate: string | undefined, now = Date.now()) {
  const utcDay = Math.floor(now / DAY_MS);
  if (localDate !== undefined && validDate(localDate)) {
    const offset = activityDayNumber(localDate) - utcDay;
    if (offset >= -1 && offset <= 1) return localDate;
  }
  return activityDateFromDayNumber(utcDay);
}

/** Adds (or removes) logged episodes on one calendar day, dropping empty days. */
export async function recordWatchActivity(
  ctx: MutationCtx,
  userId: Id<'users'>,
  date: string,
  delta: number,
) {
  const existing = await ctx.db
    .query('watchActivityDays')
    .withIndex('by_user_date', (query) => query.eq('userId', userId).eq('date', date))
    .unique();
  const episodes = Math.max(0, (existing?.episodes ?? 0) + delta);
  if (existing && episodes === 0) await ctx.db.delete(existing._id);
  else if (existing) await ctx.db.patch(existing._id, { episodes });
  else if (episodes > 0) await ctx.db.insert('watchActivityDays', { userId, date, episodes });
}

export async function watchActivityForUser(ctx: QueryCtx, userId: Id<'users'>) {
  const days = await ctx.db
    .query('watchActivityDays')
    .withIndex('by_user_date', (query) => query.eq('userId', userId))
    .order('desc')
    .take(MAX_ACTIVITY_DAYS);
  return days.reverse().map(({ date, episodes }) => ({ date, episodes }));
}
