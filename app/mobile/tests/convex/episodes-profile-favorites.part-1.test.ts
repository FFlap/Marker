import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import schema from '../../convex/schema';
import { api, internal } from '../../convex/_generated/api';
import {
  COORDINATE_CHUNK_PAIR_LIMIT,
  coordinateChunkPairBudget,
  coordinateChunkWindow,
} from '../../convex/nextEpisode';

const modules = import.meta.glob('../../convex/**/*.ts');

afterEach(() => vi.useRealTimers());

async function setup() {
  const t = convexTest(schema, modules);
  const clerkId = 'user_episodes_test';
  const userId = await t.run((ctx) => ctx.db.insert('users', { clerkId }));
  return { t, userId, asUser: t.withIdentity({ subject: clerkId }) };
}

const add = (
  title: string,
  tmdbId: number,
  mediaType: 'movie' | 'tv',
  status: 'watched' | 'watching',
) => ({
  title,
  tmdbId,
  mediaType,
  status,
  timesWatched: status === 'watched' ? 1 : 0,
});

describe('episode hub and profile favorites', () => {
  it('uses the client local date at the release boundary', async () => {
    const { t, asUser } = await setup();
    await t.run(async (ctx) => {
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
        title: 'Release Clock',
        episodeRunTime: [24],
        genres: [],
        cast: [],
        seasons: [{ season: 1, name: 'Season 1', episodeCount: 1 }],
        metadataProvider: 'tmdb',
        refreshedAt: Date.now(),
        refreshAfter: Date.now() + 60_000,
        orderEpoch: 0,
      });
      await ctx.db.insert('resolvedSeasons', {
        tmdbId: 99,
        season: 1,
        metadataProvider: 'tmdb',
        episodeCount: 1,
        chunkCount: 1,
        chunksComplete: true,
        seasonVersion: 'release-boundary',
        refreshedAt: Date.now(),
        refreshAfter: Date.now() + 60_000,
        orderEpoch: 0,
      });
      await ctx.db.insert('resolvedSeasonChunks', {
        tmdbId: 99,
        season: 1,
        orderEpoch: 0,
        seasonVersion: 'release-boundary',
        chunkIndex: 0,
        episodes: [{ season: 1, episode: 1, name: 'Boundary', airDate: '2026-08-11' }],
        refreshedAt: Date.now(),
      });
    });
    await asUser.mutation(api.library.items.addItem, add('Release Clock', 99, 'tv', 'watching'));

    expect((await asUser.query(api.episodeHub.overview, { today: '2026-08-10' })).watching).toEqual(
      [],
    );
    expect(
      (await asUser.query(api.episodeHub.overview, { today: '2026-08-11' })).watching[0]?.name,
    ).toBe('Boundary');
    expect(
      (await asUser.query(api.episodeHub.overview, { today: '2026-08-12' })).watching[0]?.name,
    ).toBe('Boundary');
  });

  it('uses the shared undated release policy and preserves canonical season names', async () => {
    const { t, asUser } = await setup();
    await t.run(async (ctx) => {
      for (const entry of [
        {
          tmdbId: 100,
          title: 'Detailed Undated',
          seasonName: 'Sky Island Arc',
          episode: {
            season: 1,
            episode: 1,
            name: 'The Knock Up Stream',
            overview: 'The crew reaches the sky.',
          },
        },
        {
          tmdbId: 101,
          title: 'Placeholder Undated',
          seasonName: 'Season 1',
          episode: { season: 1, episode: 1, name: 'Episode 1' },
        },
      ]) {
        await ctx.db.insert('titleMappings', {
          tmdbId: entry.tmdbId,
          mediaType: 'tv',
          source: 'auto',
          orderEpoch: 0,
          updatedAt: Date.now(),
        });
        await ctx.db.insert('resolvedTitles', {
          tmdbId: entry.tmdbId,
          mediaType: 'tv',
          title: entry.title,
          episodeRunTime: [24],
          genres: ['Anime'],
          cast: [],
          seasons: [{ season: 1, name: entry.seasonName, episodeCount: 1 }],
          metadataProvider: 'tmdb',
          refreshedAt: Date.now(),
          refreshAfter: Date.now() + 60_000,
          orderEpoch: 0,
        });
        await ctx.db.insert('resolvedSeasons', {
          tmdbId: entry.tmdbId,
          season: 1,
          metadataProvider: 'tmdb',
          episodeCount: 1,
          chunkCount: 1,
          chunksComplete: true,
          seasonVersion: `undated-${entry.tmdbId}`,
          refreshedAt: Date.now(),
          refreshAfter: Date.now() + 60_000,
          orderEpoch: 0,
        });
        await ctx.db.insert('resolvedSeasonChunks', {
          tmdbId: entry.tmdbId,
          season: 1,
          orderEpoch: 0,
          seasonVersion: `undated-${entry.tmdbId}`,
          chunkIndex: 0,
          episodes: [entry.episode],
          refreshedAt: Date.now(),
        });
      }
    });
    const detailedId = await asUser.mutation(
      api.library.items.addItem,
      add('Detailed Undated', 100, 'tv', 'watching'),
    );
    const placeholderId = await asUser.mutation(
      api.library.items.addItem,
      add('Placeholder Undated', 101, 'tv', 'watching'),
    );

    expect((await t.run((ctx) => ctx.db.get(detailedId)))?.nextEpisode).toMatchObject({
      undatedReleased: true,
      seasonName: 'Sky Island Arc',
    });
    expect((await t.run((ctx) => ctx.db.get(placeholderId)))?.nextEpisode).toMatchObject({
      undatedReleased: false,
    });
    expect((await asUser.query(api.episodeHub.overview, { today: '2026-08-11' })).watching).toEqual(
      [
        expect.objectContaining({
          itemId: detailedId,
          name: 'The Knock Up Stream',
          seasonName: 'Sky Island Arc',
        }),
      ],
    );
  });

  it('chains title publication and season reconciliation in ten-item scheduler batches', async () => {
    vi.useFakeTimers();
    const { t } = await setup();
    const itemIds = await t.run(async (ctx) => {
      await ctx.db.insert('titleMappings', {
        tmdbId: 202,
        mediaType: 'tv',
        source: 'auto',
        orderEpoch: 0,
        updatedAt: 1,
      });
      await ctx.db.insert('resolvedTitles', {
        tmdbId: 202,
        mediaType: 'tv',
        title: 'Published Title',
        episodeRunTime: [24],
        genres: [],
        cast: [],
        seasons: [{ season: 1, name: 'Published Arc', episodeCount: 1 }],
        metadataProvider: 'tmdb',
        refreshedAt: 2,
        refreshAfter: 60_002,
        orderEpoch: 0,
      });
      await ctx.db.insert('resolvedSeasons', {
        tmdbId: 202,
        season: 1,
        metadataProvider: 'tmdb',
        episodeCount: 1,
        chunkCount: 1,
        chunksComplete: true,
        seasonVersion: 'published',
        refreshedAt: 2,
        refreshAfter: 60_002,
        orderEpoch: 0,
      });
      await ctx.db.insert('resolvedSeasonChunks', {
        tmdbId: 202,
        season: 1,
        orderEpoch: 0,
        seasonVersion: 'published',
        chunkIndex: 0,
        episodes: [{ season: 1, episode: 1, name: 'Published Episode' }],
        refreshedAt: 2,
      });
      const ids = [];
      for (let index = 0; index < 11; index += 1) {
        const userId = await ctx.db.insert('users', { clerkId: `fanout-${index}` });
        ids.push(
          await ctx.db.insert('items', {
            userId,
            tmdbId: 202,
            mediaType: 'tv',
            title: 'Old Title',
            normalizedTitle: 'old title',
            isAnime: false,
            status: 'watching',
            timesWatched: 0,
            tags: [],
            rank: index,
            createdAt: 1,
            updatedAt: 1,
          }),
        );
      }
      return ids;
    });

    await expect(
      t.mutation(internal.resolvedMetadata.publication.refreshItemProjections, {
        mediaType: 'tv',
        tmdbId: 202,
      }),
    ).resolves.toEqual({ updated: 10, isDone: false });
    expect(
      (await Promise.all(itemIds.map((itemId) => t.run((ctx) => ctx.db.get(itemId))))).filter(
        (item) => item?.title === 'Published Title',
      ),
    ).toHaveLength(10);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect((await t.run((ctx) => ctx.db.get(itemIds[10]!)))?.nextEpisode).toMatchObject({
      seasonName: 'Published Arc',
    });

    await expect(
      t.mutation(internal.episodeSummaries.reconcileSeasonSummaries, {
        tmdbId: 202,
        season: 1,
      }),
    ).resolves.toEqual({ work: 10, isDone: false });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(
      await t.run((ctx) =>
        ctx.db
          .query('episodeSummaries')
          .withIndex('by_item', (query) => query.eq('itemId', itemIds[10]!))
          .unique(),
      ),
    ).not.toBeNull();
  });

  it('bounds each coordinate page while a nearly-complete five-chunk season converges', async () => {
    vi.useFakeTimers();
    const { t } = await setup();
    const itemId = await t.run(async (ctx) => {
      const user = await ctx.db
        .query('users')
        .withIndex('by_clerk_id', (query) => query.eq('clerkId', 'user_episodes_test'))
        .unique();
      const now = Date.now();
      await ctx.db.insert('titleMappings', {
        tmdbId: 203,
        mediaType: 'tv',
        source: 'auto',
        orderEpoch: 0,
        updatedAt: now,
      });
      await ctx.db.insert('resolvedTitles', {
        tmdbId: 203,
        mediaType: 'tv',
        title: 'Long Runner',
        episodeRunTime: [24],
        genres: [],
        cast: [],
        seasons: [{ season: 1, name: 'Long Season', episodeCount: 600 }],
        metadataProvider: 'tmdb',
        refreshedAt: now,
        refreshAfter: now + 60_000,
        orderEpoch: 0,
      });
      await ctx.db.insert('resolvedSeasons', {
        tmdbId: 203,
        season: 1,
        metadataProvider: 'tmdb',
        episodeCount: 600,
        chunkCount: 5,
        chunksComplete: true,
        seasonVersion: 'five-chunks',
        refreshedAt: now,
        refreshAfter: now + 60_000,
        orderEpoch: 0,
      });
      for (let chunkIndex = 0; chunkIndex < 5; chunkIndex += 1) {
        const first = chunkIndex * 120 + 1;
        await ctx.db.insert('resolvedSeasonChunks', {
          tmdbId: 203,
          season: 1,
          orderEpoch: 0,
          seasonVersion: 'five-chunks',
          chunkIndex,
          episodes: Array.from({ length: 120 }, (_, offset) => ({
            season: 1,
            episode: first + offset,
            name: `Episode ${first + offset}`,
          })),
          refreshedAt: now,
        });
      }
      const id = await ctx.db.insert('items', {
        userId: user!._id,
        tmdbId: 203,
        mediaType: 'tv',
        title: 'Long Runner',
        normalizedTitle: 'long runner',
        isAnime: false,
        status: 'watching',
        timesWatched: 0,
        tags: [],
        rank: 0,
        createdAt: now,
        updatedAt: now,
        nextEpisode: { season: 1, episode: 1, chunkIndex: 0, name: 'Visible until done' },
      });
      for (let episode = 1; episode < 600; episode += 1)
        await ctx.db.insert('episodes', {
          userId: user!._id,
          itemId: id,
          season: 1,
          episode,
          watched: true,
          tags: [],
          metadataProvider: 'tmdb',
        });
      await ctx.db.insert('episodeSummaries', {
        userId: user!._id,
        itemId: id,
        season: 1,
        total: 599,
        watchedCount: 599,
        watchedRuntimeMinutes: 0,
        watchedRuntimeFallbackCount: 599,
        tagCounts: [],
        currentIdentityKey: JSON.stringify(['tmdb', null, 0]),
        currentTotal: 600,
        currentWatchedCount: 599,
      });
      return id;
    });

    const firstPage = await t.mutation(internal.nextEpisode.startNextEpisodeRefresh, { itemId });
    expect(firstPage).toMatchObject({
      state: 'continued',
      chunkPairsRead: COORDINATE_CHUNK_PAIR_LIMIT,
    });
    expect((await t.run((ctx) => ctx.db.get(itemId)))?.nextEpisode?.name).toBe(
      'Visible until done',
    );
    expect(
      await t.run((ctx) =>
        ctx.db
          .query('nextEpisodeRefreshes')
          .withIndex('by_item', (query) => query.eq('itemId', itemId))
          .unique(),
      ),
    ).toMatchObject({ season: 1, chunkIndex: 2 });

    const observedWindows = [];
    for (let cursor = 0; cursor < 5;) {
      const window = coordinateChunkWindow(cursor, 5, COORDINATE_CHUNK_PAIR_LIMIT);
      observedWindows.push(window.length);
      cursor = window[window.length - 1]! + 1;
    }
    expect(observedWindows).toEqual([2, 2, 1]);
    expect(Math.max(...observedWindows)).toBe(COORDINATE_CHUNK_PAIR_LIMIT);
    expect(() => coordinateChunkWindow(0, 5, COORDINATE_CHUNK_PAIR_LIMIT + 1)).toThrow(
      'limited to 2 chunks',
    );
    const injectedBudget = coordinateChunkPairBudget(1);
    expect(injectedBudget.canRead()).toBe(true);
    expect(injectedBudget.recordRead()).toBe(1);
    expect(injectedBudget.canRead()).toBe(false);
    expect(() => injectedBudget.recordRead()).toThrow('limited to 1 chunks');

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect((await t.run((ctx) => ctx.db.get(itemId)))?.nextEpisode).toMatchObject({
      season: 1,
      episode: 600,
      chunkIndex: 4,
      name: 'Episode 600',
    });
  });

  it('lets a fast-path watch trigger supersede an older coordinate continuation', async () => {
    vi.useFakeTimers();
    const { t, asUser } = await setup();
    const itemId = await t.run(async (ctx) => {
      const user = await ctx.db
        .query('users')
        .withIndex('by_clerk_id', (query) => query.eq('clerkId', 'user_episodes_test'))
        .unique();
      const now = Date.now();
      await ctx.db.insert('titleMappings', {
        tmdbId: 204,
        mediaType: 'tv',
        source: 'auto',
        orderEpoch: 0,
        updatedAt: now,
      });
      await ctx.db.insert('resolvedTitles', {
        tmdbId: 204,
        mediaType: 'tv',
        title: 'Superseded Runner',
        episodeRunTime: [24],
        genres: [],
        cast: [],
        seasons: [{ season: 1, name: 'Season 1', episodeCount: 482 }],
        metadataProvider: 'tmdb',
        refreshedAt: now,
        refreshAfter: now + 60_000,
        orderEpoch: 0,
      });
      await ctx.db.insert('resolvedSeasons', {
        tmdbId: 204,
        season: 1,
        metadataProvider: 'tmdb',
        episodeCount: 482,
        chunkCount: 5,
        chunksComplete: true,
        seasonVersion: 'superseded-five-chunks',
        refreshedAt: now,
        refreshAfter: now + 60_000,
        orderEpoch: 0,
      });
      for (let chunkIndex = 0; chunkIndex < 5; chunkIndex += 1) {
        const first = chunkIndex * 120 + 1;
        const count = chunkIndex === 4 ? 2 : 120;
        await ctx.db.insert('resolvedSeasonChunks', {
          tmdbId: 204,
          season: 1,
          orderEpoch: 0,
          seasonVersion: 'superseded-five-chunks',
          chunkIndex,
          episodes: Array.from({ length: count }, (_, offset) => ({
            season: 1,
            episode: first + offset,
            name: `Canonical ${first + offset}`,
          })),
          refreshedAt: now,
        });
      }
      const id = await ctx.db.insert('items', {
        userId: user!._id,
        tmdbId: 204,
        mediaType: 'tv',
        title: 'Superseded Runner',
        normalizedTitle: 'superseded runner',
        isAnime: false,
        status: 'watching',
        timesWatched: 0,
        tags: [],
        rank: 0,
        createdAt: now,
        updatedAt: now,
        nextEpisode: {
          season: 1,
          episode: 481,
          name: 'Canonical 481',
        },
      });
      for (let episode = 1; episode <= 480; episode += 1) {
        if (episode === 241) continue;
        await ctx.db.insert('episodes', {
          userId: user!._id,
          itemId: id,
          season: 1,
          episode,
          watched: true,
          tags: [],
          metadataProvider: 'tmdb',
        });
      }
      return id;
    });

    await expect(
      t.mutation(internal.nextEpisode.startNextEpisodeRefresh, { itemId }),
    ).resolves.toMatchObject({ state: 'continued', chunkPairsRead: 2 });
    const olderToken = await t.run(async (ctx) => {
      const row = await ctx.db
        .query('nextEpisodeRefreshes')
        .withIndex('by_item', (query) => query.eq('itemId', itemId))
        .unique();
      return row!.token;
    });

    await asUser.mutation(api.library.episodes.setEpisodeState, {
      itemId,
      season: 1,
      episode: 481,
      watched: true,
    });
    expect((await t.run((ctx) => ctx.db.get(itemId)))?.nextEpisode).toMatchObject({
      episode: 482,
      chunkIndex: 4,
    });
    expect(
      await t.run((ctx) =>
        ctx.db
          .query('nextEpisodeRefreshes')
          .withIndex('by_item', (query) => query.eq('itemId', itemId))
          .unique(),
      ),
    ).toBeNull();

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect((await t.run((ctx) => ctx.db.get(itemId)))?.nextEpisode).toMatchObject({
      episode: 482,
      name: 'Canonical 482',
    });
    expect(olderToken).toMatch(/^coordinate:/);
  });
});
