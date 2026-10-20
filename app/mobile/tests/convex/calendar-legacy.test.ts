import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../../convex/_generated/api';
import schema from '../../convex/schema';

const modules = import.meta.glob('../../convex/**/*.ts');
const range = { startDate: '2026-10-01', endDate: '2026-10-31', region: 'US' };

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 1, 12));
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected provider request')));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup(tvCount: number, movieCount: number) {
  const t = convexTest({ schema, modules });
  const userId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { clerkId: 'calendar-legacy-user' });
    for (let index = 0; index < tvCount + movieCount; index++) {
      const mediaType = index < tvCount ? 'tv' : 'movie';
      const tmdbId = index + 1;
      await ctx.db.insert('items', {
        userId,
        tmdbId,
        mediaType,
        title: `Title ${tmdbId}`,
        normalizedTitle: `title ${tmdbId}`,
        isAnime: false,
        status: 'watching',
        timesWatched: 0,
        tags: [],
        rank: index,
        createdAt: 1,
        updatedAt: 1,
      });
      if (mediaType === 'tv') {
        await ctx.db.insert('providerSnapshots', {
          key: `calendar:tv:v2:${tmdbId}`,
          refreshedAt: Date.now(),
          entry: { kind: 'calendarTvSchedule', value: [{ season: 1, airDate: '2026-10-01' }] },
        });
        await ctx.db.insert('providerSnapshots', {
          key: `calendar:season:${tmdbId}:1`,
          refreshedAt: Date.now(),
          entry: {
            kind: 'calendarSeason',
            value: [{ date: '2026-10-12', season: 1, episode: 1, name: 'Pilot' }],
          },
        });
      } else {
        await ctx.db.insert('providerSnapshots', {
          key: `calendar:movie:${tmdbId}:US`,
          refreshedAt: Date.now(),
          entry: { kind: 'calendarMovie', value: [{ date: '2026-10-12', priority: 0 }] },
        });
      }
    }
    return userId;
  });
  return { t, userId, asUser: t.withIdentity({ subject: 'calendar-legacy-user' }) };
}

it('returns both media types in one old-client request without waiting for shared discovery', async () => {
  const { t, asUser } = await setup(21, 1);
  const result = await asUser.action(api.calendar.upcoming, range);
  expect(result.events).toHaveLength(22);
  expect(result.events.filter((event) => event.kind === 'episode')).toHaveLength(21);
  expect(result.events.filter((event) => event.kind === 'movie')).toHaveLength(1);
  expect(result).toMatchObject({ truncated: false, failedTitles: { count: 0, names: [] } });
  expect(await t.run((ctx) => ctx.db.query('calendarMonths').first())).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it('keeps the legacy title bound while excluding dropped, deleting, and other users titles', async () => {
  const { t, userId, asUser } = await setup(0, 103);
  await t.run(async (ctx) => {
    const items = await ctx.db
      .query('items')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .take(3);
    await ctx.db.patch(items[0]._id, { status: 'dropped' });
    await ctx.db.patch(items[1]._id, { deletingAt: Date.now() });
    const otherUser = await ctx.db.insert('users', { clerkId: 'another-user' });
    const { _id: _unusedId, _creationTime: _unusedTime, ...item } = items[2];
    await ctx.db.insert('items', { ...item, userId: otherUser, title: 'Private title' });
  });
  const result = await asUser.action(api.calendar.upcoming, range);
  expect(result.events).toHaveLength(100);
  expect(result.truncated).toBe(true);
  expect(result.events.some((event) => [1, 2].includes(event.tmdbId))).toBe(false);
  expect(result.events.some((event) => event.title === 'Private title')).toBe(false);
  expect(fetch).not.toHaveBeenCalled();
});

it('requires authentication for the compatibility endpoint', async () => {
  const t = convexTest({ schema, modules });
  await expect(t.action(api.calendar.upcoming, range)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
