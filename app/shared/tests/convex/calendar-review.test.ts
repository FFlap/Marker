import { seedCalendarSchedule } from './calendar-fixtures';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../convex/_generated/api';
import schema from '../../convex/schema';

const modules = import.meta.glob('../../convex/**/*.ts');
const now = Date.UTC(2026, 9, 15);
const range = { startDate: '2026-10-01', endDate: '2026-10-31', region: 'CA' };
const episode = {
  id: 'episode:42:1:1:2026-10-20',
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

async function setup(mediaType: 'tv' | 'movie' = 'tv', saved = false) {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { clerkId: 'review' });
    await ctx.db.insert('items', {
      userId,
      mediaType,
      tmdbId: 42,
      title: 'Library title',
      normalizedTitle: 'library title',
      status: 'watchlist',
      isAnime: false,
      timesWatched: 0,
      tags: [],
      rank: 0,
      releaseDate: '2026-10-20',
      createdAt: now,
      updatedAt: now,
    });
    if (saved)
      await seedCalendarSchedule(ctx, {
        key: `CA:2026-10:${mediaType}:42:${mediaType === 'movie' ? '2026-10-20' : ''}`,
        month: '2026-10',
        refreshedAt: now - 7 * 60 * 60_000,
        events:
          mediaType === 'tv'
            ? [episode]
            : [{ id: 'movie:42:2026-10-20', date: '2026-10-20', kind: 'movie' }],
      });
  });
  return { t, viewer: t.withIdentity({ subject: 'review' }) };
}

describe('calendar review regressions', () => {
  it('loads a cold small library without discovery, including episode zero', async () => {
    const episodeNumber = 0;
    const { t, viewer } = await setup();
    const fetch = vi.fn(
      async (input: string) =>
        new Response(
          JSON.stringify(
            input.endsWith('/season/1')
              ? {
                  episodes: [
                    { air_date: episode.date, season_number: 1, episode_number: episodeNumber },
                  ],
                }
              : { seasons: [{ season_number: 1, air_date: '2026-10-01' }] },
          ),
        ),
    );
    vi.stubGlobal('fetch', fetch);
    const saved = await viewer.action(api.calendar.upcoming, { ...range, cachedOnly: true });
    expect(saved).toMatchObject({ events: [], needsRefresh: true });
    expect(fetch).not.toHaveBeenCalled();
    const result = await viewer.action(api.calendar.upcoming, range);
    expect(result.events).toMatchObject([
      { ...episode, episode: episodeNumber, id: `episode:42:1:${episodeNumber}:${episode.date}` },
    ]);
    expect(result.nextCursor).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(([url]) => !url.includes('/discover/'))).toBe(true);
    expect(await t.run((ctx) => ctx.db.query('calendarMonths').collect())).toEqual([]);
    await viewer.action(api.calendar.upcoming, range);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(['title', 'season'])(
    'keeps saved releases when the %s response is malformed',
    async (part) => {
      const { viewer } = await setup('tv', true);
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async (input: string) =>
            new Response(
              JSON.stringify(
                part === 'title' || input.endsWith('/season/1')
                  ? {}
                  : { seasons: [{ season_number: 1 }] },
              ),
            ),
        ),
      );
      const result = await viewer.action(api.calendar.upcoming, range);
      expect(result.events).toMatchObject([episode]);
      expect(result.failedTitles.count).toBe(1);
      expect(
        await viewer.action(api.calendar.upcoming, { ...range, cachedOnly: true }),
      ).toMatchObject({
        events: [episode],
        needsRefresh: true,
      });
    },
  );

  it('removes moved episodes even when a different season fails and the replacement is empty', async () => {
    const { viewer } = await setup('tv', true);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (input: string) =>
          new Response(
            JSON.stringify(
              new URL(input).searchParams.has('append_to_response')
                ? {
                    'season/1': {
                      episodes: [{ air_date: '2026-11-01', season_number: 1, episode_number: 1 }],
                    },
                  }
                : { seasons: [{ season_number: 0 }, { season_number: 1 }] },
            ),
          ),
      ),
    );
    const result = await viewer.action(api.calendar.upcoming, range);
    expect(result.events).toEqual([]);
    expect(result.failedTitles.count).toBe(1);
    expect(
      await viewer.action(api.calendar.upcoming, { ...range, cachedOnly: true }),
    ).toMatchObject({
      events: [],
      needsRefresh: true,
    });
  });

  it('uses a known regional movie date instead of falling back to a different month worldwide', async () => {
    const { t, viewer } = await setup('movie');
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                iso_3166_1: 'CA',
                release_dates: [{ type: 3, release_date: '2026-11-01T00:00:00.000Z' }],
              },
            ],
          }),
        ),
    );
    vi.stubGlobal('fetch', fetch);
    expect((await viewer.action(api.calendar.upcoming, range)).events).toEqual([]);
    expect(
      (
        await viewer.action(api.calendar.upcoming, {
          ...range,
          startDate: '2026-11-01',
          endDate: '2026-11-30',
        })
      ).events,
    ).toMatchObject([{ date: '2026-11-01', kind: 'movie' }]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await t.run((ctx) => ctx.db.query('requestThrottle').first())).toMatchObject({
      count: 1,
    });
  });

  it('does not cache malformed movie releases as an authoritative empty schedule', async () => {
    const { viewer } = await setup('movie', true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ results: {} }))),
    );
    const result = await viewer.action(api.calendar.upcoming, range);
    expect(result.events).toMatchObject([{ kind: 'movie', date: '2026-10-20' }]);
    expect(result.failedTitles.count).toBe(1);
  });
});
