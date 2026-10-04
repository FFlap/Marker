import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import schema from '../../convex/schema';
import { api, internal } from '../../convex/_generated/api';
import { loadCalendarPages, type CalendarCursor } from '../../../shared/calendar';
import * as snapshots from '../../convex/providerSnapshots';

const modules = import.meta.glob('../../convex/**/*.ts');

beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 7, 1, 12)));

const scheduleFor = (
  t: ReturnType<typeof convexTest>,
  args: { startDate: string; endDate: string; region?: string },
) =>
  loadCalendarPages(
    (page) => t.action(api.calendar.upcoming, page),
    { region: 'US', ...args },
    () => {},
  );

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
      scheduleFor(t.withIdentity({ subject: 'calendar_user' }), {
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
    const payloadFor = (url: string) =>
      url.endsWith('/season/1')
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
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const appended = new URL(url).searchParams.get('append_to_response');
      const value = appended
        ? Object.fromEntries(appended.split(',').map((path) => [path, payloadFor(`/${path}`)]))
        : payloadFor(url);
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
    const month = await scheduleFor(t, {
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
    const day = await scheduleFor(t, {
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
    const day = await scheduleFor(t, {
      startDate: '2026-09-02',
      endDate: '2026-09-02',
    });
    expect(day.events).toHaveLength(1);
  });

  it('skips completed seasons before this month but keeps their month available', async () => {
    const { t, fetch } = await setup({
      seasons: [{ season_number: 1, air_date: '2026-09-02', episode_count: 2 }],
      last_episode_to_air: { season_number: 1, episode_number: 2, air_date: '2026-09-09' },
    });
    const upcoming = await scheduleFor(t, { startDate: '2026-10-01', endDate: '2026-10-31' });
    expect(upcoming.events).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const previous = await scheduleFor(t, { startDate: '2026-09-01', endDate: '2026-09-30' });
    expect(previous.events).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not skip a season when its last aired episode is not the final episode', async () => {
    const { t, fetch } = await setup({
      seasons: [{ season_number: 1, air_date: '2026-08-01', episode_count: 12 }],
      last_episode_to_air: { season_number: 1, episode_number: 3, air_date: '2026-08-21' },
    });
    const upcoming = await scheduleFor(t, { startDate: '2026-09-01', endDate: '2026-09-30' });
    expect(upcoming.events).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('includes both seasons when a month crosses a season boundary', async () => {
    const { t, fetch } = await setup({
      seasons: [
        { season_number: 1, air_date: '2026-09-02' },
        { season_number: 2, air_date: '2026-09-23' },
      ],
      next_episode_to_air: { season_number: 2, air_date: '2026-09-23' },
    });
    const month = await scheduleFor(t, {
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
    expect(month.events.map((event) => event.episodeName)).toEqual(['First', 'Second', 'Return']);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      fetch.mock.calls.some(([url]) =>
        String(url).includes('append_to_response=season/1,season/2'),
      ),
    ).toBe(true);
  });

  it('does not expose another account’s library and requires authentication', async () => {
    const { base } = await setup({ seasons: [] });
    await expect(
      scheduleFor(base.withIdentity({ subject: 'stranger' }), {
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      }),
    ).rejects.toThrow('Authentication required');
    await expect(
      scheduleFor(base, {
        startDate: '2026-09-01',
        endDate: '2026-09-30',
      }),
    ).rejects.toThrow('Authentication required');
    await base.run(async (ctx) => {
      await ctx.db.insert('users', { clerkId: 'stranger' });
    });
    const other = await scheduleFor(base.withIdentity({ subject: 'stranger' }), {
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
    const initial = await scheduleFor(t, args);
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
    const offline = await scheduleFor(t, args);
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
    const month = await scheduleFor(t, {
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
    const month = await scheduleFor(t, {
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
    expect(month.events).toHaveLength(2);
    expect(month.failedTitles.count).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('does not read schedules or call providers for past months', async () => {
    const { t, fetch } = await setup({ seasons: [{ season_number: 1, air_date: '2026-09-02' }] });
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 15));
    const reads = vi.spyOn(snapshots.getCalendarSnapshots, '_handler');
    const past = await t.action(api.calendar.upcoming, {
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
    expect(past).toMatchObject({ events: [], nextCursor: null, truncated: false });
    expect(reads).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the device’s current month available at a UTC month boundary', async () => {
    const { t, fetch } = await setup({ seasons: [{ season_number: 1, air_date: '2026-09-02' }] });
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 1, 1));
    const local = await t.action(api.calendar.upcoming, {
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      timeZoneOffsetMinutes: 360,
    });
    expect(local.events).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('returns a retry delay when the provider budget is temporarily exhausted', async () => {
    const { t, base, fetch } = await setup({ seasons: [] });
    await base.run(async (ctx) => {
      await ctx.db.insert('requestThrottle', {
        key: 'tmdb-global',
        windowStart: Date.now(),
        count: 300,
      });
    });
    const limited = await t.action(api.calendar.upcoming, {
      startDate: '2026-09-01',
      endDate: '2026-09-30',
    });
    expect(limited.retryAfterMs).toBe(60_000);
    expect(limited.failedTitles.count).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('calendar repeat loading', () => {
  it('loads a saved library in bounded batches without per-title reads or provider calls', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', { clerkId: 'cached_library' });
      for (let tmdbId = 1; tmdbId <= 125; tmdbId++) {
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
      const schedule = await scheduleFor(asUser, {
        startDate: `2026-${month}-01`,
        endDate: `2026-${month}-30`,
      });
      expect(schedule.events).toHaveLength(125);
      expect(schedule.events.every((event) => event.date === `2026-${month}-02`)).toBe(true);
      expect(schedule.failedTitles.count).toBe(0);
      expect(batchedRead).toHaveBeenCalledTimes(14);
      expect(batchedRead.mock.calls.every(([, args]) => args.keys.length <= 20)).toBe(true);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(individualRead).not.toHaveBeenCalled();
  });

  it('loads every active title across pages, excluding deleting and dropped titles', async () => {
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
    const titles = [];
    let cursor: CalendarCursor | undefined;
    do {
      const page = await t.query(internal.calendar.libraryTitles, {
        userId,
        ...(cursor && { cursor }),
      });
      expect(page.titles.length).toBeLessThanOrEqual(100);
      titles.push(...page.titles);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(titles).toHaveLength(102);
    expect(titles[0].tmdbId).toBe(103);
    expect(titles.at(-1)?.tmdbId).toBe(204);
  });
});
