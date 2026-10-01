import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';

const modules = import.meta.glob('../../convex/**/*.ts');
const today = '2026-10-01';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'test-only');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert('users', { clerkId: 'watcher' }));
  const asUser = t.withIdentity({ subject: 'watcher' });
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    const season = path.match(/\/season\/(\d+)$/u)?.[1];
    return Response.json(
      season
        ? {
            season_number: Number(season),
            episodes: [
              {
                id: Number(season) * 100,
                episode_number: 1,
                name: `Premiere ${season}`,
                air_date: '2026-09-01',
                runtime: 24,
              },
            ],
          }
        : {
            id: 88,
            name: 'Two seasons',
            genres: [],
            seasons: [1, 2].map((number) => ({
              season_number: number,
              name: `Season ${number}`,
              episode_count: 1,
            })),
          },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  const settle = () => t.finishAllScheduledFunctions(() => vi.runAllTimers());
  const overview = () => asUser.query(api.episodeHub.overview, { today });
  return { t, asUser, userId, fetchMock, settle, overview };
}

describe('watching entries own their episode loading', () => {
  it.each(['add', 'status change'] as const)(
    'loads a cold show after %s without opening details',
    async (entry) => {
      const { asUser, settle, overview, fetchMock } = await setup();
      const itemId = await asUser.mutation(api.library.items.addItem, {
        tmdbId: 88,
        mediaType: 'tv',
        title: 'Two seasons',
        status: entry === 'add' ? 'watching' : 'watchlist',
      });
      if (entry === 'status change') {
        await settle();
        expect(fetchMock).not.toHaveBeenCalled();
        await asUser.mutation(api.library.items.updateItem, { itemId, status: 'watching' });
      }
      await settle();
      expect((await overview()).watching).toMatchObject([
        { itemId, season: 1, episode: 1, name: 'Premiere 1' },
      ]);
      expect(fetchMock.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
        '/3/tv/88',
        '/3/tv/88/season/1',
      ]);
    },
  );

  it('advances into an unloaded season and keeps detail watch state in sync both ways', async () => {
    const { asUser, t, settle, overview } = await setup();
    const itemId = await asUser.mutation(api.library.items.addItem, {
      tmdbId: 88,
      mediaType: 'tv',
      title: 'Two seasons',
      status: 'watching',
    });
    await settle();
    expect(await t.run((ctx) => ctx.db.query('resolvedSeasons').collect())).toHaveLength(1);
    await asUser.mutation(api.library.episodes.setEpisodeState, {
      itemId,
      season: 1,
      episode: 1,
      watched: true,
    });
    await settle();
    expect((await overview()).watching).toMatchObject([{ itemId, season: 2, episode: 1 }]);
    expect(
      await asUser.query(api.library.episodes.listEpisodes, { itemId, season: 1 }),
    ).toMatchObject([{ episode: 1, watched: true }]);
    await asUser.mutation(api.library.episodes.setEpisodeState, {
      itemId,
      season: 2,
      episode: 1,
      watched: true,
    });
    await settle();
    expect((await overview()).watching).toEqual([]);
    await asUser.mutation(api.library.episodes.setEpisodeState, {
      itemId,
      season: 1,
      episode: 1,
      watched: false,
    });
    expect((await overview()).watching).toMatchObject([{ itemId, season: 1, episode: 1 }]);
    await settle();
  });

  it('repairs existing watching rows on tab refresh, scoped to the signed-in user and debounced', async () => {
    const { t, asUser, userId, settle, overview } = await setup();
    const otherId = await t.run((ctx) => ctx.db.insert('users', { clerkId: 'other-watcher' }));
    await t.run(async (ctx) => {
      for (const owner of [userId, otherId]) {
        await ctx.db.insert('items', {
          userId: owner,
          tmdbId: owner === userId ? 88 : 99,
          title: 'Existing',
          normalizedTitle: 'existing',
          mediaType: 'tv',
          status: 'watching',
          timesWatched: 0,
          tags: [],
          isAnime: false,
          rank: 0,
          createdAt: 1,
          updatedAt: 1,
        });
      }
      // The series after these movies must be reached by a scheduled page.
      for (let rank = 1; rank <= 10; rank += 1) {
        await ctx.db.insert('items', {
          userId,
          tmdbId: 100 + rank,
          title: 'Movie',
          normalizedTitle: 'movie',
          mediaType: 'movie',
          status: 'watching',
          timesWatched: 0,
          tags: [],
          isAnime: false,
          rank,
          createdAt: 1,
          updatedAt: 1,
        });
      }
      await ctx.db.insert('items', {
        userId,
        tmdbId: 89,
        title: 'Last series',
        normalizedTitle: 'last series',
        mediaType: 'tv',
        status: 'watching',
        timesWatched: 0,
        tags: [],
        isAnime: false,
        rank: 11,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    await expect(t.mutation(api.episodeHub.refreshWatching, {})).rejects.toThrow(
      'Authentication required',
    );
    await asUser.mutation(api.episodeHub.refreshWatching, {});
    await asUser.mutation(api.episodeHub.refreshWatching, {});
    const pending = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect());
    expect(pending.filter((job) => job.name.includes('startNextEpisodeRefresh'))).toHaveLength(1);
    await settle();
    expect((await overview()).watching).toHaveLength(2);
    const otherItem = await t.run((ctx) =>
      ctx.db
        .query('items')
        .withIndex('by_user', (q) => q.eq('userId', otherId))
        .unique(),
    );
    expect(otherItem?.nextEpisode).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.query('resolvedTitles').collect())).toHaveLength(2);
  });

  it('keeps a saved watch when provider admission is rate limited', async () => {
    const { t, asUser, userId, settle } = await setup();
    const itemId = await asUser.mutation(api.library.items.addItem, {
      tmdbId: 88,
      mediaType: 'tv',
      title: 'Two seasons',
      status: 'watching',
    });
    await settle();
    await t.run(async (ctx) => {
      const budget = await ctx.db
        .query('requestThrottle')
        .withIndex('by_key', (q) => q.eq('key', `metadata-touch:${userId}`))
        .unique();
      await ctx.db.patch(budget!._id, { count: 60, windowStart: Date.now() });
    });
    await asUser.mutation(api.library.episodes.setEpisodeState, {
      itemId,
      season: 1,
      episode: 1,
      watched: true,
    });
    await expect(
      t.mutation(internal.nextEpisode.requestMissingMetadata, { itemId, season: 2 }),
    ).rejects.toThrow();
    expect(
      await asUser.query(api.library.episodes.listEpisodes, { itemId, season: 1 }),
    ).toMatchObject([{ watched: true }]);
    await settle();
  });

  it('does not load queued metadata after a show leaves watching', async () => {
    const { asUser, settle, fetchMock, overview } = await setup();
    const itemId = await asUser.mutation(api.library.items.addItem, {
      tmdbId: 88,
      mediaType: 'tv',
      title: 'Two seasons',
      status: 'watching',
    });
    await asUser.mutation(api.library.items.updateItem, { itemId, status: 'watchlist' });
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await overview()).watching).toEqual([]);
  });
});
