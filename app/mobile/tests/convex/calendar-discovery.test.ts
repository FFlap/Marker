import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import schema from '../../convex/schema';
import { api, internal } from '../../convex/_generated/api';
import { loadCalendarPages } from '../../../shared/calendar';
import type { Id } from '../../convex/_generated/dataModel';

const modules = import.meta.glob('../../convex/**/*.ts');
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 9, 4));
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const item = (userId: Id<'users'>, tmdbId: number) => ({
  userId,
  tmdbId,
  mediaType: 'tv' as const,
  title: `Show ${tmdbId}`,
  normalizedTitle: `show ${tmdbId}`,
  isAnime: true,
  status: 'watching' as const,
  timesWatched: 0,
  tags: [],
  rank: tmdbId,
  createdAt: 1,
  updatedAt: 1,
});
const event = (tmdbId: number, month = '2026-10') => ({
  id: `episode:${tmdbId}:1:1:${month}-05`,
  date: `${month}-05`,
  kind: 'episode' as const,
  season: 1,
  episode: 1,
});
const window = { startDate: '2026-10-01', endDate: '2026-10-31', region: 'CA' };
async function fixture(count = 1, candidateCount = count) {
  const t = convexTest(schema, modules);
  const userId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { clerkId: 'calendar-index' });
    for (let id = 1; id <= count; id++) await ctx.db.insert('items', item(userId, id));
    for (const month of ['2026-10', '2026-11']) {
      await ctx.db.insert('calendarMonths', {
        month,
        region: 'tv',
        version: 'complete',
        refreshedAt: Date.now(),
        candidates: Array.from({ length: candidateCount }, (_, index) => ({
          tmdbId: index + 1,
          mediaType: 'tv' as const,
        })),
      });
      for (let id = 1; id <= candidateCount; id++)
        await ctx.db.insert('calendarSchedules', {
          month,
          key: `CA:${month}:tv:${id}:`,
          events: [event(id, month)],
          refreshedAt: Date.now(),
        });
    }
    return userId;
  });
  return { t, userId, asUser: t.withIdentity({ subject: 'calendar-index' }) };
}

/** Exercise the same durable worker that production schedules, including both movie feeds. */
async function discoverMonth(
  request: (path: string) => Promise<Record<string, unknown>>,
  month: string,
  region: string,
  mediaType?: 'movie' | 'tv',
) {
  const t = convexTest(schema, modules);
  vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input);
      try {
        return new Response(
          JSON.stringify(await request(`${url.pathname.replace('/3', '')}${url.search}`)),
        );
      } catch {
        return new Response(null, { status: 400 });
      }
    }),
  );
  const types = mediaType ? [mediaType] : (['tv', 'movie'] as const);
  for (const type of types) {
    const job = { month, region: type === 'tv' ? 'tv' : `movie:${region}`, token: type };
    await t.mutation(internal.calendarCatalog.claim, job);
    for (let step = 0; step < 1000; step++) {
      if (!(await t.query(internal.calendarRefresh.progress, job))) break;
      await t.action(internal.calendarDiscovery.continueDiscovery, job);
    }
    const catalog = await t.query(internal.calendarCatalog.metadata, { month, region: job.region });
    if (catalog?.error) throw new Error(catalog.error);
    if (!catalog?.version) throw new Error('Discovery did not finish');
  }
  const candidates = await t.run((ctx) => ctx.db.query('calendarCandidates').collect());
  return candidates
    .map(({ tmdbId, mediaType }) => ({ tmdbId, mediaType }))
    .sort((a, b) => a.mediaType.localeCompare(b.mediaType) || a.tmdbId - b.tmdbId);
}

describe('date-first release discovery', () => {
  it('uses episode dates, every page, and regional and primary movie releases', async () => {
    const request = vi.fn(async (path: string) => {
      const url = new URL(`https://example.com${path}`);
      if (url.pathname.endsWith('/tv')) {
        expect(url.searchParams.get('air_date.gte')).toBe('2026-10-01');
        expect(url.searchParams.get('air_date.lte')).toBe('2026-10-31');
        expect(url.searchParams.has('first_air_date.gte')).toBe(false);
        expect(url.searchParams.get('include_null_first_air_dates')).toBe('true');
        return {
          total_pages: 2,
          results: [
            { id: url.searchParams.get('page') === '1' ? 42 : 43, first_air_date: '1999-01-01' },
          ],
        };
      }
      const regional = url.searchParams.has('region');
      expect(url.searchParams.get(regional ? 'release_date.gte' : 'primary_release_date.gte')).toBe(
        '2026-10-01',
      );
      if (regional) expect(url.searchParams.get('region')).toBe('CA');
      return { total_pages: 1, results: regional ? [{ id: 42 }] : [{ id: 42 }, { id: 44 }] };
    });
    expect(await discoverMonth(request, '2026-10', 'CA')).toEqual([
      { mediaType: 'movie', tmdbId: 42 },
      { mediaType: 'movie', tmdbId: 44 },
      { mediaType: 'tv', tmdbId: 42 },
      { mediaType: 'tv', tmdbId: 43 },
    ]);
    expect(request).toHaveBeenCalledTimes(4);
  });
  it('rejects malformed or capped discovery instead of claiming an empty calendar', async () => {
    await expect(discoverMonth(async () => ({}), '2026-10', 'CA')).rejects.toThrow(
      'Invalid release',
    );
    await expect(
      discoverMonth(async () => ({ total_pages: 501, results: [] }), '2026-10', 'CA'),
    ).rejects.toThrow('narrower');
    await expect(
      discoverMonth(
        async (path) => {
          if (path.endsWith('page=2')) throw new Error('offline');
          return { total_pages: 2, results: [{ id: 1 }] };
        },
        '2026-10',
        'CA',
      ),
    ).rejects.toThrow('400');
  });
  it('skips unrelated media feeds and keeps movie page numbers attached to the right feed', async () => {
    const request = vi.fn(async () => ({ total_pages: 2, results: [{ id: 42 }] }));
    await discoverMonth(request, '2026-10', 'CA', 'tv');
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.every(([path]) => path.startsWith('/discover/tv?'))).toBe(true);
    request.mockClear();
    await discoverMonth(request, '2026-10', 'CA', 'movie');
    expect(request).toHaveBeenCalledTimes(4);
    expect(request.mock.calls.every(([path]) => path.startsWith('/discover/movie?'))).toBe(true);
    expect(
      request.mock.calls.filter(([path]) => path.includes('primary_release_date.gte')),
    ).toHaveLength(2);
    expect(request.mock.calls.filter(([path]) => path.includes('region=CA'))).toHaveLength(2);
  });

  it('keeps an unfinished discovery retryable when the shared provider budget is exhausted', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', { clerkId: 'limited' });
      for (let id = 1; id <= 21; id++) await ctx.db.insert('items', item(userId, id));
      await ctx.db.insert('requestThrottle', {
        key: 'tmdb-global',
        windowStart: Date.now(),
        count: 300,
      });
    });
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const result = await t
      .withIdentity({ subject: 'limited' })
      .action(api.calendar.upcomingPage, window);
    expect(result).toMatchObject({
      refreshPending: true,
      retryAfterMs: 1_000,
      failedTitles: { count: 1 },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(
      await t.query(internal.calendarCatalog.metadata, { month: '2026-10', region: 'tv' }),
    ).toMatchObject({ version: '', refreshedAt: 0 });
  });

  it('fences concurrent refreshes and preserves the old catalog after failure', async () => {
    const { t } = await fixture();
    const args = { month: '2026-10', region: 'tv' };
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 5));
    expect(await t.mutation(internal.calendarCatalog.claim, { ...args, token: 'first' })).toBe(
      true,
    );
    expect(await t.mutation(internal.calendarCatalog.claim, { ...args, token: 'second' })).toBe(
      false,
    );
    const checkpoint = { ...args, feed: 0, page: 1, totalPages: 1, candidates: [] };
    expect(
      await t.mutation(internal.calendarRefresh.checkpoint, {
        ...checkpoint,
        token: 'second',
      }),
    ).toBe(false);
    await t.mutation(internal.calendarRefresh.failed, {
      ...args,
      token: 'first',
      feed: 0,
      page: 1,
      permanent: true,
      message: 'offline',
    });
    expect(await t.query(internal.calendarCatalog.metadata, args)).toMatchObject({
      version: 'complete',
      error: 'offline',
    });
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 6));
    expect(await t.mutation(internal.calendarCatalog.claim, { ...args, token: 'second' })).toBe(
      true,
    );
    await t.mutation(internal.calendarRefresh.checkpoint, { ...checkpoint, token: 'second' });
    expect(await t.query(internal.calendarCatalog.metadata, args)).toMatchObject({
      version: 'first',
      refreshedAt: Date.now(),
    });
    expect(
      await t.mutation(internal.calendarRefresh.checkpoint, {
        ...checkpoint,
        token: 'first',
      }),
    ).toBe(false);
  });
  it('does no provider work for an empty library on a cold month', async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert('users', { clerkId: 'empty' }));
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(
      await t.withIdentity({ subject: 'empty' }).action(api.calendar.upcomingPage, window),
    ).toMatchObject({ events: [], nextCursor: null, failedTitles: { count: 0 } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('loads only two matching releases for a 2,000-title library', async () => {
    const { asUser } = await fixture(2000, 2);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const result = await asUser.action(api.calendar.upcomingPage, { ...window, cachedOnly: true });
    expect(result.events.map((release) => release.tmdbId)).toEqual([1, 2]);
    expect(result.nextCursor).toBeNull();
    expect(result.needsRefresh).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('paginates beyond 100 matching titles without returning unrelated releases', async () => {
    const { asUser } = await fixture(201, 205);
    const fetch = vi.fn((args) => asUser.action(api.calendar.upcomingPage, args));
    const result = await loadCalendarPages(fetch, { ...window, cachedOnly: true }, () => {});
    expect(result.events.map((release) => release.tmdbId).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 201 }, (_, i) => i + 1),
    );
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[1][0].cursor).toEqual({
      month: '2026-10',
      offset: 100,
      mediaType: 'tv',
      version: 'complete',
    });
  });
  it('continues past 1500 unrelated candidates even when the first page is empty', async () => {
    const { t, asUser, userId } = await fixture(21, 0);
    await t.run(async (ctx) => {
      const catalog = await ctx.db
        .query('calendarMonths')
        .withIndex('by_region_month', (q) => q.eq('region', 'tv').eq('month', '2026-10'))
        .unique();
      await ctx.db.patch(catalog!._id, {
        candidates: Array.from({ length: 1501 }, (_, i) => ({
          tmdbId: 100 + i,
          mediaType: 'tv' as const,
        })),
      });
      await ctx.db.insert('items', item(userId, 1600));
      await ctx.db.insert('calendarSchedules', {
        month: '2026-10',
        key: 'CA:2026-10:tv:1600:',
        events: [event(1600)],
        refreshedAt: Date.now(),
      });
    });
    const fetch = vi.fn((args) => asUser.action(api.calendar.upcomingPage, args));
    const result = await loadCalendarPages(fetch, { ...window, cachedOnly: true }, () => {});
    expect(result.events.map((release) => release.tmdbId)).toEqual([1600]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await fetch.mock.results[0].value).toMatchObject({ events: [] });
    expect(fetch.mock.calls[1][0].cursor).toEqual({
      month: '2026-10',
      offset: 1500,
      mediaType: 'tv',
      version: 'complete',
    });
  });
  it('joins current membership and names without rebuilding saved schedules', async () => {
    const { t, asUser, userId } = await fixture(1, 2);
    expect((await asUser.action(api.calendar.upcomingPage, window)).events).toHaveLength(1);
    await t.run(async (ctx) => {
      await ctx.db.insert('items', { ...item(userId, 2), title: 'New library title' });
      const first = await ctx.db
        .query('items')
        .withIndex('by_user_tmdb', (q) =>
          q.eq('userId', userId).eq('mediaType', 'tv').eq('tmdbId', 1),
        )
        .unique();
      await ctx.db.patch(first!._id, { status: 'dropped' });
    });
    const result = await asUser.action(api.calendar.upcomingPage, { ...window, cachedOnly: true });
    expect(result.events).toMatchObject([{ tmdbId: 2, title: 'New library title' }]);
    expect(result.events).toHaveLength(1);
    await t.run((ctx) => ctx.db.insert('users', { clerkId: 'stranger' }));
    expect(
      (await t.withIdentity({ subject: 'stranger' }).action(api.calendar.upcomingPage, window))
        .events,
    ).toEqual([]);
  });
  it('keeps day and multi-month queries within the requested date bounds', async () => {
    const { asUser } = await fixture();
    expect(
      (await asUser.action(api.calendar.upcomingPage, { ...window, startDate: '2026-10-06' }))
        .events,
    ).toEqual([]);
    const result = await loadCalendarPages(
      (args) => asUser.action(api.calendar.upcomingPage, args),
      {
        ...window,
        startDate: '2026-10-06',
        endDate: '2026-11-05',
        cachedOnly: true,
      },
      () => {},
    );
    expect(result.events).toMatchObject([{ date: '2026-11-05' }]);
    expect(result.events).toHaveLength(1);
  });
  it('prunes old months while retaining the previous month for time-zone boundaries', async () => {
    const { t } = await fixture();
    await t.run(async (ctx) => {
      for (const month of ['2026-08', '2026-09']) {
        await ctx.db.insert('calendarMonths', {
          month,
          region: 'tv',
          candidates: [],
          version: 'saved',
          refreshedAt: 1,
        });
        await ctx.db.insert('calendarSchedules', {
          month,
          key: `CA:${month}:tv:1:`,
          events: [],
          refreshedAt: 1,
        });
      }
    });
    await t.mutation(internal.calendarCatalog.prune, {});
    await t.run(async (ctx) => {
      expect(
        (await ctx.db.query('calendarMonths').collect()).map((row) => row.month).sort(),
      ).toEqual(['2026-09', '2026-10', '2026-11']);
      expect(
        (await ctx.db.query('calendarSchedules').collect()).map((row) => row.month).sort(),
      ).toEqual(['2026-09', '2026-10', '2026-11']);
    });
  });

  it('rejects invalid cursors instead of mixing catalog versions', async () => {
    const { asUser } = await fixture(21);
    for (const cursor of [
      { month: '2026-10', offset: 0, version: 'obsolete' },
      { month: '2026-10', offset: -1, version: 'complete' },
      { month: '2026-11', offset: 0, version: 'complete' },
    ])
      await expect(
        asUser.action(api.calendar.upcomingPage, { ...window, cursor }),
      ).rejects.toThrow();
  });
});
