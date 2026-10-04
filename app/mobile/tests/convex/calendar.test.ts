import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import schema from '../../convex/schema';
import { api, internal } from '../../convex/_generated/api';
import * as snapshots from '../../convex/providerSnapshots';

const modules = import.meta.glob('../../convex/**/*.ts');

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('calendar partial failures', () => {
  it('returns successful events with bounded failed-title metadata', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', { clerkId: 'calendar_user' });
      for (const [tmdbId, title] of [
        [1, 'Loaded movie'],
        [2, 'Broken movie'],
      ] as const)
        await ctx.db.insert('items', {
          userId,
          tmdbId,
          mediaType: 'movie',
          title,
          normalizedTitle: title.toLocaleLowerCase(),
          isAnime: false,
          status: 'watchlist',
          timesWatched: 0,
          tags: [],
          rank: tmdbId,
          createdAt: 1,
          updatedAt: 1,
        });
    });
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes('/movie/1/release_dates'))
          return new Response(
            JSON.stringify({
              results: [
                {
                  iso_3166_1: 'US',
                  release_dates: [{ release_date: '2026-08-20T00:00:00Z', type: 3 }],
                },
              ],
            }),
            { status: 200 },
          );
        return new Response('{}', { status: 503 });
      }),
    );

    await expect(
      t.withIdentity({ subject: 'calendar_user' }).action(api.calendar.upcoming, {
        startDate: '2026-08-01',
        endDate: '2026-08-31',
        region: 'US',
      }),
    ).resolves.toMatchObject({
      events: [{ title: 'Loaded movie', date: '2026-08-20' }],
      failedTitles: { count: 1, names: ['Broken movie'] },
    });
  });
});

describe('calendar episode dates', () => {
  const setup = async (payload: object) => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', { clerkId: 'calendar_tv' });
      await ctx.db.insert('items', {
        userId,
        tmdbId: 42,
        mediaType: 'tv',
        title: 'Weekly show',
        normalizedTitle: 'weekly show',
        isAnime: false,
        status: 'watching',
        timesWatched: 0,
        tags: [],
        rank: 0,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const value = url.endsWith('/season/1')
        ? {
            episodes: [
              { air_date: '2026-09-02', season_number: 1, episode_number: 1, name: 'First' },
              { air_date: '2026-09-09', season_number: 1, episode_number: 2, name: 'Second' },
            ],
          }
        : url.endsWith('/season/2')
          ? {
              episodes: [
                { air_date: '2026-09-23', season_number: 2, episode_number: 1, name: 'Return' },
              ],
            }
          : payload;
      return new Response(JSON.stringify(value), { status: 200 });
    });
    vi.stubGlobal('fetch', fetch);
    return { t: t.withIdentity({ subject: 'calendar_tv' }), base: t, fetch };
  };

  it('returns earlier episodes even when the next episode airs after the selected day', async () => {
    const { t, fetch } = await setup({
      seasons: [{ season_number: 1, air_date: '2026-09-02' }],
      next_episode_to_air: { season_number: 1, air_date: '2026-09-09' },
    });
    const month = await t.action(api.calendar.upcoming, {
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
    const day = await t.action(api.calendar.upcoming, {
      startDate: '2026-09-02',
      endDate: '2026-09-02',
    });
    expect(day.events).toEqual(month.events.filter((event) => event.date === '2026-09-02'));
    expect(day.events).toMatchObject([{ episodeName: 'First', season: 1, episode: 1 }]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns episodes for ended shows without a next episode', async () => {
    const { t } = await setup({
      seasons: [{ season_number: 1, air_date: '2026-09-02' }],
      next_episode_to_air: null,
    });
    const day = await t.action(api.calendar.upcoming, {
      startDate: '2026-09-02',
      endDate: '2026-09-02',
    });
    expect(day.events).toHaveLength(1);
  });

  it('includes both seasons when a month crosses a season boundary', async () => {
    const { t } = await setup({
      seasons: [
        { season_number: 1, air_date: '2026-09-02' },
        { season_number: 2, air_date: '2026-09-23' },
      ],
      next_episode_to_air: { season_number: 2, air_date: '2026-09-23' },
    });
    const month = await t.action(api.calendar.upcoming, {
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
    expect(month.events.map((event) => event.episodeName)).toEqual(['First', 'Second', 'Return']);
  });

  it('does not expose another account’s library and requires authentication', async () => {
    const { base } = await setup({ seasons: [] });
    await expect(
      base.withIdentity({ subject: 'stranger' }).action(api.calendar.upcoming, {
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      }),
    ).rejects.toThrow('Authentication required');
    await expect(
      base.action(api.calendar.upcoming, {
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      }),
    ).rejects.toThrow('Authentication required');
    await base.run(async (ctx) => {
      await ctx.db.insert('users', { clerkId: 'stranger' });
    });
    const other = await base.withIdentity({ subject: 'stranger' }).action(api.calendar.upcoming, {
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
    expect(other.events).toEqual([]);
  });

  it('keeps cached releases during an upstream outage and reports stale data as partial', async () => {
    const { t, base, fetch } = await setup({
      seasons: [{ season_number: 1, air_date: '2026-09-02' }],
    });
    const args = { startDate: '2026-09-01', endDate: '2026-09-30' };
    const initial = await t.action(api.calendar.upcoming, args);
    await base.run(async (ctx) => {
      for (const key of ['calendar:tv:v2:42', 'calendar:season:42:1']) {
        const row = await ctx.db
          .query('providerSnapshots')
          .withIndex('by_key', (q) => q.eq('key', key))
          .unique();
        await ctx.db.patch(row!._id, { refreshedAt: Date.now() - 7 * 60 * 60 * 1000 });
      }
    });
    fetch.mockImplementation(async () => new Response('{}', { status: 503 }));
    const offline = await t.action(api.calendar.upcoming, args);
    expect(offline.events).toEqual(initial.events);
    expect(offline.failedTitles).toEqual({ count: 1, names: ['Weekly show'] });
  });

  it('does not lose a regular season when specials fail', async () => {
    const { t, fetch } = await setup({
      seasons: [
        { season_number: 0, air_date: '2025-01-01' },
        { season_number: 1, air_date: '2026-09-02' },
      ],
    });
    const original = fetch.getMockImplementation()!;
    fetch.mockImplementation(async (input) =>
      String(input).endsWith('/season/0') ? new Response('{}', { status: 404 }) : original(input),
    );
    const month = await t.action(api.calendar.upcoming, {
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
    expect(month.events).toHaveLength(2);
    expect(month.failedTitles.count).toBe(1);
  });

  it('reloads truncated snapshots instead of treating them as schedules', async () => {
    const { t, base, fetch } = await setup({
      seasons: [{ season_number: 1, air_date: '2026-09-02' }],
    });
    await base.mutation(internal.providerSnapshots.put, {
      key: 'calendar:tv:v2:42',
      entry: {
        kind: 'truncated',
        value: { __truncatedProviderSnapshot: true, originalBytes: 999_999 },
      },
    });
    const month = await t.action(api.calendar.upcoming, {
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
    expect(month.events).toHaveLength(2);
    expect(month.failedTitles.count).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('calendar repeat loading', () => {
  it('loads a saved library in bounded batches without per-title reads or provider calls', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', { clerkId: 'cached_library' });
      for (let tmdbId = 1; tmdbId <= 45; tmdbId++) {
        await ctx.db.insert('items', {
          userId,
          tmdbId,
          mediaType: 'tv',
          title: `Show ${tmdbId}`,
          normalizedTitle: `show ${tmdbId}`,
          isAnime: false,
          status: 'watching',
          timesWatched: 0,
          tags: [],
          rank: tmdbId,
          createdAt: 1,
          updatedAt: 1,
        });
        await ctx.db.insert('providerSnapshots', {
          key: `calendar:tv:v2:${tmdbId}`,
          entry: { kind: 'calendarTvSchedule', value: [{ season: 1, airDate: '2026-09-02' }] },
          refreshedAt: Date.now(),
        });
        await ctx.db.insert('providerSnapshots', {
          key: `calendar:season:${tmdbId}:1`,
          entry: {
            kind: 'calendarSeason',
            value: [
              { season: 1, episode: 1, date: '2026-09-02', name: 'First' },
              { season: 1, episode: 5, date: '2026-10-02', name: 'Fifth' },
            ],
          },
          refreshedAt: Date.now(),
        });
      }
    });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const individualRead = vi.spyOn(snapshots.get, '_handler');
    const batchedRead = vi.spyOn(snapshots.getCalendarSnapshots, '_handler');
    const asUser = t.withIdentity({ subject: 'cached_library' });
    for (const month of ['09', '10']) {
      batchedRead.mockClear();
      const schedule = await asUser.action(api.calendar.upcoming, {
        startDate: `2026-${month}-01`,
        endDate: `2026-${month}-30`,
      });
      expect(schedule.events).toHaveLength(45);
      expect(schedule.events.every((event) => event.date === `2026-${month}-02`)).toBe(true);
      expect(schedule.failedTitles.count).toBe(0);
      expect(batchedRead).toHaveBeenCalledTimes(6);
      expect(batchedRead.mock.calls.every(([, args]) => args.keys.length <= 20)).toBe(true);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(individualRead).not.toHaveBeenCalled();
  });

  it('excludes deleting and dropped titles before applying the library limit', async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', { clerkId: 'large_library' });
      for (let tmdbId = 1; tmdbId <= 205; tmdbId++)
        await ctx.db.insert('items', {
          userId,
          tmdbId,
          mediaType: 'movie',
          title: `Movie ${tmdbId}`,
          normalizedTitle: `movie ${tmdbId}`,
          isAnime: false,
          status: tmdbId === 205 ? 'dropped' : 'watchlist',
          ...(tmdbId <= 102 ? { deletingAt: 1 } : {}),
          timesWatched: 0,
          tags: [],
          rank: tmdbId,
          createdAt: 1,
          updatedAt: 1,
        });
      return userId;
    });
    const titles = await t.query(internal.calendar.libraryTitles, { userId });
    expect(titles).toHaveLength(101);
    expect(titles[0].tmdbId).toBe(103);
    expect(titles.at(-1)?.tmdbId).toBe(203);
  });
});
