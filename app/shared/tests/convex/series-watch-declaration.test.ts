import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import schema from '../../convex/schema';
import { api, internal } from '../../convex/_generated/api';
import { putSeason } from './metadata-fixtures';

const modules = import.meta.glob('../../convex/**/*.ts');
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function setup(cached = true) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
  const t = convexTest({ schema, modules, transactionLimits: true });
  const userId = await t.run((ctx) => ctx.db.insert('users', { clerkId: 'declare-watch' }));
  const user = t.withIdentity({ subject: 'declare-watch' });
  const itemId = await user.mutation(api.library.items.addItem, {
    tmdbId: 42,
    mediaType: 'tv',
    title: 'Long show',
    status: 'watchlist',
  });
  if (cached) {
    await t.run((ctx) =>
      ctx.db.insert('resolvedTitles', {
        tmdbId: 42,
        mediaType: 'tv',
        title: 'Long show',
        episodeRunTime: [24],
        genres: [],
        cast: [],
        metadataProvider: 'tmdb',
        orderEpoch: 0,
        refreshedAt: Date.now(),
        refreshAfter: Date.now() + 60_000,
        seasons: [{ season: 1, name: 'Season 1', episodeCount: 3, episodeCountVerified: true }],
      }),
    );
    await putSeason(t, {
      tmdbId: 42,
      season: 1,
      metadataProvider: 'tmdb',
      orderEpoch: 0,
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
      episodes: [1, 2, 3].map((episode) => ({
        season: 1,
        episode,
        name: `Episode ${episode}`,
        providerEpisodeId: 100 + episode,
        airDate: '2000-01-01',
        runtime: 24,
        stillPath: '/poster.jpg',
      })),
    });
  }
  const declare = () =>
    user.action(api.library.seasonWatched.moveItemToWatched, {
      itemId,
      activityDate: '2026-11-05',
    });
  const watch = async () => (await t.run((ctx) => ctx.db.get(itemId)))!.seriesWatch!;
  const hydrate = async () => {
    const marker = await watch();
    await t.action(internal.library.seasonWatched.hydrateSeriesWatch, {
      userId,
      itemId,
      generation: marker.generation,
      token: marker.hydrationToken,
      attempt: marker.attempts,
    });
  };
  return { t, userId, user, itemId, declare, watch, hydrate };
}

it('persists an uncached whole-series declaration without making provider requests', async () => {
  const { t, itemId, declare, watch } = await setup(false);
  const fetchMock = vi.fn(() => {
    throw new Error('Provider access must not block saving the mark');
  });
  vi.stubGlobal('fetch', fetchMock);
  await declare();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(await watch()).toMatchObject({
    hydration: 'pending',
    activityDate: '2026-11-05',
    attempts: 0,
  });
  expect((await t.run((ctx) => ctx.db.get(itemId)))?.status).toBe('watched');
  expect(await t.run((ctx) => ctx.db.query('episodes').collect())).toEqual([]);
});

it('returns watched episode views and complete progress before any episode rows are hydrated', async () => {
  const { t, user, itemId, declare } = await setup();
  await declare();
  const episodes = await user.query(api.library.episodes.listEpisodes, { itemId, season: 1 });
  expect(episodes).toHaveLength(3);
  expect(
    episodes.every(
      (episode) =>
        episode.watched && episode._id === undefined && episode.activityDate === '2026-11-05',
    ),
  ).toBe(true);
  expect(await user.query(api.library.episodes.listEpisodeProgress, { itemId })).toMatchObject([
    { season: 1, currentWatchedCount: 3, currentTotal: 3, identityStale: false },
  ]);
  expect(await t.run((ctx) => ctx.db.query('episodes').collect())).toEqual([]);
});

it('preserves a later unwatch and rating while hydrating all remaining episodes', async () => {
  const { t, user, itemId, declare, watch, hydrate } = await setup();
  await declare();
  await user.mutation(api.library.episodes.setEpisodeState, {
    itemId,
    season: 1,
    episode: 2,
    watched: false,
    rating: 4,
    tags: ['Keep'],
  });
  expect(await user.query(api.library.episodes.listEpisodeProgress, { itemId })).toMatchObject([
    { currentWatchedCount: 2 },
  ]);
  await hydrate();
  expect((await watch()).hydration).toBe('complete');
  const episodes = await user.query(api.library.episodes.listEpisodes, { itemId, season: 1 });
  expect(episodes.map((episode) => episode.watched)).toEqual([true, false, true]);
  expect(episodes[1]).toMatchObject({ rating: 4, tags: ['Keep'] });
  expect(await t.run((ctx) => ctx.db.query('watchActivityDays').collect())).toMatchObject([
    { date: '2026-11-05', episodes: 2 },
  ]);
});

it('retains an earlier watch date and does not overwrite a newer library status', async () => {
  const { t, user, itemId, declare, hydrate } = await setup();
  await user.mutation(api.library.episodes.setEpisodeState, {
    itemId,
    season: 1,
    episode: 1,
    watched: true,
    activityDate: '2026-11-05',
  });
  const before = (await t.run((ctx) => ctx.db.query('episodes').first()))!;
  await declare();
  await user.mutation(api.library.ordering.reorderItem, { itemId, status: 'watching' });
  await hydrate();
  expect((await t.run((ctx) => ctx.db.get(itemId)))?.status).toBe('watching');
  expect((await t.run((ctx) => ctx.db.get(before._id)))?.watchedAt).toBe(before.watchedAt);
});

it('ignores superseded hydration and lets a newer declaration reset previous unwatch overrides', async () => {
  const { t, userId, user, itemId, declare, watch, hydrate } = await setup();
  await declare();
  const old = await watch();
  await user.mutation(api.library.episodes.setEpisodeState, {
    itemId,
    season: 1,
    episode: 1,
    watched: false,
  });
  await declare();
  const current = await watch();
  await t.action(internal.library.seasonWatched.hydrateSeriesWatch, {
    userId,
    itemId,
    generation: old.generation,
    token: old.hydrationToken,
    attempt: 0,
  });
  expect((await watch()).generation).toBe(current.generation);
  expect((await watch()).hydration).toBe('pending');
  await hydrate();
  expect(
    (await user.query(api.library.episodes.listEpisodes, { itemId, season: 1 })).every(
      (episode) => episode.watched,
    ),
  ).toBe(true);
});

it('does not mark episodes released after the declaration cutoff during a delayed hydration', async () => {
  const { user, t, itemId, declare, hydrate } = await setup();
  await declare();
  vi.setSystemTime(new Date('2026-11-08T12:00:00Z'));
  await putSeason(t, {
    tmdbId: 42,
    season: 1,
    metadataProvider: 'tmdb',
    orderEpoch: 0,
    refreshedAt: Date.now(),
    refreshAfter: Date.now() + 60_000,
    episodes: [1, 2, 3, 4].map((episode) => ({
      season: 1,
      episode,
      providerEpisodeId: 100 + episode,
      name: `Episode ${episode}`,
      airDate: episode === 4 ? '2026-11-07' : '2000-01-01',
    })),
  });
  await t.run(async (ctx) => {
    const title = (await ctx.db.query('resolvedTitles').first())!;
    await ctx.db.patch(title._id, { refreshAfter: Date.now() + 60_000 });
  });
  await hydrate();
  expect(
    (await user.query(api.library.episodes.listEpisodes, { itemId, season: 1 })).map(
      (episode) => episode.watched,
    ),
  ).toEqual([true, true, true, false]);
});

it('keeps the declaration saved through provider failure and schedules a bounded retry', async () => {
  const { t, itemId, declare, watch, hydrate } = await setup(false);
  await declare();
  await hydrate();
  expect((await t.run((ctx) => ctx.db.get(itemId)))?.status).toBe('watched');
  expect(await watch()).toMatchObject({
    hydration: 'pending',
    attempts: 1,
    retryAt: Date.now() + 1000,
  });
});

it('shows a previously saved released episode as watched while canonical metadata is unavailable', async () => {
  const { t, user, itemId, declare } = await setup(false);
  await user.mutation(api.library.episodes.setEpisodeState, {
    itemId,
    season: 1,
    episode: 1,
    watched: false,
    name: 'Known episode',
    airDate: '2000-01-01',
    rating: 4,
  });
  await declare();
  expect(await user.query(api.library.episodes.listEpisodes, { itemId, season: 1 })).toMatchObject([
    { watched: true, rating: 4 },
  ]);
  expect((await t.run((ctx) => ctx.db.query('episodes').first()))?.watched).toBe(false);
});

it('preserves rating-only edits and season unwatch overrides before hydration', async () => {
  const { t, user, itemId, declare, hydrate } = await setup();
  await declare();
  await user.mutation(api.library.episodes.setEpisodeState, {
    itemId,
    season: 1,
    episode: 1,
    rating: 4,
    tags: ['Keep'],
  });
  expect((await t.run((ctx) => ctx.db.query('episodes').first()))?.watchedAt).toBe(Date.now());
  await user.action(api.library.seasonWatched.setSeasonWatched, {
    itemId,
    season: 1,
    watched: false,
  });
  await hydrate();
  expect(
    (await user.query(api.library.episodes.listEpisodes, { itemId, season: 1 })).map(
      (episode) => episode.watched,
    ),
  ).toEqual([false, false, false]);
  expect(await user.query(api.library.episodes.listEpisodeProgress, { itemId })).toMatchObject([
    { currentWatchedCount: 0, currentTotal: 3 },
  ]);
  expect(await t.run((ctx) => ctx.db.query('episodes').first())).toMatchObject({
    rating: 4,
    tags: ['Keep'],
  });
});

it('recovers a stalled attempt and ignores an older attempt completion', async () => {
  const { t, userId, itemId, declare, watch, hydrate } = await setup();
  await declare();
  const marker = await watch();
  const args = {
    userId,
    itemId,
    generation: marker.generation,
    token: marker.hydrationToken,
    attempt: 0,
  };
  expect(
    await t.mutation(internal.library.seasonWatched.claimSeriesHydration, args),
  ).not.toBeNull();
  expect(await t.mutation(internal.library.seasonWatched.claimSeriesHydration, args)).toBeNull();
  const leaseUntil = (await watch()).leaseUntil!;
  vi.setSystemTime(new Date(leaseUntil));
  await t.mutation(internal.library.seasonWatched.recoverSeriesHydration, { ...args, leaseUntil });
  expect(await watch()).toMatchObject({ attempts: 1, hydration: 'pending' });
  await t.mutation(internal.library.seasonWatched.finishSeriesHydration, {
    ...args,
    succeeded: true,
  });
  expect((await watch()).hydration).toBe('pending');
  // The metadata fixture's 60-second freshness window is separate from the declaration.
  await t.run(async (ctx) => {
    const title = (await ctx.db.query('resolvedTitles').first())!;
    const season = (await ctx.db.query('resolvedSeasons').first())!;
    await ctx.db.patch(title._id, { refreshAfter: Date.now() + 60_000 });
    await ctx.db.patch(season._id, { refreshAfter: Date.now() + 60_000 });
  });
  await hydrate();
  expect((await watch()).hydration).toBe('complete');
});

it('resumes hydration for newly discovered past episodes and fences the older callback', async () => {
  const { t, userId, user, itemId, declare, watch, hydrate } = await setup();
  await declare();
  await hydrate();
  const old = await watch();
  vi.setSystemTime(new Date(Date.now() + 10));
  await putSeason(t, {
    tmdbId: 42,
    season: 1,
    metadataProvider: 'tmdb',
    orderEpoch: 0,
    refreshedAt: Date.now(),
    refreshAfter: Date.now() + 60_000,
    episodes: [1, 2, 3, 4].map((episode) => ({
      season: 1,
      episode,
      name: `Episode ${episode}`,
      providerEpisodeId: 100 + episode,
      airDate: '2000-01-01',
    })),
  });
  await t.mutation(internal.library.seasonWatched.resumeSeriesWatch, {
    itemId,
    refreshedAt: Date.now(),
  });
  expect(await watch()).toMatchObject({ hydration: 'pending' });
  await t.mutation(internal.library.seasonWatched.finishSeriesHydration, {
    userId,
    itemId,
    generation: old.generation,
    token: old.hydrationToken,
    attempt: 0,
    succeeded: false,
  });
  expect((await watch()).attempts).toBe(0);
  await hydrate();
  expect((await watch()).hydration).toBe('complete');
  expect(
    (await user.query(api.library.episodes.listEpisodes, { itemId, season: 1 })).map(
      (episode) => episode.watched,
    ),
  ).toEqual([true, true, true, true]);
});

it('does not overwrite a newer episode edit when its provider identity changes during hydration', async () => {
  const { t, user, itemId, declare, watch, hydrate } = await setup();
  await declare();
  const savedId = await user.mutation(api.library.episodes.setEpisodeState, {
    itemId,
    season: 1,
    episode: 1,
    watched: false,
    rating: 4,
    tags: ['Keep'],
  });
  const saved = await t.run((ctx) => ctx.db.get(savedId));
  await putSeason(t, {
    tmdbId: 42,
    season: 1,
    metadataProvider: 'tmdb',
    orderEpoch: 0,
    refreshedAt: Date.now() + 1,
    refreshAfter: Date.now() + 60_000,
    episodes: [1, 2, 3].map((episode) => ({
      season: 1,
      episode,
      name: `Episode ${episode}`,
      providerEpisodeId: episode === 1 ? 999 : 100 + episode,
      airDate: '2000-01-01',
    })),
  });
  await hydrate();
  expect(await watch()).toMatchObject({ hydration: 'pending', attempts: 1 });
  expect(await t.run((ctx) => ctx.db.get(savedId))).toEqual(saved);
  expect(
    (await user.query(api.library.episodes.listEpisodes, { itemId, season: 1 }))[0],
  ).toMatchObject({ watched: true, providerEpisodeId: 999, tags: [] });
});

it('selects a later explicit unwatch as next episode while all other declared episodes stay watched', async () => {
  const { t, user, itemId, declare } = await setup();
  await declare();
  await user.mutation(api.library.episodes.setEpisodeState, {
    itemId,
    season: 1,
    episode: 2,
    watched: false,
  });
  expect((await t.run((ctx) => ctx.db.get(itemId)))?.nextEpisode).toMatchObject({
    season: 1,
    episode: 2,
  });
  await user.mutation(api.library.episodes.setEpisodeState, {
    itemId,
    season: 1,
    episode: 2,
    watched: true,
  });
  expect((await t.run((ctx) => ctx.db.get(itemId)))?.nextEpisode).toBeUndefined();
});

it('rejects another user before saving a declaration or scheduling hydration', async () => {
  const { t, itemId } = await setup(false);
  await t.run((ctx) => ctx.db.insert('users', { clerkId: 'other-watch-user' }));
  const other = t.withIdentity({ subject: 'other-watch-user' });
  await expect(
    other.action(api.library.seasonWatched.moveItemToWatched, { itemId }),
  ).rejects.toThrow('Item not found');
  expect((await t.run((ctx) => ctx.db.get(itemId)))?.seriesWatch).toBeUndefined();
  expect((await t.run((ctx) => ctx.db.get(itemId)))?.status).toBe('watchlist');
});

it('keeps the declared date when extension sync materializes an implicitly watched episode', async () => {
  const { t, userId, user, itemId, declare, watch, hydrate } = await setup();
  await declare();
  const marker = await watch();
  const sync = () =>
    t.mutation(internal.sync.recordWatchInternal, { userId, itemId, season: 1, episode: 1 });
  await sync();
  await sync();
  expect(await t.run((ctx) => ctx.db.query('episodes').first())).toMatchObject({
    watchedAt: marker.watchedAt,
    activityDate: '2026-11-05',
  });
  await hydrate();
  expect((await user.query(api.stats.profile, {})).watchActivity).toEqual([
    { date: '2026-11-05', episodes: 3 },
  ]);
});

it('clears the negative progress override when extension playback follows an explicit unwatch', async () => {
  const { t, userId, user, itemId, declare, hydrate } = await setup();
  await declare();
  await user.mutation(api.library.episodes.setEpisodeState, {
    itemId,
    season: 1,
    episode: 2,
    watched: false,
    rating: 4,
    tags: ['Keep'],
  });
  expect(await user.query(api.library.episodes.listEpisodeProgress, { itemId })).toMatchObject([
    { currentWatchedCount: 2 },
  ]);
  await t.mutation(internal.sync.recordWatchInternal, { userId, itemId, season: 1, episode: 2 });
  expect(await user.query(api.library.episodes.listEpisodeProgress, { itemId })).toMatchObject([
    { currentWatchedCount: 3 },
  ]);
  await hydrate();
  expect(
    (await user.query(api.library.episodes.listEpisodes, { itemId, season: 1 }))[1],
  ).toMatchObject({ watched: true, rating: 4, tags: ['Keep'] });
  // Synced history keeps its existing no-invented-day policy; only the two
  // episodes materialized from the manual declaration contribute to that day.
  expect((await user.query(api.stats.profile, {})).watchActivity).toEqual([
    { date: '2026-11-05', episodes: 2 },
  ]);
});

it('keeps a season unwatch authoritative over pre-existing unwatched rows', async () => {
  const { user, itemId, declare, hydrate } = await setup();
  await user.mutation(api.library.episodes.setEpisodeState, {
    itemId,
    season: 1,
    episode: 1,
    watched: false,
  });
  await declare();
  await user.action(api.library.seasonWatched.setSeasonWatched, {
    itemId,
    season: 1,
    watched: false,
  });
  const states = () => user.query(api.library.episodes.listEpisodes, { itemId, season: 1 });
  expect((await states()).map((episode) => episode.watched)).toEqual([false, false, false]);
  await hydrate();
  expect((await states()).map((episode) => episode.watched)).toEqual([false, false, false]);
});
