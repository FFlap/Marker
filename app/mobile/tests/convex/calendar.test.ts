import { convexTest } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';
import schema from '../../convex/schema';
import { api } from '../../convex/_generated/api';

const modules = import.meta.glob('../../convex/**/*.ts');

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
