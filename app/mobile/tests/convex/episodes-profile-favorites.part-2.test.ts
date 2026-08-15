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
  it('repairs saved episode projections independently in 100-row pages', async () => {
    vi.useFakeTimers();
    const { t } = await setup();
    const itemId = await t.run(async (ctx) => {
      const user = await ctx.db
        .query('users')
        .withIndex('by_clerk_id', (query) => query.eq('clerkId', 'user_episodes_test'))
        .unique();
      const now = Date.now();
      await ctx.db.insert('titleMappings', {
        tmdbId: 205,
        mediaType: 'tv',
        source: 'auto',
        orderEpoch: 0,
        updatedAt: now,
      });
      await ctx.db.insert('resolvedTitles', {
        tmdbId: 205,
        mediaType: 'tv',
        title: 'Projection Runner',
        episodeRunTime: [25],
        genres: [],
        cast: [],
        seasons: [{ season: 1, name: 'Corrected Arc', episodeCount: 101 }],
        metadataProvider: 'tmdb',
        refreshedAt: now,
        refreshAfter: now + 60_000,
        orderEpoch: 0,
      });
      await ctx.db.insert('resolvedSeasons', {
        tmdbId: 205,
        season: 1,
        metadataProvider: 'tmdb',
        episodeCount: 101,
        chunkCount: 1,
        chunksComplete: true,
        seasonVersion: 'projection-repair',
        refreshedAt: now,
        refreshAfter: now + 60_000,
        orderEpoch: 0,
      });
      await ctx.db.insert('resolvedSeasonChunks', {
        tmdbId: 205,
        season: 1,
        orderEpoch: 0,
        seasonVersion: 'projection-repair',
        chunkIndex: 0,
        episodes: Array.from({ length: 101 }, (_, offset) => ({
          season: 1,
          episode: offset + 1,
          name: `Corrected ${offset + 1}`,
          runtime: 25,
          imageUrl: `https://images.example/${offset + 1}.jpg`,
        })),
        refreshedAt: now,
      });
      const id = await ctx.db.insert('items', {
        userId: user!._id,
        tmdbId: 205,
        mediaType: 'tv',
        title: 'Projection Runner',
        normalizedTitle: 'projection runner',
        isAnime: false,
        status: 'watching',
        timesWatched: 0,
        tags: [],
        rank: 0,
        createdAt: now,
        updatedAt: now,
        nextEpisode: { season: 1, episode: 77, chunkIndex: 0, name: 'Coordinate untouched' },
      });
      await ctx.db.insert('nextEpisodeRefreshes', {
        itemId: id,
        token: 'independent-coordinate-chain',
        season: 1,
        chunkIndex: 0,
      });
      for (let episode = 1; episode <= 101; episode += 1)
        await ctx.db.insert('episodes', {
          userId: user!._id,
          itemId: id,
          season: 1,
          episode,
          seasonName: 'Old Season',
          name: `Old ${episode}`,
          runtime: 5,
          imageUrl: 'https://images.example/old.jpg',
          watched: true,
          rating: 8,
          tags: [],
          metadataProvider: 'tmdb',
        });
      return id;
    });

    await expect(
      t.mutation(internal.episodeProjectionRepair.startEpisodeProjectionRepair, { itemId }),
    ).resolves.toMatchObject({ state: 'continued', rowsRead: 100, patched: 100 });
    expect(
      await t.run((ctx) =>
        ctx.db
          .query('episodes')
          .withIndex('by_item', (query) =>
            query.eq('itemId', itemId).eq('season', 1).eq('episode', 101),
          )
          .unique(),
      ),
    ).toMatchObject({ name: 'Old 101' });

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(
      await t.run((ctx) =>
        ctx.db
          .query('episodes')
          .withIndex('by_item', (query) =>
            query.eq('itemId', itemId).eq('season', 1).eq('episode', 101),
          )
          .unique(),
      ),
    ).toMatchObject({
      seasonName: 'Corrected Arc',
      name: 'Corrected 101',
      runtime: 25,
      imageUrl: 'https://images.example/101.jpg',
    });
    expect((await t.run((ctx) => ctx.db.get(itemId)))?.nextEpisode?.name).toBe(
      'Coordinate untouched',
    );
    expect(
      await t.run((ctx) =>
        ctx.db
          .query('nextEpisodeRefreshes')
          .withIndex('by_item', (query) => query.eq('itemId', itemId))
          .unique(),
      ),
    ).toMatchObject({ token: 'independent-coordinate-chain' });
  });

  it('maintains the coordinate across watch, unwatch, re-publish, and epoch flips', async () => {
    vi.useFakeTimers();
    const { t, asUser } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert('titleMappings', {
        tmdbId: 37854,
        mediaType: 'tv',
        tvdbId: 81797,
        seasonOrder: 'alttwo',
        source: 'auto',
        orderEpoch: 4,
        updatedAt: Date.now(),
      });
      await ctx.db.insert('resolvedTitles', {
        tmdbId: 37854,
        mediaType: 'tv',
        title: 'One Piece',
        episodeRunTime: [24],
        genres: ['Anime'],
        cast: [],
        seasons: [{ season: 1, name: 'East Blue Arc', episodeCount: 2 }],
        metadataProvider: 'tvdb',
        tvdbId: 81797,
        seasonOrder: 'alttwo',
        refreshedAt: Date.now(),
        refreshAfter: Date.now() + 60_000,
        orderEpoch: 4,
      });
      await ctx.db.insert('resolvedSeasons', {
        tmdbId: 37854,
        season: 1,
        metadataProvider: 'tvdb',
        episodeCount: 2,
        chunkCount: 1,
        chunksComplete: true,
        seasonVersion: 'current',
        refreshedAt: Date.now(),
        refreshAfter: Date.now() + 60_000,
        orderEpoch: 4,
      });
      await ctx.db.insert('resolvedSeasonChunks', {
        tmdbId: 37854,
        season: 1,
        orderEpoch: 4,
        seasonVersion: 'current',
        chunkIndex: 0,
        episodes: [
          {
            season: 1,
            episode: 1,
            name: "I'm Luffy!",
            overview: 'Luffy begins his voyage.',
            imageUrl: 'https://images.example/luffy.jpg',
            airDate: '2026-08-01',
            providerEpisodeId: 101,
          },
          {
            season: 1,
            episode: 2,
            name: 'The Great Swordsman',
            airDate: '2026-08-02',
            providerEpisodeId: 102,
          },
        ],
        refreshedAt: Date.now(),
      });
    });
    const itemId = await asUser.mutation(
      api.library.addItem,
      add('One Piece', 37854, 'tv', 'watching'),
    );

    expect(
      (await asUser.query(api.episodeHub.overview, { today: '2026-08-11' })).watching[0],
    ).toMatchObject({
      itemId,
      season: 1,
      episode: 1,
      seasonName: 'East Blue Arc',
    });
    await asUser.mutation(api.library.setEpisodeState, {
      itemId,
      season: 1,
      episode: 1,
      name: "I'm Luffy!",
      watched: true,
      rating: 9,
      tags: ['Adventure'],
    });
    const advanced = await asUser.query(api.episodeHub.overview, { today: '2026-08-11' });
    expect(advanced.watching[0]).toMatchObject({ episode: 2, name: 'The Great Swordsman' });
    expect(advanced.favorites[0]).toMatchObject({
      itemId,
      episode: 1,
      rating: 9,
      name: "I'm Luffy!",
      seasonName: 'East Blue Arc',
      overview: 'Luffy begins his voyage.',
      imageUrl: 'https://images.example/luffy.jpg',
      tags: ['Adventure'],
    });
    await asUser.mutation(api.library.setEpisodeState, {
      itemId,
      season: 1,
      episode: 1,
      watched: false,
    });
    expect(
      (await asUser.query(api.episodeHub.overview, { today: '2026-08-11' })).watching[0],
    ).toMatchObject({ episode: 1, name: "I'm Luffy!" });
    await asUser.mutation(api.library.setEpisodeState, {
      itemId,
      season: 1,
      episode: 1,
      watched: true,
    });

    await t.mutation(internal.resolvedMetadata.putSeason, {
      tmdbId: 37854,
      season: 1,
      metadataProvider: 'tvdb',
      episodes: [
        { season: 1, episode: 1, name: "I'm Luffy!", providerEpisodeId: 101 },
        {
          season: 1,
          episode: 2,
          name: 'Swordsman Re-published',
          airDate: '2026-08-02',
          providerEpisodeId: 102,
        },
      ],
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
      orderEpoch: 4,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await t.run((ctx) => ctx.db.get(itemId))).toMatchObject({
      nextEpisode: { episode: 2, name: 'Swordsman Re-published' },
    });

    await t.mutation(internal.resolvedMetadata.setTitleMapping, {
      mediaType: 'tv',
      tmdbId: 37854,
      tvdbId: 81797,
      seasonOrder: 'official',
      source: 'manual',
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect((await t.run((ctx) => ctx.db.get(itemId)))?.nextEpisode).toBeUndefined();
    await t.mutation(internal.resolvedMetadata.putTitle, {
      value: {
        tmdbId: 37854,
        mediaType: 'tv',
        title: 'One Piece',
        episodeRunTime: [24],
        genres: ['Anime'],
        cast: [],
        seasons: [{ season: 1, name: 'Official Order', episodeCount: 1 }],
        metadataProvider: 'tvdb',
        tvdbId: 81797,
        seasonOrder: 'official',
        refreshedAt: Date.now(),
        refreshAfter: Date.now() + 60_000,
        orderEpoch: 5,
      },
    });
    await t.mutation(internal.resolvedMetadata.putSeason, {
      tmdbId: 37854,
      season: 1,
      metadataProvider: 'tvdb',
      episodes: [
        {
          season: 1,
          episode: 1,
          name: 'Official First',
          airDate: '2026-08-03',
          providerEpisodeId: 501,
        },
      ],
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
      orderEpoch: 5,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await t.run((ctx) => ctx.db.get(itemId))).toMatchObject({
      nextEpisode: { episode: 1, name: 'Official First', providerEpisodeId: 501 },
    });
  });

  it('only accepts watched titles and preserves user-defined favorite order', async () => {
    const { asUser } = await setup();
    const watching = await asUser.mutation(
      api.library.addItem,
      add('Still Watching', 1, 'tv', 'watching'),
    );
    const first = await asUser.mutation(
      api.library.addItem,
      add('First Movie', 2, 'movie', 'watched'),
    );
    const second = await asUser.mutation(
      api.library.addItem,
      add('Second Movie', 3, 'movie', 'watched'),
    );
    const anime = await asUser.mutation(api.library.addItem, {
      ...add('Favorite Anime', 4, 'tv', 'watched'),
      genres: ['Animation', 'Anime'],
    });
    await asUser.mutation(api.library.addItem, add('Regular TV Show', 5, 'tv', 'watched'));
    await expect(asUser.mutation(api.profileFavorites.add, { itemId: watching })).rejects.toThrow(
      'Only watched titles',
    );
    await asUser.mutation(api.profileFavorites.add, { itemId: first });
    await asUser.mutation(api.profileFavorites.add, { itemId: second });
    await asUser.mutation(api.profileFavorites.reorder, {
      itemId: second,
      afterId: first,
    });
    expect((await asUser.query(api.stats.profile, {})).favorites.map((item) => item.title)).toEqual(
      ['Second Movie', 'First Movie'],
    );
    expect(await asUser.query(api.profileFavorites.eligible, {})).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Favorite Anime', mediaType: 'tv', isAnime: true }),
        expect.objectContaining({ title: 'Regular TV Show', mediaType: 'tv', isAnime: false }),
      ]),
    );
    await asUser.mutation(api.profileFavorites.add, { itemId: anime });
    expect((await asUser.query(api.stats.profile, {})).favorites).toContainEqual(
      expect.objectContaining({ title: 'Favorite Anime', mediaType: 'tv', isAnime: true }),
    );
  });

  it('finds eligible favorites beyond the initial picker page', async () => {
    const { t, userId, asUser } = await setup();
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let index = 0; index < 251; index += 1) {
        const title = `Alpha movie ${String(index).padStart(3, '0')}`;
        await ctx.db.insert('items', {
          userId,
          tmdbId: 10_000 + index,
          mediaType: 'movie',
          title,
          normalizedTitle: title.toLocaleLowerCase(),
          isAnime: false,
          status: 'watched',
          timesWatched: 1,
          tags: [],
          rank: index,
          createdAt: now,
          updatedAt: now,
        });
      }
      await ctx.db.insert('items', {
        userId,
        tmdbId: 20_000,
        mediaType: 'movie',
        title: 'Zulu Search Target',
        normalizedTitle: 'zulu search target',
        isAnime: false,
        status: 'watched',
        timesWatched: 1,
        tags: [],
        rank: 252,
        createdAt: now,
        updatedAt: now,
      });
    });

    expect(await asUser.query(api.profileFavorites.eligible, {})).not.toContainEqual(
      expect.objectContaining({ title: 'Zulu Search Target' }),
    );
    expect(await asUser.query(api.profileFavorites.eligible, { search: 'zulu' })).toContainEqual(
      expect.objectContaining({ title: 'Zulu Search Target' }),
    );
  });
});
