import { type Infer, v } from 'convex/values';
import { action, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { requireUser } from './clerkAuth';
import { loadTitleSchedules } from './calendarProviders';
import { eventValidator, isDate, libraryTitleValidator, type LibraryTitle } from './calendarTypes';

const MAX_TITLES = 100;
const resultValidator = v.object({
  events: v.array(eventValidator),
  truncated: v.boolean(),
  failedTitles: v.object({ count: v.number(), names: v.array(v.string()) }),
  region: v.string(),
});

export const libraryTitles = internalQuery({
  args: { userId: v.id('users') },
  returns: v.array(libraryTitleValidator),
  handler: async (ctx, { userId }) => {
    const titles: LibraryTitle[] = [];
    for (const status of ['watching', 'watchlist', 'watched'] as const) {
      const remaining = MAX_TITLES + 1 - titles.length;
      if (remaining <= 0) break;
      const rows = await ctx.db
        .query('items')
        .withIndex('by_user_status_active', (q) =>
          q.eq('userId', userId).eq('status', status).eq('deletingAt', undefined),
        )
        .take(remaining);
      titles.push(
        ...rows.map((item) => ({
          tmdbId: item.tmdbId,
          mediaType: item.mediaType,
          title: item.title,
          status,
          ...(item.posterPath && { posterPath: item.posterPath }),
          ...(item.releaseDate && { releaseDate: item.releaseDate }),
        })),
      );
    }
    return titles;
  },
});

// Installed clients expect a single response with both movies and episodes.
// Keep their existing 100-title bound while new clients use upcomingPage.
export const upcoming = action({
  args: {
    startDate: v.string(),
    endDate: v.string(),
    region: v.optional(v.string()),
  },
  returns: resultValidator,
  handler: async (
    ctx,
    { startDate, endDate, region: rawRegion },
  ): Promise<Infer<typeof resultValidator>> => {
    const userId = await requireUser(ctx);
    if (!isDate(startDate) || !isDate(endDate) || startDate > endDate)
      throw new Error('Invalid calendar date range');
    if (
      (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000 >
      93
    )
      throw new Error('Calendar ranges are limited to 93 days');
    const region = /^[A-Za-z]{2}$/.test(rawRegion ?? '') ? rawRegion!.toUpperCase() : 'US';
    const titles = await ctx.runQuery(internal.calendarLegacy.libraryTitles, { userId });
    const loaded = await loadTitleSchedules(
      ctx,
      titles.slice(0, MAX_TITLES),
      startDate,
      endDate,
      region,
      false,
    );
    const failed = loaded.results.filter((result) => result.failed);
    return {
      events: loaded.results
        .flatMap((result) => result.events)
        .sort(
          (left, right) =>
            left.date.localeCompare(right.date) || left.title.localeCompare(right.title),
        ),
      truncated: titles.length > MAX_TITLES,
      failedTitles: {
        count: failed.length,
        names: failed.slice(0, 5).map(({ item }) => item.title),
      },
      region,
    };
  },
});
