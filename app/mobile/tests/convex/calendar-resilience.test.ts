import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import { loadCalendarPages } from '../../../shared/calendar';
import * as providerRateLimits from '../../convex/providerRateLimits';

const modules = import.meta.glob('../../convex/**/*.ts');
const now = Date.UTC(2026, 9, 15);
const range = { startDate: '2026-10-01', endDate: '2026-10-31', region: 'CA' };
const release = {
  id: 'episode:1:1:1:2026-10-20',
  date: '2026-10-20',
  kind: 'episode' as const,
  season: 1,
  episode: 1,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup(count = 21) {
  const t = convexTest(schema, modules);
  const userId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { clerkId: 'resilience' });
    for (let tmdbId = 1; tmdbId <= count; tmdbId++)
      await ctx.db.insert('items', {
        userId,
        tmdbId,
        mediaType: 'tv',
        title: `Show ${tmdbId}`,
        normalizedTitle: `show ${tmdbId}`,
        status: 'watching',
        isAnime: false,
        timesWatched: 0,
        tags: [],
        rank: tmdbId,
        createdAt: now,
        updatedAt: now,
      });
    await ctx.db.insert('calendarMonths', {
      month: '2026-10',
      region: 'tv',
      version: 'published',
      candidates: [{ tmdbId: 1, mediaType: 'tv' }],
      refreshedAt: now,
    });
    await ctx.db.insert('calendarSchedules', {
      key: 'CA:2026-10:tv:1:',
      month: '2026-10',
      events: [release],
      refreshedAt: now,
    });
    return userId;
  });
  return { t, userId, viewer: t.withIdentity({ subject: 'resilience' }) };
}

describe('calendar availability during recovery', () => {
  it('prefers the saved schedule to an older provider snapshot when a refresh fails', async () => {
    const { t, viewer } = await setup(1);
    await t.run(async (ctx) => {
      const saved = await ctx.db.query('calendarSchedules').first();
      await ctx.db.patch(saved!._id, { refreshedAt: now - 7 * 60 * 60_000 });
      await ctx.db.insert('providerSnapshots', {
        key: 'calendar:tv:v2:1',
        entry: { kind: 'calendarTvSchedule', value: [{ season: 1 }] },
        refreshedAt: now,
      });
      // A previous best-effort snapshot write failed, but the schedule was published.
      await ctx.db.insert('providerSnapshots', {
        key: 'calendar:season:1:1',
        entry: { kind: 'calendarSeason', value: [] },
        refreshedAt: now - 8 * 60 * 60_000,
      });
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 400 })),
    );
    const result = await viewer.action(api.calendar.upcoming, range);
    expect(result.events).toMatchObject([release]);
    expect(result.failedTitles.count).toBe(1);
    expect(
      await viewer.action(api.calendar.upcoming, { ...range, cachedOnly: true }),
    ).toMatchObject({ events: [release], needsRefresh: true });
  });

  it('does not reserve unused provider requests for a single title', async () => {
    const { t, viewer } = await setup(0);
    await viewer.mutation(api.library.items.addItem, {
      tmdbId: 99,
      mediaType: 'movie',
      title: 'Movie',
      status: 'watchlist',
      releaseDate: release.date,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ results: [] }))),
    );
    expect((await viewer.action(api.calendar.upcoming, range)).events).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query('requestThrottle').first())).toMatchObject({
      count: 1,
    });
  });

  it('stops contending for an exhausted provider window within the same action', async () => {
    const { t, viewer } = await setup(20);
    await t.run(async (ctx) => {
      await ctx.db.insert('requestThrottle', { key: 'tmdb-global', windowStart: now, count: 300 });
      const schedule = await ctx.db.query('calendarSchedules').first();
      await ctx.db.patch(schedule!._id, { refreshedAt: 0 });
    });
    const budget = vi.spyOn(providerRateLimits.consumeGlobalProviderLimiter, '_handler');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const result = await viewer.action(api.calendar.upcoming, range);
    expect(result.failedTitles.count).toBe(20);
    expect(result.retryAfterMs).toBe(60_000);
    expect(budget).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reclaims an abandoned schedule publication without hiding its last complete version', async () => {
    const { t } = await setup();
    const write = {
      key: 'CA:2026-10:tv:1:',
      month: '2026-10',
      token: 'abandoned',
      refreshedAt: now,
    };
    await t.run(async (ctx) => {
      const saved = await ctx.db.query('calendarSchedules').first();
      await ctx.db.patch(saved!._id, { refreshedAt: now - 7 * 60 * 60_000 });
    });
    expect(await t.mutation(internal.calendarScheduleStore.begin, write)).toBe(true);
    expect(
      await t.query(internal.calendarScheduleStore.readPage, { key: write.key, offset: 0 }),
    ).toMatchObject({ events: [release] });
    const partial = { ...write, token: 'partial', refreshedAt: now - 6 * 60 * 60_000 };
    expect(await t.mutation(internal.calendarScheduleStore.begin, partial)).toBe(false);
    vi.setSystemTime(now + 120_001);
    expect(await t.mutation(internal.calendarScheduleStore.begin, partial)).toBe(true);
    const corrected = { ...release, id: 'corrected', date: '2026-10-21' };
    expect(
      await t.mutation(internal.calendarScheduleStore.writeChunk, {
        ...partial,
        chunk: 0,
        events: [corrected],
        done: true,
      }),
    ).toBe(true);
    expect(
      await t.mutation(internal.calendarScheduleStore.writeChunk, {
        ...write,
        chunk: 0,
        events: [release],
        done: true,
      }),
    ).toBe(false);
    expect(
      await t.query(internal.calendarScheduleStore.readPage, { key: write.key, offset: 0 }),
    ).toMatchObject({ events: [corrected] });
  });

  it('serves the published catalog during failure backoff and still visits the movie page', async () => {
    const { t, viewer } = await setup();
    await t.run(async (ctx) => {
      const catalog = await ctx.db.query('calendarMonths').first();
      await ctx.db.patch(catalog!._id, {
        refreshedAt: now - 7 * 60 * 60_000,
        discoveryError: 'Provider unavailable',
        discoveryRetryAt: now + 60_000,
      });
    });
    await viewer.mutation(api.library.items.addItem, {
      tmdbId: 99,
      mediaType: 'movie',
      title: 'Movie',
      status: 'watchlist',
    });
    await t.run((ctx) =>
      ctx.db.insert('calendarSchedules', {
        key: 'CA:2026-10:movie:99:',
        month: '2026-10',
        events: [{ id: 'movie:99', date: release.date, kind: 'movie' }],
        refreshedAt: now,
      }),
    );
    const result = await loadCalendarPages(
      (args) => viewer.action(api.calendar.upcoming, args),
      range,
      () => {},
    );
    expect(result.events.map((event) => event.id).sort()).toEqual([release.id, 'movie:99'].sort());
    expect(result.needsRefresh).toBe(true);
    expect(result.failedTitles.count).toBe(0);
  });

  it('selects the active copy when a removed title is re-added before deletion finishes', async () => {
    const { t, viewer, userId } = await setup();
    const oldItem = await t.run((ctx) =>
      ctx.db
        .query('items')
        .withIndex('by_user_tmdb', (q) =>
          q.eq('userId', userId).eq('mediaType', 'tv').eq('tmdbId', 1),
        )
        .unique(),
    );
    await viewer.mutation(api.library.items.removeItem, { itemId: oldItem!._id });
    await viewer.mutation(api.library.items.addItem, {
      tmdbId: 1,
      mediaType: 'tv',
      title: 'Re-added show',
      status: 'watchlist',
    });
    const result = await viewer.action(api.calendar.upcoming, { ...range, cachedOnly: true });
    expect(result.events).toMatchObject([
      { ...release, title: 'Re-added show', status: 'watchlist' },
    ]);
  });

  it('continues to surface discovery failure when no published catalog exists', async () => {
    const { t, viewer } = await setup();
    await t.run(async (ctx) => {
      const catalog = await ctx.db.query('calendarMonths').first();
      await ctx.db.patch(catalog!._id, {
        version: '',
        refreshedAt: 0,
        discoveryError: 'Provider unavailable',
        discoveryRetryAt: now + 60_000,
      });
    });
    await expect(viewer.action(api.calendar.upcoming, range)).rejects.toThrow(
      'Provider unavailable',
    );
    expect(
      await t.query(internal.calendarRefresh.progress, {
        month: '2026-10',
        region: 'tv',
        token: 'none',
      }),
    ).toBeNull();
  });
});
