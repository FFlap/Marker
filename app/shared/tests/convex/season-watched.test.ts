import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { v } from 'convex/values';
import * as episodeFunctions from '../../convex/library/episodes';
import { api, internal } from '../../convex/_generated/api';
import { internalAction } from '../../convex/_generated/server';
import schema from '../../convex/schema';
import { putSeason, hydrateDeclaredWatch } from './metadata-fixtures';

const modules = import.meta.glob('../../convex/**/*.ts');

afterEach(() => vi.useRealTimers());

async function setup(change: 'order' | 'grow' | 'missing') {
  const resolved: number[] = [];
  const t = convexTest(schema, {
    ...modules,
    '../../convex/resolvedMetadata/seasonResolution.ts': async () => ({
      resolveSeasonForUser: internalAction({
        args: { userId: v.id('users'), tmdbId: v.number(), season: v.number() },
        returns: v.array(v.object({ season: v.number(), episode: v.number(), name: v.string() })),
        handler: async (_ctx, { tmdbId, season }) => {
          resolved.push(season);
          await t.run(async (ctx) => {
            const title = (await ctx.db.query('resolvedTitles').first())!;
            if (change === 'missing') {
              await ctx.db.delete(title._id);
            } else if (change === 'grow') {
              await ctx.db.patch(title._id, {
                seasons: [
                  ...title.seasons,
                  { episodeCountVerified: true, season: season + 1, name: 'New', episodeCount: 1 },
                ],
              });
            } else if (season === 2) {
              const mapping = (await ctx.db.query('titleMappings').first())!;
              await ctx.db.patch(mapping._id, { orderEpoch: 1 });
              await ctx.db.patch(title._id, { orderEpoch: 1 });
            }
          });
          const epoch = change === 'order' && resolved.includes(2) ? 1 : 0;
          const episodes = Array.from({ length: epoch + 1 }, (_, index) => ({
            season,
            episode: index + 1,
            name: `Episode ${index + 1}`,
          }));
          await putSeason(t, {
            tmdbId,
            season,
            metadataProvider: 'tmdb',
            episodes,
            orderEpoch: epoch,
            refreshedAt: Date.now(),
            refreshAfter: Date.now() + 60_000,
          });
          return episodes;
        },
      }),
    }),
  });
  await t.run(async (ctx) => {
    await ctx.db.insert('users', { clerkId: 'watch-seasons' });
    await ctx.db.insert('titleMappings', {
      tmdbId: 99,
      mediaType: 'tv',
      source: 'auto',
      orderEpoch: 0,
      updatedAt: Date.now(),
    });
    await ctx.db.insert('resolvedTitles', {
      tmdbId: 99,
      mediaType: 'tv',
      title: 'Changing show',
      episodeRunTime: [],
      genres: [],
      cast: [],
      seasons: (change === 'order' ? [1, 2] : [1]).map((season) => ({
        episodeCountVerified: true,
        season,
        name: `Season ${season}`,
        episodeCount: 1,
      })),
      metadataProvider: 'tmdb',
      orderEpoch: 0,
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
    });
  });
  const user = t.withIdentity({ subject: 'watch-seasons' });
  const itemId = await user.mutation(api.library.items.addItem, {
    tmdbId: 99,
    mediaType: 'tv',
    title: 'Changing show',
    status: 'watchlist',
  });
  return { t, user, itemId, resolved };
}

it('revisits completed seasons when the episode order changes during a whole-show update', async () => {
  const { t, user, itemId, resolved } = await setup('order');
  await user.action(api.library.seasonWatched.moveItemToWatched, { itemId });
  expect((await hydrateDeclaredWatch(t, itemId))?.hydration).toBe('complete');
  expect(resolved).toEqual([1, 2, 1]);
  for (const season of [1, 2]) {
    const episodes = await user.query(api.library.episodes.listEpisodes, { itemId, season });
    expect(episodes).toHaveLength(2);
    expect(episodes.every((episode) => episode.watched)).toBe(true);
  }
  expect((await user.query(api.library.items.listItems, {}))[0].status).toBe('watched');
});

it('preserves the declaration and retries when new seasons exhaust the hydration follow-up limit', async () => {
  const { t, user, itemId, resolved } = await setup('grow');
  await user.action(api.library.seasonWatched.moveItemToWatched, { itemId });
  expect(await hydrateDeclaredWatch(t, itemId)).toMatchObject({
    hydration: 'pending',
    attempts: 1,
  });
  expect(resolved).toEqual([1, 2, 3]);
  expect((await user.query(api.library.items.listItems, {}))[0].status).toBe('watched');
});

it('keeps the declaration when metadata disappears during hydration', async () => {
  const { t, user, itemId } = await setup('missing');
  await user.action(api.library.seasonWatched.moveItemToWatched, { itemId });
  expect(await hydrateDeclaredWatch(t, itemId)).toMatchObject({
    hydration: 'pending',
    attempts: 1,
  });
  expect((await user.query(api.library.items.listItems, {}))[0].status).toBe('watched');
});

async function setupCachedShow() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
  const t = convexTest({ schema, modules, transactionLimits: true });
  const userId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { clerkId: 'cached-show' });
    await ctx.db.insert('resolvedTitles', {
      tmdbId: 99,
      mediaType: 'tv',
      title: 'Cached show',
      episodeRunTime: [],
      genres: [],
      cast: [],
      seasons: [1, 2, 3].map((season) => ({
        season,
        name: `Season ${season}`,
        episodeCount: season === 3 ? 3 : 120,
        episodeCountVerified: true,
      })),
      metadataProvider: 'tmdb',
      orderEpoch: 0,
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
    });
    return userId;
  });
  const user = t.withIdentity({ subject: 'cached-show' });
  const itemId = await user.mutation(api.library.items.addItem, {
    tmdbId: 99,
    mediaType: 'tv',
    title: 'Cached show',
    status: 'watchlist',
  });
  for (const season of [1, 2, 3]) {
    await putSeason(t, {
      tmdbId: 99,
      season,
      metadataProvider: 'tmdb',
      orderEpoch: 0,
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
      episodes: Array.from({ length: season === 3 ? 3 : 120 }, (_, index) => ({
        season,
        episode: index + 1,
        name: `Episode ${index + 1}`,
        runtime: 24,
      })),
    });
    await user.action(api.library.seasonWatched.setSeasonWatched, {
      itemId,
      season,
      activityDate: '2026-10-31',
    });
  }
  await user.mutation(api.library.episodes.setEpisodeState, {
    itemId,
    season: 3,
    episode: 3,
    watched: false,
    rating: 4,
    tags: ['Favorite'],
  });
  return { t, userId, user, itemId };
}

it('finishes a mostly watched cached show without provider actions or rewriting watched episodes', async () => {
  const { t, user, itemId } = await setupCachedShow();
  const before = await t.run((ctx) => ctx.db.query('episodes').collect());
  const writes = vi.spyOn(episodeFunctions, 'setEpisode');
  try {
    await user.action(api.library.seasonWatched.moveItemToWatched, {
      itemId,
      activityDate: '2026-11-01',
    });
    expect(writes).not.toHaveBeenCalled();
    expect((await hydrateDeclaredWatch(t, itemId))?.hydration).toBe('complete');
    expect(writes).toHaveBeenCalledTimes(1);
  } finally {
    writes.mockRestore();
  }
  const after = await t.run((ctx) => ctx.db.query('episodes').collect());
  expect(after.filter((e) => e.watched)).toHaveLength(243);
  for (const episode of before.filter((e) => e.watched))
    expect(after.find((e) => e._id === episode._id)).toEqual(episode);
  expect(after.find((e) => e.season === 3 && e.episode === 3)).toMatchObject({
    rating: 4,
    tags: ['Favorite'],
    activityDate: '2026-11-01',
  });
  expect((await user.query(api.library.items.listItems, {}))[0]).toMatchObject({
    status: 'watched',
    timesWatched: 1,
  });
  expect((await user.query(api.stats.profile, {})).watchActivity).toEqual([
    { date: '2026-10-31', episodes: 242 },
    { date: '2026-11-01', episodes: 1 },
  ]);
  const repeat = vi.spyOn(episodeFunctions, 'setEpisode');
  try {
    await user.action(api.library.seasonWatched.moveItemToWatched, { itemId });
    expect((await hydrateDeclaredWatch(t, itemId))?.hydration).toBe('complete');
    expect(repeat).not.toHaveBeenCalled();
  } finally {
    repeat.mockRestore();
  }
});

it('falls back without changing episodes or status when cached metadata expires', async () => {
  const { t, userId, user, itemId } = await setupCachedShow();
  await t.run(async (ctx) => {
    const season = (await ctx.db.query('resolvedSeasons').first())!;
    await ctx.db.patch(season._id, { refreshAfter: 0 });
  });
  const before = await t.run((ctx) => ctx.db.query('episodes').collect());
  expect(
    await t.mutation(internal.library.seasonWatched.tryMoveCachedItemToWatched, {
      userId,
      itemId,
      activityDate: '2026-11-01',
    }),
  ).toBeNull();
  expect(await t.run((ctx) => ctx.db.query('episodes').collect())).toEqual(before);
  expect((await user.query(api.library.items.listItems, {}))[0].status).toBe('watchlist');
});

it('repairs completed summaries from an earlier season version instead of skipping their episodes', async () => {
  const { t, userId, itemId } = await setupCachedShow();
  await t.run(async (ctx) => {
    const summary = (await ctx.db.query('episodeSummaries').first())!;
    await ctx.db.patch(summary._id, { currentSeasonVersion: 'old-version' });
  });
  const writes = vi.spyOn(episodeFunctions, 'setEpisode');
  try {
    const rank = await t.mutation(internal.library.seasonWatched.tryMoveCachedItemToWatched, {
      userId,
      itemId,
      activityDate: '2026-11-01',
    });
    expect(rank).not.toBeNull();
    expect(writes).toHaveBeenCalledTimes(121);
  } finally {
    writes.mockRestore();
  }
  const summary = await t.run((ctx) => ctx.db.query('episodeSummaries').first());
  expect(summary?.rebuildSeasonVersion).toBeDefined();
  expect(summary?.rebuildSeasonVersion).not.toBe('old-version');
});

it('aggregates sparse episode updates while preserving ratings, tags and exact runtime counters', async () => {
  const t = convexTest({ schema, modules, transactionLimits: true });
  await t.run((ctx) => ctx.db.insert('users', { clerkId: 'sparse-watch' }));
  const user = t.withIdentity({ subject: 'sparse-watch' });
  const itemId = await user.mutation(api.library.items.addItem, {
    tmdbId: 99,
    mediaType: 'tv',
    title: 'Sparse show',
    status: 'watchlist',
  });
  await user.mutation(api.library.episodes.setEpisodeState, {
    itemId,
    season: 1,
    episode: 1,
    watched: true,
    runtime: 15,
    rating: 4,
    tags: ['Keep'],
  });
  await user.mutation(api.library.episodes.setEpisodeState, {
    itemId,
    season: 1,
    episode: 1000,
    watched: true,
  });
  const before = await t.run((ctx) => ctx.db.query('episodes').collect());
  await putSeason(t, {
    tmdbId: 99,
    season: 1,
    metadataProvider: 'tmdb',
    orderEpoch: 0,
    refreshedAt: Date.now(),
    refreshAfter: Date.now() + 60_000,
    episodes: [1, 1000, 2000].map((episode, index) => ({
      season: 1,
      episode,
      name: `Episode ${episode}`,
      runtime: (index + 2) * 15,
    })),
  });
  await user.action(api.library.seasonWatched.setSeasonWatched, { itemId, season: 1 });
  const saved = await t.run((ctx) => ctx.db.query('episodes').collect());
  expect(saved).toHaveLength(3);
  expect(saved.every((episode) => episode.watched)).toBe(true);
  expect(saved.find((episode) => episode.episode === 1)).toMatchObject({
    rating: 4,
    tags: ['Keep'],
    watchedAt: before.find((episode) => episode.episode === 1)!.watchedAt,
  });
  expect(await t.run((ctx) => ctx.db.query('episodeSummaries').first())).toMatchObject({
    total: 3,
    watchedCount: 3,
    watchedRuntimeMinutes: 135,
    watchedRuntimeFallbackCount: 0,
    tagCounts: [{ tag: 'Keep', count: 1 }],
  });
});

it('atomically commits 2,000 episodes, exact profile counters and the retained finish event', async () => {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const userId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { clerkId: 'atomic-watch' });
    await ctx.db.insert('resolvedTitles', {
      tmdbId: 99,
      mediaType: 'tv',
      title: 'Long series',
      episodeRunTime: [24],
      genres: [],
      cast: [],
      seasons: [{ season: 1, name: 'Season 1', episodeCount: 2000, episodeCountVerified: true }],
      metadataProvider: 'tmdb',
      orderEpoch: 0,
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
    });
    return userId;
  });
  const user = t.withIdentity({ subject: 'atomic-watch' });
  const itemId = await user.mutation(api.library.items.addItem, {
    tmdbId: 99,
    mediaType: 'tv',
    title: 'Long series',
    status: 'watchlist',
  });
  await putSeason(t, {
    tmdbId: 99,
    season: 1,
    metadataProvider: 'tmdb',
    orderEpoch: 0,
    refreshedAt: Date.now(),
    refreshAfter: Date.now() + 60_000,
    episodes: Array.from({ length: 2000 }, (_, index) => ({
      season: 1,
      episode: index + 1,
      name: `Episode ${index + 1}`,
      runtime: 24,
    })),
  });
  await t.run(async (ctx) => {
    for (const refresh of await ctx.db.query('profileStatsRefreshes').collect())
      await ctx.db.delete(refresh._id);
    await ctx.db.insert('profileStats', {
      userId,
      totalWatchMinutes: 0,
      episodesWatched: 0,
      moviesWatched: 0,
      showsWatched: 0,
      totalItems: 1,
      ratingTotal: 0,
      ratingCount: 0,
      topTags: [],
      tagCounts: [],
      updatedAt: Date.now(),
    });
  });
  expect(
    await t.mutation(internal.library.seasonWatched.tryMoveCachedItemToWatched, {
      userId,
      itemId,
      activityDate: new Date().toISOString().slice(0, 10),
    }),
  ).not.toBeNull();
  const episodes = await t.run((ctx) => ctx.db.query('episodes').collect());
  expect(episodes).toHaveLength(2000);
  expect(episodes.every((episode) => episode.watched)).toBe(true);
  expect(await t.run((ctx) => ctx.db.query('profileStats').first())).toMatchObject({
    totalWatchMinutes: 48000,
    episodesWatched: 2000,
    showsWatched: 1,
    totalItems: 1,
  });
  expect(await t.run((ctx) => ctx.db.query('episodeSummaries').first())).toMatchObject({
    currentWatchedCount: 2000,
    watchedCount: 2000,
    watchedRuntimeMinutes: 48000,
  });
  const history = await t.run((ctx) =>
    ctx.db
      .query('activityEvents')
      .withIndex('by_actor_time', (q) => q.eq('userId', userId))
      .order('desc')
      .collect(),
  );
  expect(history).toHaveLength(200);
  expect(history[0]).toMatchObject({ kind: 'finished', itemId });
  expect(history.filter((event) => event.kind === 'episode')).toHaveLength(199);
  expect(await t.run((ctx) => ctx.db.query('watchActivityDays').first())).toMatchObject({
    episodes: 2000,
  });
  expect((await t.run((ctx) => ctx.db.get(itemId)))?.status).toBe('watched');
});
