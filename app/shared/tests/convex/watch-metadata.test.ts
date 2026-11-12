import { convexTest } from 'convex-test';
import { expect, it } from 'vitest';
import schema from '../../convex/schema';
import { publishWatchMetadataFromSnapshots } from '../../convex/library/watchMetadata';
import { api, internal } from '../../convex/_generated/api';

const modules = import.meta.glob('../../convex/**/*.ts');

async function setup() {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const userId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { clerkId: 'watch-metadata' });
    await ctx.db.insert('titleMappings', {
      tmdbId: 42,
      mediaType: 'tv',
      tvdbId: 99,
      seasonOrder: 'official',
      source: 'auto',
      orderEpoch: 0,
      updatedAt: Date.now(),
    });
    await ctx.db.insert('resolvedTitles', {
      tmdbId: 42,
      mediaType: 'tv',
      title: 'Snapshot show',
      episodeRunTime: [24],
      genres: [],
      cast: [],
      metadataProvider: 'tvdb',
      tvdbId: 99,
      seasonOrder: 'official',
      orderEpoch: 0,
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
      seasons: [1, 2].map((season) => ({
        season,
        name: `Season ${season}`,
        episodeCount: season === 1 ? 2 : 1,
        episodeCountVerified: false,
      })),
    });
    await ctx.db.insert('providerSnapshots', {
      key: 'tvdb:catalog:v1:99:official:eng',
      refreshedAt: Date.now(),
      entry: { kind: 'tvdbCatalog', value: { generation: 'catalog', chunks: 1, count: 3 } },
    });
    await ctx.db.insert('providerSnapshots', {
      key: 'tvdb:season:catalog:catalog:0',
      refreshedAt: Date.now(),
      entry: {
        kind: 'episodes',
        value: [
          {
            id: 901,
            providerEpisodeId: 901,
            season: 1,
            episode: 1,
            name: 'Canonical',
            airDate: '2000-01-01',
          },
          {
            id: 902,
            providerEpisodeId: 902,
            season: 1,
            episode: 2,
            name: 'Future',
            airDate: '2099-01-01',
          },
          {
            id: 903,
            providerEpisodeId: 903,
            season: 2,
            episode: 1,
            name: 'Next season',
            airDate: '2000-01-01',
          },
        ],
      },
    });
    for (const season of [1, 2])
      await ctx.db.insert('providerSnapshots', {
        key: `tmdb:season:42:${season}`,
        refreshedAt: Date.now(),
        entry: {
          kind: 'episodes',
          value: [
            {
              providerEpisodeId: 1000 + season,
              season,
              episode: 1,
              name: 'TMDB name',
              airDate: '2000-01-01',
              imageUrl: 'https://image.test/episode.jpg',
            },
          ],
        },
      });
    return userId;
  });
  const user = t.withIdentity({ subject: 'watch-metadata' });
  const itemId = await user.mutation(api.library.items.addItem, {
    tmdbId: 42,
    mediaType: 'tv',
    title: 'Snapshot show',
    status: 'watchlist',
  });
  return { t, userId, user, itemId };
}

it('publishes complete canonical seasons, filters future episodes and retains TVDB identity', async () => {
  const { t, userId, itemId } = await setup();
  expect(
    await t.mutation((ctx) => publishWatchMetadataFromSnapshots(ctx, { userId, itemId })),
  ).toBe(true);
  const season = await t.query(internal.resolvedMetadata.reads.readSeason, {
    tmdbId: 42,
    season: 1,
  });
  expect(season).toMatchObject({
    chunksComplete: true,
    episodeCount: 1,
    metadataProvider: 'tvdb',
    orderEpoch: 0,
  });
  expect(season?.episodes).toEqual([
    {
      providerEpisodeId: 901,
      season: 1,
      episode: 1,
      name: 'Canonical',
      airDate: '2000-01-01',
      imageUrl: 'https://image.test/episode.jpg',
    },
  ]);
  expect(
    (
      await t.query(internal.resolvedMetadata.reads.readTitle, { tmdbId: 42, mediaType: 'tv' })
    )?.seasons.map((season) => [season.episodeCount, season.episodeCountVerified]),
  ).toEqual([
    [1, true],
    [1, true],
  ]);
});

it.each([
  'lease',
  'request',
  'missing snapshot',
  'stale mapping',
  'unlisted released season',
] as const)('falls back without publishing when blocked by %s', async (reason) => {
  const { t, userId, itemId } = await setup();
  await t.run(async (ctx) => {
    if (reason === 'lease')
      await ctx.db.insert('metadataRefreshLeases', {
        key: 'metadata:tv:42',
        token: 'other-writer',
        expiresAt: Date.now() + 60_000,
      });
    if (reason === 'request')
      await ctx.db.insert('metadataRefreshRequests', {
        key: 'season:42:1',
        state: 'inFlight',
        lastRequestedAt: Date.now(),
        attemptToken: 'force-touch',
        expiresAt: Date.now() + 60_000,
      });
    if (reason === 'missing snapshot') {
      const snapshot = await ctx.db
        .query('providerSnapshots')
        .withIndex('by_key', (q) => q.eq('key', 'tmdb:season:42:2'))
        .unique();
      await ctx.db.delete(snapshot!._id);
    }
    if (reason === 'unlisted released season') {
      const title = (await ctx.db.query('resolvedTitles').first())!;
      await ctx.db.patch(title._id, { seasons: title.seasons.slice(0, 1) });
    }
    if (reason === 'stale mapping') {
      const mapping = (await ctx.db.query('titleMappings').first())!;
      await ctx.db.patch(mapping._id, { orderEpoch: 1 });
    }
  });
  expect(
    await t.mutation((ctx) => publishWatchMetadataFromSnapshots(ctx, { userId, itemId })),
  ).toBe(false);
  expect(await t.run((ctx) => ctx.db.query('resolvedSeasons').collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query('resolvedSeasonChunks').collect())).toEqual([]);
});

it('rolls back metadata, episode writes and history together if the status move fails', async () => {
  const { t, userId, user, itemId } = await setup();
  const neighbor = await user.mutation(api.library.items.addItem, {
    tmdbId: 43,
    mediaType: 'movie',
    title: 'Wrong status',
    status: 'watchlist',
  });
  const history = await t.run((ctx) => ctx.db.query('activityEvents').collect());
  await expect(
    t.mutation(internal.library.seasonWatched.finishWatchedFromSnapshots, {
      userId,
      itemId,
      activityDate: '2026-11-06',
      beforeId: neighbor,
    }),
  ).rejects.toThrow('Neighbors must share a status');
  expect(await t.run((ctx) => ctx.db.query('resolvedSeasons').collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query('episodes').collect())).toEqual([]);
  expect(await t.run((ctx) => ctx.db.query('activityEvents').collect())).toEqual(history);
  expect((await t.run((ctx) => ctx.db.get(itemId)))?.status).toBe('watchlist');
});
