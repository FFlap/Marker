import { afterEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { api, internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import { isTruncatedSnapshot, putNonFatal } from '../../convex/providerSnapshots';
import { MAX_METADATA_MUTATION_BYTES, serializedBytes } from '../../convex/seasonStorage';
import { mapSeasonDetails } from '../../convex/tmdb';
import { commitWatchWithOneRematch } from '../../convex/sync';
import {
  resolveFreshSeason,
  titleWriteForCapturedTitle,
} from '../../convex/resolvedMetadata/seasonResolution';

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
  it('keeps a populated season when the secondary provider fails and the primary is empty', async () => {
    const providerError = new Error('TMDB unavailable');
    const runAction = vi.fn().mockRejectedValueOnce(providerError).mockResolvedValueOnce([]);
    const current = {
      episodes: [{ season: 1, episode: 1, name: 'Existing episode' }],
    } as any;

    await expect(
      resolveFreshSeason(
        { runAction } as any,
        { tmdbId: 88, season: 1 },
        { metadataProvider: 'tvdb', tvdbId: 900, seasonOrder: 'official' } as any,
        current,
      ),
    ).resolves.toEqual({
      episodes: current.episodes,
      partial: true,
      persisted: false,
      error: providerError,
    });
  });

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

  it('keeps an active manual mapping during mapping garbage collection', async () => {
    const { t } = await setup();
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await t.run(async (ctx) => {
      await ctx.db.insert('titleMappings', {
        tmdbId: 88,
        mediaType: 'tv',
        tvdbId: 808,
        seasonOrder: 'official',
        source: 'manual',
        orderEpoch: 3,
        updatedAt: old,
      });
      await ctx.db.insert('resolvedTitles', {
        ...movieTitle({
          tmdbId: 88,
          mediaType: 'tv',
          title: 'Pinned show',
          metadataProvider: 'tvdb',
          tvdbId: 808,
          seasonOrder: 'official',
          orderEpoch: 3,
          refreshedAt: old,
        }),
        mediaType: 'tv',
      });
      await ctx.db.insert('titleMappings', {
        tmdbId: 89,
        mediaType: 'tv',
        source: 'auto',
        orderEpoch: 0,
        updatedAt: old,
      });
      await ctx.db.insert('resolvedTitles', {
        ...movieTitle({ tmdbId: 89, mediaType: 'tv', refreshedAt: Date.now(), orderEpoch: 0 }),
        mediaType: 'tv',
      });
    });
    await expect(
      t.mutation(internal.resolvedMetadata.cleanup.pruneCanonicalData, { phase: 'mappings' }),
    ).resolves.toMatchObject({ deleted: 0 });
    await expect(
      t.query(internal.resolvedMetadata.reads.readTitleMapping, { mediaType: 'tv', tmdbId: 88 }),
    ).resolves.toMatchObject({ source: 'manual', orderEpoch: 3 });
    await expect(
      t.query(internal.resolvedMetadata.reads.readTitleMapping, { mediaType: 'tv', tmdbId: 89 }),
    ).resolves.toMatchObject({ source: 'auto', orderEpoch: 0 });
  });

  it('publishes shared title metadata into item projections before list reads', async () => {
    const { t, asUser } = await setup();
    await t.run((ctx) => ctx.db.insert('users', { clerkId: 'user_shared_metadata_other' }));
    const other = t.withIdentity({ subject: 'user_shared_metadata_other' });
    const firstId = await asUser.mutation(api.library.items.addItem, {
      tmdbId: 77,
      mediaType: 'movie',
      title: 'Old fallback',
      status: 'watchlist',
    });
    const secondId = await other.mutation(api.library.items.addItem, {
      tmdbId: 77,
      mediaType: 'movie',
      title: 'Another fallback',
      status: 'watchlist',
    });
    await t.run((ctx) => ctx.db.insert('resolvedTitles', movieTitle({ title: 'Fresh shared' })));
    await t.mutation(internal.resolvedMetadata.publication.refreshItemProjections, {
      mediaType: 'movie',
      tmdbId: 77,
    });

    expect(await asUser.query(api.library.items.listItems, {})).toMatchObject([
      { _id: firstId, title: 'Fresh shared' },
    ]);
    expect(await other.query(api.library.items.listItems, {})).toMatchObject([
      { _id: secondId, title: 'Fresh shared' },
    ]);
    expect(await t.run((ctx) => ctx.db.get(firstId))).toMatchObject({ title: 'Fresh shared' });
    expect(await t.run((ctx) => ctx.db.get(secondId))).toMatchObject({
      title: 'Fresh shared',
    });
  });

  it('publishes the current-epoch title when a season-only refresh sees a mid-flight mapping change', async () => {
    const { t, asUser } = await setup();
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert('resolvedTitles', {
        ...movieTitle({
          tmdbId: 88,
          mediaType: 'tv',
          title: 'Captured old title',
          seasons: [{ season: 1, name: 'Season 1', episodeCount: 1 }],
          orderEpoch: 0,
        }),
        mediaType: 'tv',
      });
      await ctx.db.insert('titleMappings', {
        tmdbId: 88,
        mediaType: 'tv',
        tvdbId: 900,
        seasonOrder: 'official',
        source: 'auto',
        orderEpoch: 1,
        updatedAt: now,
      });
      await ctx.db.insert('metadataRefreshRequests', {
        key: 'season:88:1',
        state: 'inFlight',
        lastRequestedAt: now,
        attemptToken: 'season-mapping-change',
        expiresAt: now + 60_000,
      });
      await ctx.db.insert('metadataRefreshLeases', {
        key: 'metadata:tv:88',
        token: 'season-mapping-lease',
        expiresAt: now + 60_000,
      });
    });
    const titleWrite = titleWriteForCapturedTitle(true, false);
    expect(titleWrite).toBe('replace');

    await expect(
      t.mutation(internal.resolvedMetadata.publication.commitRefresh, {
        title: {
          ...movieTitle({
            tmdbId: 88,
            mediaType: 'tv',
            title: 'Current epoch title',
            seasons: [{ season: 1, name: 'Season 1', episodeCount: 1 }],
            metadataProvider: 'tvdb',
            tvdbId: 900,
            seasonOrder: 'official',
            orderEpoch: 1,
            refreshedAt: now + 1,
          }),
          mediaType: 'tv',
        },
        titleWrite,
        season: {
          tmdbId: 88,
          season: 1,
          metadataProvider: 'tvdb',
          chunks: [[{ season: 1, episode: 1, name: 'Current episode' }]],
          episodeCount: 1,
          chunkCount: 1,
          refreshedAt: now + 1,
          refreshAfter: now + 1 + 60_000,
          orderEpoch: 1,
        },
        mapping: {
          tmdbId: 88,
          mediaType: 'tv',
          tvdbId: 900,
          seasonOrder: 'official',
          source: 'auto',
          orderEpoch: 1,
          updatedAt: now + 1,
        },
        expectedMapping: {
          tvdbId: 900,
          seasonOrder: 'official',
          source: 'auto',
          orderEpoch: 1,
        },
        outcomes: [{ key: 'season:88:1', state: 'succeeded' }],
        attemptToken: 'season-mapping-change',
        leaseKey: 'metadata:tv:88',
        leaseToken: 'season-mapping-lease',
      }),
    ).resolves.toBe(true);
    await expect(
      t.query(internal.resolvedMetadata.reads.readTitle, { mediaType: 'tv', tmdbId: 88 }),
    ).resolves.toMatchObject({ title: 'Current epoch title', orderEpoch: 1 });
    await expect(
      asUser.query(api.resolvedMetadata.reads.getSeasonView, {
        tmdbId: 88,
        season: 1,
        paginationOpts: { cursor: null, numItems: 1 },
      }),
    ).resolves.toMatchObject({ page: [{ episodes: [{ name: 'Current episode' }] }] });
    await expect(
      asUser.query(api.resolvedMetadata.reads.getSeasonRequestState, { tmdbId: 88, season: 1 }),
    ).resolves.toMatchObject({ state: 'succeeded' });
  });

  it('does not fail a scheduled row when a synchronous lease is waiting to adopt it', async () => {
    const { t, userId } = await setup();
    const now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert('metadataRefreshRequests', {
        key: 'title:movie:77',
        state: 'inFlight',
        lastRequestedAt: now,
        attemptToken: 'scheduled-before-adoption',
        expiresAt: now + 60_000,
      }),
    );
    await t.mutation(internal.resolvedMetadata.requests.claimRefresh, {
      key: 'metadata:movie:77',
      token: 'synchronous:adopter',
      leaseMs: 60_000,
    });

    await t.action(internal.resolvedMetadata.orchestration.orchestrateRefresh, {
      userId,
      mediaType: 'movie',
      tmdbId: 77,
      keys: ['title:movie:77'],
      attemptToken: 'scheduled-before-adoption',
    });
    await expect(
      t.query(internal.resolvedMetadata.orchestration.readRefreshRequest, {
        key: 'title:movie:77',
      }),
    ).resolves.toMatchObject({
      state: 'inFlight',
      attemptToken: 'scheduled-before-adoption',
    });
    await expect(
      t.mutation(internal.resolvedMetadata.requests.adoptRefreshRequests, {
        keys: ['title:movie:77'],
        attemptToken: 'synchronous:adopter',
        leaseKey: 'metadata:movie:77',
        leaseToken: 'synchronous:adopter',
      }),
    ).resolves.toEqual(['title:movie:77']);
    await expect(
      t.query(internal.resolvedMetadata.orchestration.readRefreshRequest, {
        key: 'title:movie:77',
      }),
    ).resolves.toMatchObject({ state: 'inFlight', attemptToken: 'synchronous:adopter' });
  });

  it('commits a slow attempt after its lease and request deadline are renewed', async () => {
    const { t } = await setup();
    const startedAt = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(startedAt);
    await t.run((ctx) =>
      ctx.db.insert('metadataRefreshRequests', {
        key: 'title:movie:77',
        state: 'inFlight',
        lastRequestedAt: startedAt,
        attemptToken: 'slow-attempt',
        expiresAt: startedAt + 1_000,
      }),
    );
    await t.mutation(internal.resolvedMetadata.requests.claimRefresh, {
      key: 'metadata:movie:77',
      token: 'scheduled:slow-attempt',
      leaseMs: 1_000,
      requestKeys: ['title:movie:77'],
      attemptToken: 'slow-attempt',
    });

    vi.mocked(Date.now).mockReturnValue(startedAt + 1_500);
    await expect(
      t.mutation(internal.resolvedMetadata.requests.renewRefreshAttempt, {
        key: 'metadata:movie:77',
        token: 'scheduled:slow-attempt',
        leaseMs: 60_000,
        requestKeys: ['title:movie:77'],
        attemptToken: 'slow-attempt',
      }),
    ).resolves.toBe(startedAt + 61_500);
    await expect(
      t.mutation(internal.resolvedMetadata.publication.commitRefresh, {
        title: movieTitle({ title: 'Slow but healthy' }),
        outcomes: [{ key: 'title:movie:77', state: 'succeeded' }],
        attemptToken: 'slow-attempt',
        leaseKey: 'metadata:movie:77',
        leaseToken: 'scheduled:slow-attempt',
      }),
    ).resolves.toBe(true);
    await expect(
      t.query(internal.resolvedMetadata.orchestration.readRefreshRequest, {
        key: 'title:movie:77',
      }),
    ).resolves.toMatchObject({ state: 'succeeded' });
  });

  it('completes a request attached after final adoption during multi-chunk staging', async () => {
    const { t } = await setup();
    const now = Date.now();
    const attemptToken = 'synchronous:late-stage';
    await t.run(async (ctx) => {
      await ctx.db.insert('titleMappings', {
        tmdbId: 88,
        mediaType: 'tv',
        source: 'auto',
        orderEpoch: 0,
        updatedAt: now,
      });
      await ctx.db.insert('resolvedTitles', {
        ...movieTitle({
          tmdbId: 88,
          mediaType: 'tv',
          title: 'Before staging',
          seasons: [{ season: 1, name: 'Season 1', episodeCount: 1 }],
        }),
        mediaType: 'tv',
      });
    });
    await t.mutation(internal.resolvedMetadata.requests.claimRefresh, {
      key: 'metadata:tv:88',
      token: attemptToken,
      leaseMs: 60_000,
    });
    await expect(
      t.mutation(internal.resolvedMetadata.publication.commitRefresh, {
        title: {
          ...movieTitle({
            tmdbId: 88,
            mediaType: 'tv',
            title: 'Published staging',
            seasons: [{ season: 1, name: 'Season 1', episodeCount: 2 }],
          }),
          mediaType: 'tv',
        },
        season: {
          tmdbId: 88,
          season: 1,
          metadataProvider: 'tmdb',
          chunks: [[{ season: 1, episode: 1, name: 'One' }]],
          episodeCount: 2,
          chunkCount: 2,
          refreshedAt: now,
          refreshAfter: now + 60_000,
          orderEpoch: 0,
        },
        expectedMapping: { source: 'auto', orderEpoch: 0 },
        outcomes: [],
        attemptToken,
        leaseKey: 'metadata:tv:88',
        leaseToken: attemptToken,
      }),
    ).resolves.toBe('staged');
    await t.run((ctx) =>
      ctx.db.insert('metadataRefreshRequests', {
        key: 'season:88:1',
        state: 'inFlight',
        lastRequestedAt: now,
        attemptToken,
        expiresAt: now + 60_000,
      }),
    );
    await t.mutation(internal.resolvedMetadata.publication.appendRefreshSeasonChunk, {
      tmdbId: 88,
      season: 1,
      orderEpoch: 0,
      chunkIndex: 1,
      episodes: [{ season: 1, episode: 2, name: 'Two' }],
      attemptToken,
    });
    await expect(
      t.mutation(internal.resolvedMetadata.publication.finalizeRefreshSeason, {
        tmdbId: 88,
        season: 1,
        outcomes: [],
        expectedMapping: { source: 'auto', orderEpoch: 0 },
        attemptToken,
        leaseKey: 'metadata:tv:88',
        leaseToken: attemptToken,
      }),
    ).resolves.toBe(true);
    await expect(
      t.query(internal.resolvedMetadata.orchestration.readRefreshRequest, { key: 'season:88:1' }),
    ).resolves.toMatchObject({ state: 'succeeded' });
  });

  it('prunes stale staging parents and orphan chunks even for referenced titles', async () => {
    const { t, asUser } = await setup();
    await addItem(asUser);
    const old = Date.now() - 3 * 60 * 1000;
    await t.mutation(internal.resolvedMetadata.requests.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: [{ season: 1, episode: 1, name: 'Visible' }],
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
      orderEpoch: 0,
    });
    await t.run(async (ctx) => {
      await ctx.db.insert('resolvedSeasonChunks', {
        tmdbId: 88,
        season: 1,
        orderEpoch: 0,
        seasonVersion: 'orphan-stage',
        chunkIndex: 0,
        refreshedAt: old,
        episodes: [{ season: 1, episode: 99, name: 'Orphan' }],
      });
      await ctx.db.insert('resolvedSeasons', {
        tmdbId: 88,
        season: 2,
        metadataProvider: 'tmdb',
        chunksComplete: false,
        refreshedAt: old,
        refreshAfter: old + 60_000,
        orderEpoch: 0,
        writeAttemptToken: 'abandoned-stage',
        nextChunkIndex: 1,
        stagingVersion: 'abandoned-stage',
        stagingMetadataProvider: 'tmdb',
        stagingEpisodeCount: 2,
        stagingChunkCount: 2,
        stagingRefreshedAt: old,
        stagingOrderEpoch: 0,
      });
      await ctx.db.insert('resolvedSeasonChunks', {
        tmdbId: 88,
        season: 2,
        orderEpoch: 0,
        seasonVersion: 'abandoned-stage',
        chunkIndex: 0,
        refreshedAt: old,
        episodes: [{ season: 2, episode: 1, name: 'Abandoned' }],
      });
    });

    await expect(
      t.mutation(internal.resolvedMetadata.cleanup.pruneCanonicalData, { phase: 'seasons' }),
    ).resolves.toMatchObject({ deleted: 2 });
    await expect(
      t.mutation(internal.resolvedMetadata.cleanup.pruneCanonicalData, { phase: 'chunks' }),
    ).resolves.toMatchObject({ deleted: 1 });
    const storage = await t.run(async (ctx) => ({
      parents: await ctx.db.query('resolvedSeasons').collect(),
      chunks: await ctx.db.query('resolvedSeasonChunks').collect(),
    }));
    expect(storage.parents.map((parent) => parent.season)).toEqual([1]);
    expect(storage.chunks).toHaveLength(1);
    expect(storage.chunks[0]?.episodes[0]).toMatchObject({ name: 'Visible' });
  });

  it('prunes old empty season parents even when their title is referenced', async () => {
    const { t, asUser } = await setup();
    await addItem(asUser);
    const old = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await t.run((ctx) =>
      ctx.db.insert('resolvedSeasons', {
        tmdbId: 88,
        season: 999,
        metadataProvider: 'tmdb',
        episodeCount: 0,
        chunkCount: 0,
        chunksComplete: true,
        refreshedAt: old,
        refreshAfter: old + 60_000,
        orderEpoch: 0,
      }),
    );

    await expect(
      t.mutation(internal.resolvedMetadata.cleanup.pruneCanonicalData, { phase: 'seasons' }),
    ).resolves.toMatchObject({ deleted: 1 });
    await expect(t.run((ctx) => ctx.db.query('resolvedSeasons').collect())).resolves.toEqual([]);
  });

  it('terminates an out-of-catalog season touch without creating a season parent', async () => {
    const { t, userId, asUser } = await setup();
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert('titleMappings', {
        tmdbId: 88,
        mediaType: 'tv',
        source: 'manual',
        orderEpoch: 0,
        updatedAt: now,
      });
      await ctx.db.insert('resolvedTitles', {
        ...movieTitle({
          tmdbId: 88,
          mediaType: 'tv',
          title: 'One-season show',
          seasons: [{ season: 1, name: 'Season 1', episodeCount: 12 }],
          refreshedAt: now,
          refreshAfter: now + 60_000,
        }),
        mediaType: 'tv',
      });
      await ctx.db.insert('metadataRefreshRequests', {
        key: 'title:tv:88',
        state: 'succeeded',
        lastRequestedAt: now,
        completedAt: now,
        attemptToken: 'previous-title',
        expiresAt: now,
      });
    });

    const decision = (await asUser.mutation(api.resolvedMetadata.touch.touchTitle, {
      mediaType: 'tv',
      tmdbId: 88,
      title: 'Untrusted title',
      season: 999,
    })) as any;
    expect(decision).toMatchObject({
      title: { scheduled: false, reason: 'debounced' },
      season: { scheduled: true },
    });
    await t.action(internal.resolvedMetadata.orchestration.orchestrateSeasonRefresh, {
      userId,
      tmdbId: 88,
      season: 999,
      key: 'season:88:999',
      attemptToken: decision.season.attemptToken,
    });

    await expect(
      asUser.query(api.resolvedMetadata.reads.getSeasonRequestState, { tmdbId: 88, season: 999 }),
    ).resolves.toMatchObject({ state: 'notFound', errorCode: 'season_not_found' });
    await expect(t.run((ctx) => ctx.db.query('resolvedSeasons').collect())).resolves.toEqual([]);
    await expect(
      asUser.mutation(api.resolvedMetadata.touch.touchTitle, {
        mediaType: 'tv',
        tmdbId: 88,
        season: 999,
      }),
    ).resolves.toMatchObject({ season: { scheduled: false, reason: 'notFound' } });
  });
});
