import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import schema from '../../convex/schema';
import { api, internal } from '../../convex/_generated/api';
import { EPISODES_PER_CHUNK } from '../../convex/seasonStorage';
import { activityDateFromDayNumber, activityDayNumber } from '../../lib/watchActivityStats';
import { putSeason } from './metadata-fixtures';

const modules = import.meta.glob('../../convex/**/*.ts');

afterEach(() => vi.useRealTimers());

async function setup() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-10T02:00:00Z'));
  const t = convexTest({ schema, modules, transactionLimits: true });
  const userId = await t.run((ctx) => ctx.db.insert('users', { clerkId: 'activity-regressions' }));
  const user = t.withIdentity({ subject: 'activity-regressions' });
  const itemId = await user.mutation(api.library.items.addItem, {
    title: 'Watched show',
    tmdbId: 42,
    mediaType: 'tv',
    status: 'watching',
  });
  return { t, userId, user, itemId };
}

it('preserves a manual watch day through sync, metadata edits, and next-day retries', async () => {
  const { t, userId, user, itemId } = await setup();
  const coordinate = { itemId, season: 1, episode: 1 };
  const episodeId = await user.mutation(api.library.episodes.setEpisodeState, {
    ...coordinate,
    watched: true,
    activityDate: '2026-10-09',
  });
  const watchedAt = (await t.run((ctx) => ctx.db.get(episodeId)))!.watchedAt;
  vi.setSystemTime(new Date('2026-10-11T12:00:00Z'));
  for (let retry = 0; retry < 2; retry += 1) {
    await t.mutation(internal.sync.recordWatchInternal, { ...coordinate, userId });
    await user.mutation(api.library.episodes.setEpisodeState, {
      ...coordinate,
      watched: true,
      activityDate: '2026-10-11',
      rating: 4,
      tags: ['favorite'],
    });
  }
  expect(await t.run((ctx) => ctx.db.get(episodeId))).toMatchObject({
    activityDate: '2026-10-09',
    watchedAt,
    watched: true,
  });
  expect((await user.query(api.stats.profile, {})).watchActivity).toEqual([
    { date: '2026-10-09', episodes: 1 },
  ]);
  for (let retry = 0; retry < 2; retry += 1)
    await user.mutation(api.library.episodes.setEpisodeState, { ...coordinate, watched: false });
  expect((await user.query(api.stats.profile, {})).watchActivity).toEqual([]);
  await t.mutation(internal.sync.recordWatchInternal, { ...coordinate, userId });
  expect((await user.query(api.stats.profile, {})).watchActivity).toEqual([]);
  expect(await t.run((ctx) => ctx.db.get(episodeId))).not.toHaveProperty('activityDate');
});

it('keeps mixed logged and historical episodes correct across season batches and restarts', async () => {
  const { t, userId, user, itemId } = await setup();
  const count = EPISODES_PER_CHUNK * 2 + 1;
  await putSeason(t, {
    tmdbId: 42,
    season: 1,
    metadataProvider: 'tmdb',
    orderEpoch: 0,
    refreshedAt: Date.now(),
    refreshAfter: Date.now() + 60_000,
    episodes: Array.from({ length: count }, (_, index) => ({
      season: 1,
      episode: index + 1,
      name: `Episode ${index + 1}`,
    })),
  });
  await t.run(async (ctx) => {
    const dates = new Map<string, number>();
    for (let episode = 1; episode <= count; episode += 1) {
      const date = episode % 3 === 0 ? undefined : episode % 2 === 0 ? '2026-10-09' : '2026-10-10';
      await ctx.db.insert('episodes', {
        userId,
        itemId,
        season: 1,
        episode,
        watched: true,
        tags: [],
        metadataProvider: 'tmdb',
        ...(date && { activityDate: date }),
      });
      if (date) dates.set(date, (dates.get(date) ?? 0) + 1);
    }
    await ctx.db.insert('episodeSummaries', {
      userId,
      itemId,
      season: 1,
      total: count,
      watchedCount: count,
      watchedRuntimeMinutes: 0,
      watchedRuntimeFallbackCount: count,
      tagCounts: [],
    });
    for (const [date, episodes] of dates)
      await ctx.db.insert('watchActivityDays', { userId, date, episodes });
  });
  await user.mutation(api.library.episodes.setEpisodeState, {
    itemId,
    season: 2,
    episode: 1,
    watched: true,
    activityDate: '2026-10-09',
  });
  const firstBatch = {
    userId,
    itemId,
    season: 1,
    watched: false,
    offset: EPISODES_PER_CHUNK,
    expectedRefreshedAt: Date.now() - 1,
    expectedOrderEpoch: 0,
    expectedMetadataProvider: 'tmdb' as const,
  };
  await t.mutation(internal.library.seasonWatched.setSeasonWatchedBatch, firstBatch);
  const afterFirst = (await user.query(api.stats.profile, {})).watchActivity;
  await t.mutation(internal.library.seasonWatched.setSeasonWatchedBatch, firstBatch);
  expect((await user.query(api.stats.profile, {})).watchActivity).toEqual(afterFirst);
  for (let retry = 0; retry < 2; retry += 1)
    await user.action(api.library.seasonWatched.setSeasonWatched, {
      itemId,
      season: 1,
      watched: false,
    });
  expect((await user.query(api.stats.profile, {})).watchActivity).toEqual([
    { date: '2026-10-09', episodes: 1 },
  ]);
  const episodes = await user.query(api.library.episodes.listEpisodes, {
    itemId,
    season: 1,
    pageCount: 3,
  });
  expect(episodes).toHaveLength(count);
  expect(episodes.every((episode) => !episode.watched && episode.activityDate === undefined)).toBe(
    true,
  );
  const summary = await t.run((ctx) =>
    ctx.db
      .query('episodeSummaries')
      .withIndex('by_item', (q) => q.eq('itemId', itemId).eq('season', 1))
      .unique(),
  );
  expect(summary).toMatchObject({ watchedCount: 0, watchedRuntimeFallbackCount: 0 });
});

it('deletes a full batch spread across 500 dates within transaction limits', async () => {
  const { t, userId, user, itemId } = await setup();
  const otherItemId = await user.mutation(api.library.items.addItem, {
    title: 'Keep this show',
    tmdbId: 43,
    mediaType: 'tv',
    status: 'watching',
  });
  const firstDay = activityDayNumber('2025-01-01');
  await t.run(async (ctx) => {
    for (let index = 0; index < 501; index += 1) {
      const date = activityDateFromDayNumber(firstDay + index);
      await ctx.db.insert('episodes', {
        userId,
        itemId,
        season: 1,
        episode: index + 1,
        watched: true,
        tags: [],
        metadataProvider: 'tmdb',
        activityDate: date,
      });
      await ctx.db.insert('watchActivityDays', { userId, date, episodes: index === 0 ? 2 : 1 });
    }
    await ctx.db.insert('episodes', {
      userId,
      itemId: otherItemId,
      season: 1,
      episode: 1,
      watched: true,
      tags: [],
      metadataProvider: 'tmdb',
      activityDate: '2025-01-01',
    });
  });
  await user.mutation(api.library.items.removeItem, { itemId });
  await user.mutation(api.library.items.removeItem, { itemId });
  await expect(t.mutation(internal.library.items.continueRemoveItem, { itemId })).resolves.toEqual({
    deleted: 500,
    done: false,
  });
  expect((await user.query(api.stats.profile, {})).watchActivity).toEqual([
    { date: '2025-01-01', episodes: 1 },
    { date: activityDateFromDayNumber(firstDay + 500), episodes: 1 },
  ]);
  for (let retry = 0; retry < 3; retry += 1)
    await t.mutation(internal.library.items.continueRemoveItem, { itemId });
  expect((await user.query(api.stats.profile, {})).watchActivity).toEqual([
    { date: '2025-01-01', episodes: 1 },
  ]);
  await expect(
    user.mutation(api.library.episodes.setEpisodeState, {
      itemId,
      season: 1,
      episode: 1,
      watched: true,
    }),
  ).rejects.toThrow('Item not found');
});

it('bounds activity reads to the latest 3660 active dates for the requested user', async () => {
  const { t, userId, user } = await setup();
  const today = activityDayNumber('2026-10-10');
  await t.run(async (ctx) => {
    const otherUserId = await ctx.db.insert('users', { clerkId: 'other-history' });
    for (let index = 0; index < 3665; index += 1)
      await ctx.db.insert('watchActivityDays', {
        userId,
        date: activityDateFromDayNumber(today - index),
        episodes: 1,
      });
    await ctx.db.insert('watchActivityDays', {
      userId: otherUserId,
      date: '2026-10-10',
      episodes: 99,
    });
  });
  const activity = (await user.query(api.stats.profile, {})).watchActivity;
  expect(activity).toHaveLength(3660);
  expect(activity[0]).toEqual({ date: activityDateFromDayNumber(today - 3659), episodes: 1 });
  expect(activity.at(-1)).toEqual({ date: '2026-10-10', episodes: 1 });
  expect(activity.every((day) => day.episodes === 1)).toBe(true);
});

it('rejects anonymous or foreign episode writes, bulk unmarks, deletions, and private stats', async () => {
  const { t, user, itemId } = await setup();
  const mark = { itemId, season: 1, episode: 1, watched: true };
  await user.mutation(api.library.episodes.setEpisodeState, mark);
  await t.run((ctx) => ctx.db.insert('users', { clerkId: 'stranger' }));
  const stranger = t.withIdentity({ subject: 'stranger' });
  await expect(t.mutation(api.library.episodes.setEpisodeState, mark)).rejects.toThrow(
    'Authentication required',
  );
  await expect(t.query(api.stats.profile, {})).rejects.toThrow('Authentication required');
  await expect(
    stranger.mutation(api.library.episodes.setEpisodeState, { ...mark, watched: false }),
  ).rejects.toThrow('Item not found');
  await expect(
    stranger.action(api.library.seasonWatched.setSeasonWatched, {
      itemId,
      season: 1,
      watched: false,
    }),
  ).rejects.toThrow('Item not found');
  await expect(stranger.mutation(api.library.items.removeItem, { itemId })).rejects.toThrow(
    'Item not found',
  );
  expect((await user.query(api.stats.profile, {})).watchActivity).toEqual([
    { date: '2026-10-10', episodes: 1 },
  ]);
});
