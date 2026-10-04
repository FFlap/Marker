import { ConvexError } from 'convex/values';
import type { ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import { createRequest } from './calendarProviders';
import { CALENDAR_TTL_MS, catalogRegion, monthEnd, type Candidate } from './calendarTypes';

async function completed<T>(promises: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(promises);
  return results.map((result) => {
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  });
}

/** Discover by episode air date, never by a series' premiere year. */
export async function discoverMonth(
  request: ReturnType<typeof createRequest>,
  month: string,
  region: string,
  mediaType?: 'movie' | 'tv',
) {
  const start = `${month}-01`;
  const end = monthEnd(month);
  const paths = [
    `/discover/tv?include_adult=true&include_null_first_air_dates=true&timezone=UTC&air_date.gte=${start}&air_date.lte=${end}`,
    `/discover/movie?include_adult=true&include_video=true&region=${region}&release_date.gte=${start}&release_date.lte=${end}`,
    // Preserve the existing primary-date fallback when a regional release is unknown.
    `/discover/movie?include_adult=true&include_video=true&primary_release_date.gte=${start}&primary_release_date.lte=${end}`,
  ];
  const selected = mediaType === 'tv' ? [0] : mediaType === 'movie' ? [1, 2] : [0, 1, 2];
  const candidates = new Map<string, Candidate>();
  const read = async (index: number, page: number) => {
    const payload = await request(`${paths[index]}&page=${page}`);
    const pages = payload.total_pages;
    if (!Number.isInteger(pages) || (pages as number) < 0 || !Array.isArray(payload.results))
      throw new Error('Invalid release discovery response');
    // TMDB caps discovery at 500 pages. Do not silently publish an incomplete calendar.
    if ((pages as number) > 500) throw new Error('Release discovery needs a narrower date range');
    for (const entry of payload.results) {
      if (!entry || !Number.isInteger(entry.id) || entry.id <= 0)
        throw new Error('Invalid release title');
      const mediaType = index === 0 ? ('tv' as const) : ('movie' as const);
      candidates.set(`${mediaType}:${entry.id}`, { mediaType, tmdbId: entry.id });
    }
    return pages as number;
  };
  const totals = await completed(selected.map((index) => read(index, 1)));
  const tasks = totals.flatMap((total, index) =>
    Array.from({ length: Math.max(0, total - 1) }, (_, page) => ({
      index: selected[index],
      page: page + 2,
    })),
  );
  let next = 0;
  let stopped = false;
  await completed(
    Array.from({ length: Math.min(4, tasks.length) }, async () => {
      while (!stopped && next < tasks.length) {
        const task = tasks[next++];
        try {
          await read(task.index, task.page);
        } catch (error) {
          stopped = true;
          throw error;
        }
      }
    }),
  );
  return [...candidates.values()].sort(
    (a, b) => a.mediaType.localeCompare(b.mediaType) || a.tmdbId - b.tmdbId,
  );
}

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
  if (!(await ctx.runMutation(internal.calendarCatalog.claim, { ...args, token }))) {
    // A concurrent screen/user is already warming this month. Never start another crawl.
    for (let attempt = 0; attempt < 20; attempt++) {
      const saved = await ctx.runQuery(internal.calendarCatalog.metadata, args);
      if (saved && saved.refreshedAt > Date.now() - CALENDAR_TTL_MS) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new ConvexError({ code: 'calendar_refresh_pending', retryable: true });
  }
  try {
    const candidates = await discoverMonth(createRequest(ctx), month, region, mediaType);
    if (!(await ctx.runMutation(internal.calendarCatalog.publish, { ...args, token, candidates })))
      throw new Error('The release refresh was superseded. Please retry.');
  } catch (error) {
    await ctx.runMutation(internal.calendarCatalog.publish, { ...args, token });
    throw error;
  }
}
