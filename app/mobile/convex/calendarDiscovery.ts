import { ConvexError, v } from 'convex/values';
import { internalAction } from './_generated/server';
import type { ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import { createRequest } from './calendarProviders';
import { CALENDAR_TTL_MS, catalogRegion, monthEnd } from './calendarTypes';

/** Each page is durable before its successor is scheduled. */
export const continueDiscovery = internalAction({
  args: { month: v.string(), region: v.string(), token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const progress = await ctx.runQuery(internal.calendarRefresh.progress, args);
    if (!progress) return null;
    try {
      const start = `${args.month}-01`;
      const end = monthEnd(args.month);
      const path =
        args.region === 'tv'
          ? `/discover/tv?include_adult=true&include_null_first_air_dates=true&timezone=UTC&air_date.gte=${start}&air_date.lte=${end}`
          : progress.feed === 0
            ? `/discover/movie?include_adult=true&include_video=true&region=${args.region.slice(6)}&release_date.gte=${start}&release_date.lte=${end}`
            : `/discover/movie?include_adult=true&include_video=true&primary_release_date.gte=${start}&primary_release_date.lte=${end}`;
      const payload = await createRequest(ctx, 1)(`${path}&page=${progress.page}`);
      if (
        !Number.isInteger(payload.total_pages) ||
        (payload.total_pages as number) < 0 ||
        !Array.isArray(payload.results) ||
        payload.results.length > 1000
      )
        throw new Error('Invalid release discovery response');
      if ((payload.total_pages as number) > 500)
        throw new Error('Release discovery needs a narrower date range');
      const candidates = payload.results.map((entry) => {
        if (!entry || !Number.isInteger(entry.id) || entry.id <= 0)
          throw new Error('Invalid release title');
        return {
          mediaType: args.region === 'tv' ? ('tv' as const) : ('movie' as const),
          tmdbId: entry.id as number,
        };
      });
      await ctx.runMutation(internal.calendarRefresh.checkpoint, {
        ...args,
        ...progress,
        totalPages: payload.total_pages as number,
        candidates,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Release discovery failed';
      const permanent =
        /Invalid release|narrower date range|not configured|request failed \(4/.test(message);
      await ctx.runMutation(internal.calendarRefresh.failed, {
        ...args,
        ...progress,
        permanent,
        message,
      });
    }
    return null;
  },
});

/** Share discovery across users, and publish only after every page succeeds. */
export async function ensureMonth(
  ctx: ActionCtx,
  month: string,
  region: string,
  mediaType: 'tv' | 'movie',
) {
  const args = { month, region: catalogRegion(region, mediaType) };
  const current = await ctx.runQuery(internal.calendarCatalog.metadata, args);
  if (current && current.refreshedAt > Date.now() - CALENDAR_TTL_MS) return;
  const token = crypto.randomUUID();
  if (current?.error && (current.retryAt ?? 0) > Date.now()) throw new Error(current.error);
  await ctx.runMutation(internal.calendarCatalog.claim, { ...args, token });
  const saved = await ctx.runQuery(internal.calendarCatalog.metadata, args);
  if (!saved || saved.refreshedAt <= Date.now() - CALENDAR_TTL_MS)
    throw new ConvexError({ code: 'calendar_refresh_pending', retryable: true });
}
