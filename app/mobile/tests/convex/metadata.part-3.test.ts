import { afterEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { api, internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import { isTruncatedSnapshot, putNonFatal } from '../../convex/providerSnapshots';
import { MAX_METADATA_MUTATION_BYTES, serializedBytes } from '../../convex/seasonStorage';
import { mapSeasonDetails } from '../../convex/tmdb';
import { commitWatchWithOneRematch } from '../../convex/sync';
import { titleWriteForCapturedTitle } from '../../convex/resolvedMetadata/seasonResolution';

const modules = import.meta.glob('../../convex/**/*.ts');

async function setup(transactionLimits = false) {
  const t = convexTest({ schema, modules, transactionLimits });
  const clerkId = 'user_metadata_test';
  const userId = await t.run((ctx) => ctx.db.insert('users', { clerkId }));
  const asUser = t.withIdentity({ subject: clerkId });
  return { t, userId, asUser };
}

const movieTitle = (overrides: Record<string, unknown> = {}) => ({
  tmdbId: 77,
  mediaType: 'movie' as const,
  title: 'Stored movie',
  episodeRunTime: [],
  genres: [],
  cast: [],
  seasons: [],
  metadataProvider: 'tmdb' as const,
  orderEpoch: 0,
  refreshedAt: Date.now(),
  refreshAfter: Date.now() + 60_000,
  ...overrides,
});

const addItem = (asUser: Awaited<ReturnType<typeof setup>>['asUser'], tmdbId = 88) =>
  asUser.mutation(api.library.items.addItem, {
    tmdbId,
    mediaType: 'tv',
    title: 'Stored show',
    status: 'watching',
  });

describe('metadata pipeline', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    [1, 2],
    [2, 1],
  ])(
    'preserves both season title patches when season %i commits before season %i',
    async (firstSeason, secondSeason) => {
      const order = [firstSeason, secondSeason];
      const { t } = await setup();
      const capturedTitle = {
        ...movieTitle({
          tmdbId: 88,
          mediaType: 'tv',
          title: 'Concurrent show',
          seasons: [
            { season: 1, name: 'Season 1', episodeCount: 1 },
            { season: 2, name: 'Season 2', episodeCount: 1 },
          ],
        }),
        mediaType: 'tv' as const,
      };
      await t.run((ctx) => ctx.db.insert('resolvedTitles', capturedTitle));

      for (const season of order) {
        const attemptToken = `season-${season}`;
        const key = `season:88:${season}`;
        const leaseToken = `lease-${season}`;
        await t.run((ctx) =>
          ctx.db.insert('metadataRefreshRequests', {
            key,
            state: 'inFlight',
            lastRequestedAt: Date.now(),
            attemptToken,
            expiresAt: Date.now() + 60_000,
          }),
        );
        await t.mutation(internal.resolvedMetadata.requests.claimRefresh, {
          key: 'metadata:tv:88',
          token: leaseToken,
          leaseMs: 60_000,
        });
        const episodeCount = season === 1 ? 2 : 3;
        const episodes = Array.from({ length: episodeCount }, (_, index) => ({
          season,
          episode: index + 1,
          name: `S${season}E${index + 1}`,
        }));
        await expect(
          t.mutation(internal.resolvedMetadata.publication.commitRefresh, {
            title: capturedTitle,
            titleWrite: 'seasonPatch',
            season: {
              tmdbId: 88,
              season,
              metadataProvider: 'tmdb',
              chunks: [episodes],
              episodeCount,
              chunkCount: 1,
              refreshedAt: Date.now(),
              refreshAfter: Date.now() + 60_000,
              orderEpoch: 0,
            },
            outcomes: [{ key, state: 'succeeded' }],
            attemptToken,
            leaseKey: 'metadata:tv:88',
            leaseToken,
          }),
        ).resolves.toBe(true);
        await t.mutation(internal.resolvedMetadata.requests.releaseRefresh, {
          key: 'metadata:tv:88',
          token: leaseToken,
        });
      }

      expect(
        await t.query(internal.resolvedMetadata.reads.readTitle, { mediaType: 'tv', tmdbId: 88 }),
      ).toMatchObject({
        seasons: [
          { season: 1, episodeCount: 2 },
          { season: 2, episodeCount: 3 },
        ],
      });
    },
  );

  it('keeps current rows on page one after a 120-episode numbering shift', async () => {
    const { t, userId, asUser } = await setup();
    const itemId = await addItem(asUser);
    await t.mutation(internal.resolvedMetadata.requests.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: Array.from({ length: 120 }, (_, index) => ({
        season: 1,
        episode: index + 101,
        name: `Current ${index + 101}`,
        providerEpisodeId: 10_000 + index,
      })),
      refreshedAt: 200,
      refreshAfter: 200 + 60_000,
      orderEpoch: 0,
    });
    await t.run(async (ctx) => {
      for (let episode = 1; episode <= 220; episode += 1)
        await ctx.db.insert('episodes', {
          userId,
          itemId,
          season: 1,
          episode,
          watched: true,
          tags: [],
          metadataProvider: 'tmdb',
          providerEpisodeId: episode < 101 ? episode : 10_000 + (episode - 101),
        });
    });

    const page = await asUser.query(api.library.episodes.listEpisodes, { itemId, season: 1 });
    expect(page).toHaveLength(120);
    expect(page[0]?.episode).toBe(101);
    expect(page.at(-1)?.episode).toBe(220);
  });

  it('enforces the public episode coordinate ceiling', async () => {
    const { asUser } = await setup();
    const itemId = await addItem(asUser);
    await expect(
      asUser.mutation(api.library.episodes.setEpisodeState, { itemId, season: 10_001, episode: 1 }),
    ).rejects.toThrow('Season must be an integer between 0 and 10000');
    await expect(
      asUser.mutation(api.library.episodes.setEpisodeState, { itemId, season: 1, episode: 10_001 }),
    ).rejects.toThrow('Episode must be an integer between 0 and 10000');
  });

  it('reads only one canonical chunk per max-size season-watch batch', async () => {
    const { t, userId, asUser } = await setup(true);
    const itemId = await addItem(asUser);
    const refreshedAt = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert('titleMappings', {
        tmdbId: 88,
        mediaType: 'tv',
        source: 'auto',
        orderEpoch: 0,
        updatedAt: refreshedAt,
      });
      await ctx.db.insert('resolvedSeasons', {
        tmdbId: 88,
        season: 1,
        metadataProvider: 'tmdb',
        episodeCount: 6_000,
        chunkCount: 50,
        chunksComplete: true,
        seasonVersion: 'max-size-season',
        refreshedAt,
        refreshAfter: refreshedAt + 60_000,
        orderEpoch: 0,
      });
    });
    for (let chunkIndex = 0; chunkIndex < 50; chunkIndex += 1)
      await t.run((ctx) =>
        ctx.db.insert('resolvedSeasonChunks', {
          tmdbId: 88,
          season: 1,
          orderEpoch: 0,
          seasonVersion: 'max-size-season',
          chunkIndex,
          refreshedAt,
          episodes: Array.from({ length: 120 }, (_, index) => ({
            season: 1,
            episode: chunkIndex * 120 + index + 1,
            name: '界'.repeat(300),
            overview: '界'.repeat(400),
            imageUrl: '界'.repeat(500),
            airDate: '2'.repeat(50),
          })),
        }),
      );

    await expect(
      t.mutation(internal.library.seasonWatched.setSeasonWatchedBatch, {
        userId,
        itemId,
        season: 1,
        watched: true,
        offset: 0,
        expectedRefreshedAt: refreshedAt,
        expectedOrderEpoch: 0,
        expectedMetadataProvider: 'tmdb',
      }),
    ).resolves.toMatchObject({ processed: 120, episodeCount: 6_000 });
  });

  it('keeps episode summaries exact across single writes, season batches, and sync writes', async () => {
    const { t, userId, asUser } = await setup(true);
    const itemId = await addItem(asUser);
    await t.run((ctx) =>
      ctx.db.insert('titleMappings', {
        tmdbId: 88,
        mediaType: 'tv',
        source: 'auto',
        orderEpoch: 0,
        updatedAt: Date.now(),
      }),
    );
    await t.mutation(internal.resolvedMetadata.requests.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: Array.from({ length: 3 }, (_, index) => ({
        season: 1,
        episode: index + 1,
        name: `Episode ${index + 1}`,
        providerEpisodeId: 101 + index,
      })),
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
      orderEpoch: 0,
    });

    await asUser.mutation(api.library.episodes.setEpisodeState, {
      itemId,
      season: 1,
      episode: 1,
      watched: true,
    });
    await expect(
      asUser.query(api.library.episodes.listEpisodeProgress, { itemId }),
    ).resolves.toEqual([
      {
        season: 1,
        total: 1,
        watchedCount: 1,
        currentTotal: 3,
        currentWatchedCount: 1,
        identityStale: false,
      },
    ]);
    await asUser.mutation(api.library.episodes.setEpisodeState, {
      itemId,
      season: 1,
      episode: 1,
      watched: false,
    });
    await expect(
      asUser.action(api.library.seasonWatched.setSeasonWatched, {
        itemId,
        season: 1,
        watched: true,
      }),
    ).resolves.toEqual({ processed: 3 });
    await expect(
      asUser.action(api.library.seasonWatched.setSeasonWatched, {
        itemId,
        season: 1,
        watched: false,
      }),
    ).resolves.toEqual({ processed: 3 });
    await t.mutation(internal.sync.recordWatchInternal, {
      userId,
      itemId,
      season: 1,
      episode: 2,
      matchedOrderEpoch: 0,
      matchedProvider: 'tmdb',
    });
    await t.mutation(internal.sync.recordWatchInternal, {
      userId,
      itemId,
      season: 2,
      episode: 1,
    });

    await expect(
      asUser.query(api.library.episodes.listEpisodeProgress, { itemId }),
    ).resolves.toEqual([
      {
        season: 1,
        total: 3,
        watchedCount: 1,
        currentTotal: 3,
        currentWatchedCount: 1,
        identityStale: false,
      },
      {
        season: 2,
        total: 1,
        watchedCount: 1,
        currentTotal: 0,
        currentWatchedCount: 0,
        identityStale: true,
      },
    ]);
    await expect(t.run((ctx) => ctx.db.query('episodeSummaries').collect())).resolves.toMatchObject(
      [
        { itemId, season: 1, total: 3, watchedCount: 1 },
        { itemId, season: 2, total: 1, watchedCount: 1 },
      ],
    );
  });

  it('reads an episode page from the current indexed identity despite bounded stale history', async () => {
    const { t, userId, asUser } = await setup();
    const itemId = await addItem(asUser);
    await t.mutation(internal.resolvedMetadata.requests.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: [{ season: 1, episode: 500, name: 'Current', providerEpisodeId: 500 }],
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
      orderEpoch: 0,
    });
    await t.run(async (ctx) => {
      for (let episode = 1; episode <= 400; episode += 1)
        await ctx.db.insert('episodes', {
          userId,
          itemId,
          season: 1,
          episode,
          watched: true,
          tags: [],
          metadataProvider: 'tvdb',
          seasonOrder: 'official',
        });
      await ctx.db.insert('episodes', {
        userId,
        itemId,
        season: 1,
        episode: 500,
        watched: true,
        tags: [],
        metadataProvider: 'tmdb',
        providerEpisodeId: 500,
      });
    });

    await expect(
      asUser.query(api.library.episodes.listEpisodes, { itemId, season: 1 }),
    ).resolves.toMatchObject([{ episode: 500, watched: true, metadataProvider: 'tmdb' }]);
  });

  it('preserves current counters across an unchanged successful season refresh', async () => {
    vi.useFakeTimers();
    const { t, asUser } = await setup(true);
    const itemId = await addItem(asUser);
    const canonical = [1, 2].map((episode) => ({
      season: 1,
      episode,
      name: `Episode ${episode}`,
      providerEpisodeId: 100 + episode,
    }));
    await t.mutation(internal.resolvedMetadata.requests.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: canonical,
      refreshedAt: 100,
      refreshAfter: 100 + 60_000,
      orderEpoch: 0,
    });
    for (const episode of [1, 2])
      await asUser.mutation(api.library.episodes.setEpisodeState, {
        itemId,
        season: 1,
        episode,
        watched: true,
      });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await t.mutation(internal.resolvedMetadata.requests.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: canonical,
      refreshedAt: 200,
      refreshAfter: 200 + 60_000,
      orderEpoch: 0,
    });
    await expect(
      asUser.query(api.library.episodes.listEpisodeProgress, { itemId }),
    ).resolves.toMatchObject([{ currentTotal: 2, currentWatchedCount: 2, identityStale: false }]);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(
      asUser.query(api.library.episodes.listEpisodeProgress, { itemId }),
    ).resolves.toMatchObject([{ currentTotal: 2, currentWatchedCount: 2, identityStale: false }]);
  });

  it('rebuilds current counters exactly after the stable provider/order identity changes', async () => {
    vi.useFakeTimers();
    const { t, asUser } = await setup(true);
    const itemId = await addItem(asUser);
    const canonical = [1, 2].map((episode) => ({
      season: 1,
      episode,
      name: `Episode ${episode}`,
      providerEpisodeId: 200 + episode,
    }));
    await t.mutation(internal.resolvedMetadata.requests.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: canonical,
      refreshedAt: 100,
      refreshAfter: 100 + 60_000,
      orderEpoch: 0,
    });
    for (const episode of [1, 2])
      await asUser.mutation(api.library.episodes.setEpisodeState, {
        itemId,
        season: 1,
        episode,
        watched: true,
      });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await t.run(async (ctx) => {
      const mapping = await ctx.db
        .query('titleMappings')
        .withIndex('by_tmdb', (query) => query.eq('mediaType', 'tv').eq('tmdbId', 88))
        .unique();
      await ctx.db.patch(mapping!._id, { orderEpoch: 1, updatedAt: 200 });
    });
    await t.mutation(internal.resolvedMetadata.requests.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: canonical,
      refreshedAt: 200,
      refreshAfter: 200 + 60_000,
      orderEpoch: 1,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(
      asUser.query(api.library.episodes.listEpisodeProgress, { itemId }),
    ).resolves.toMatchObject([{ currentTotal: 2, currentWatchedCount: 2, identityStale: false }]);
  });

  it('continues a season batch after a same-epoch canonical refresh interleaves', async () => {
    const { t, asUser } = await setup(true);
    const itemId = await addItem(asUser);
    const episodes = Array.from({ length: 1_200 }, (_, index) => ({
      season: 1,
      episode: index + 1,
      name: `Episode ${index + 1}`,
    }));
    await t.mutation(internal.resolvedMetadata.requests.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes,
      refreshedAt: 100,
      refreshAfter: 100 + 60_000,
      orderEpoch: 0,
    });

    const plan = await t.query(internal.library.seasonWatched.getSeasonWatchedPlan, {
      userId: (await t.run((ctx) => ctx.db.get(itemId)))!.userId,
      itemId,
      season: 1,
      watched: true,
    });
    const first = await t.mutation(internal.library.seasonWatched.setSeasonWatchedBatch, {
      userId: (await t.run((ctx) => ctx.db.get(itemId)))!.userId,
      itemId,
      season: 1,
      watched: true,
      offset: 0,
      expectedRefreshedAt: plan.refreshedAt,
      expectedOrderEpoch: plan.orderEpoch,
      expectedMetadataProvider: plan.metadataProvider,
    });
    expect(first.processed).toBe(120);
    await t.mutation(internal.resolvedMetadata.requests.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: [{ season: 1, episode: 0, name: 'Inserted correction' }, ...episodes],
      refreshedAt: 200,
      refreshAfter: 200 + 60_000,
      orderEpoch: 0,
    });
    const restarted = await t.mutation(internal.library.seasonWatched.setSeasonWatchedBatch, {
      userId: (await t.run((ctx) => ctx.db.get(itemId)))!.userId,
      itemId,
      season: 1,
      watched: true,
      offset: 120,
      expectedRefreshedAt: plan.refreshedAt,
      expectedOrderEpoch: plan.orderEpoch,
      expectedMetadataProvider: plan.metadataProvider,
    });
    expect(restarted).toMatchObject({ processed: 120, restarted: true, episodeCount: 1_201 });

    await expect(
      asUser.action(api.library.seasonWatched.setSeasonWatched, { itemId, season: 1 }),
    ).resolves.toEqual({ processed: 1_201 });
    const saved = await asUser.query(api.library.episodes.listEpisodes, {
      itemId,
      season: 1,
      pageCount: 11,
    });
    expect(saved).toHaveLength(1_201);
    expect(saved.some((episode) => episode.episode === 0 && episode.watched)).toBe(true);
  });

  it('garbage-collects only old unreferenced canonical titles', async () => {
    const { t, asUser } = await setup();
    await addItem(asUser, 88);
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await t.run(async (ctx) => {
      await ctx.db.insert('resolvedTitles', movieTitle({ tmdbId: 77, refreshedAt: old }));
      await ctx.db.insert('resolvedTitles', movieTitle({ tmdbId: 78, refreshedAt: Date.now() }));
      await ctx.db.insert('resolvedTitles', {
        ...movieTitle({ tmdbId: 88, mediaType: 'tv', refreshedAt: old }),
        mediaType: 'tv',
      });
    });
    await expect(
      t.mutation(internal.resolvedMetadata.cleanup.pruneCanonicalData, { phase: 'titles' }),
    ).resolves.toMatchObject({ deleted: 1 });
    const ids = await t.run(async (ctx) =>
      (await ctx.db.query('resolvedTitles').collect()).map((row) => row.tmdbId),
    );
    expect(ids).toEqual(expect.arrayContaining([78, 88]));
    expect(ids).not.toContain(77);
  });

  it('namespaces canonical title references by media type during garbage collection', async () => {
    const { t, asUser } = await setup();
    await asUser.mutation(api.library.items.addItem, {
      tmdbId: 77,
      mediaType: 'movie',
      title: 'Referenced movie',
      status: 'watchlist',
    });
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await t.run(async (ctx) => {
      await ctx.db.insert('resolvedTitles', movieTitle({ tmdbId: 77, refreshedAt: old }));
      await ctx.db.insert('resolvedTitles', {
        ...movieTitle({ tmdbId: 77, mediaType: 'tv', refreshedAt: old }),
        mediaType: 'tv',
      });
    });

    await expect(
      t.mutation(internal.resolvedMetadata.cleanup.pruneCanonicalData, { phase: 'titles' }),
    ).resolves.toMatchObject({ deleted: 1 });
    await expect(
      t.query(internal.resolvedMetadata.reads.readTitle, { mediaType: 'movie', tmdbId: 77 }),
    ).resolves.toMatchObject({ title: 'Stored movie' });
    await expect(
      t.query(internal.resolvedMetadata.reads.readTitle, { mediaType: 'tv', tmdbId: 77 }),
    ).resolves.toBeNull();
  });

  it('seeds title and season snapshots at the active mapping epoch', async () => {
    const { t, asUser } = await setup();
    await addItem(asUser);
    await asUser.mutation(api.library.items.addItem, {
      tmdbId: 77,
      mediaType: 'movie',
      title: 'Seeded movie fallback',
      status: 'watchlist',
    });
    await t.run(async (ctx) => {
      await ctx.db.insert('titleMappings', {
        tmdbId: 88,
        mediaType: 'tv',
        tvdbId: 808,
        seasonOrder: 'dvd',
        source: 'manual',
        orderEpoch: 4,
        updatedAt: Date.now(),
      });
      await ctx.db.insert('providerSnapshots', {
        key: 'tmdb:tv:full:88',
        entry: {
          kind: 'tmdbTv',
          value: {
            id: 88,
            title: 'Seeded show',
            mediaType: 'tv',
            genres: [],
            cast: [],
            seasons: [{ season: 1, name: 'Season 1', episodeCount: 1 }],
            episodeRunTime: [24],
          },
        },
        refreshedAt: Date.now(),
      });
      await ctx.db.insert('providerSnapshots', {
        key: 'tmdb:season:88:1',
        entry: {
          kind: 'episodes',
          value: [{ season: 1, episode: 1, name: 'Seeded episode' }],
        },
        refreshedAt: Date.now(),
      });
      await ctx.db.insert('providerSnapshots', {
        key: 'tmdb:movie:77',
        entry: {
          kind: 'tmdbMovie',
          value: { id: 77, title: 'Seeded movie', mediaType: 'movie', genres: [], cast: [] },
        },
        refreshedAt: Date.now(),
      });
    });

    await expect(
      t.action(internal.resolvedMetadata.seed.seedFromProviderSnapshots, {}),
    ).resolves.toMatchObject({ found: 2, seeded: 2 });
    await expect(
      t.query(internal.resolvedMetadata.reads.readTitle, { mediaType: 'tv', tmdbId: 88 }),
    ).resolves.toMatchObject({ title: 'Seeded show', orderEpoch: 4 });
    await expect(
      t.query(internal.resolvedMetadata.reads.readSeason, { tmdbId: 88, season: 1 }),
    ).resolves.toMatchObject({ orderEpoch: 4, episodes: [{ name: 'Seeded episode' }] });
    await expect(
      t.query(internal.resolvedMetadata.reads.readTitleMapping, { mediaType: 'movie', tmdbId: 77 }),
    ).resolves.toMatchObject({ source: 'auto', orderEpoch: 0 });
    await expect(
      t.query(internal.resolvedMetadata.reads.readTitle, { mediaType: 'movie', tmdbId: 77 }),
    ).resolves.toMatchObject({ title: 'Seeded movie', orderEpoch: 0 });
  });
});
