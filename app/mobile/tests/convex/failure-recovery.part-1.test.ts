import { putSeason, setTitleMapping } from './metadata-fixtures';
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

describe('metadata failure recovery', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('reinterprets expired in-flight rows as failed on every view surface', async () => {
    const { t, asUser } = await setup();
    const itemId = await addItem(asUser);
    const expiredAt = Date.now() - 1;
    await t.run(async (ctx) => {
      for (const key of ['title:tv:88', 'season:88:1'])
        await ctx.db.insert('metadataRefreshRequests', {
          key,
          state: 'inFlight',
          lastRequestedAt: expiredAt - 1_000,
          attemptToken: 'expired-attempt',
          expiresAt: expiredAt,
        });
    });

    await expect(
      asUser.query(api.resolvedMetadata.reads.getTitleView, { mediaType: 'tv', tmdbId: 88 }),
    ).resolves.toEqual({ title: null });
    await expect(
      asUser.query(api.resolvedMetadata.reads.getTitleRequestState, {
        mediaType: 'tv',
        tmdbId: 88,
      }),
    ).resolves.toMatchObject({ state: 'failed', errorCode: 'expired', expiresAt: expiredAt });
    await expect(
      asUser.query(api.resolvedMetadata.reads.getSeasonView, {
        tmdbId: 88,
        season: 1,
        paginationOpts: { cursor: null, numItems: 1 },
      }),
    ).resolves.toMatchObject({ page: [], isDone: true });
    await expect(
      asUser.query(api.resolvedMetadata.reads.getSeasonRequestState, { tmdbId: 88, season: 1 }),
    ).resolves.toMatchObject({ state: 'failed', errorCode: 'expired' });
    await expect(
      asUser.query(api.resolvedMetadata.reads.getItemView, { itemId }),
    ).resolves.not.toHaveProperty('requestState');
  });

  it('persists a visible request row for a synchronous lease collision and recovers at expiry', async () => {
    const { t, asUser } = await setup();
    const startedAt = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(startedAt);
    await t.mutation(internal.resolvedMetadata.requests.claimRefresh, {
      key: 'metadata:movie:77',
      token: 'synchronous:test-holder',
      leaseMs: 1_000,
    });

    await expect(
      asUser.mutation(api.resolvedMetadata.touch.touchTitle, {
        mediaType: 'movie',
        tmdbId: 77,
      }),
    ).resolves.toMatchObject({
      scheduled: false,
      reason: 'inFlight',
      expiresAt: startedAt + 1_000,
    });
    await expect(
      asUser.query(api.resolvedMetadata.reads.getTitleRequestState, {
        mediaType: 'movie',
        tmdbId: 77,
      }),
    ).resolves.toMatchObject({
      state: 'inFlight',
      expiresAt: startedAt + 1_000,
      delayMs: 1_000,
    });

    vi.mocked(Date.now).mockReturnValue(startedAt + 1_001);
    await expect(
      asUser.mutation(api.resolvedMetadata.touch.touchTitle, {
        mediaType: 'movie',
        tmdbId: 77,
      }),
    ).resolves.toMatchObject({ scheduled: true });
  });

  it('persists a forced title touch behind a scheduled season lease and completes after expiry', async () => {
    vi.useFakeTimers();
    const { t, userId, asUser } = await setup();
    const startedAt = Date.now();
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: 88,
              name: 'Fresh after season lease',
              genres: [],
              credits: {},
              seasons: [],
            }),
          ),
      ),
    );
    await t.run((ctx) =>
      ctx.db.insert(
        'resolvedTitles',
        movieTitle({
          tmdbId: 88,
          mediaType: 'tv',
          title: 'Before title touch',
          refreshedAt: 1,
        }),
      ),
    );
    const seasonAttemptToken = `${startedAt}:season:holder`;
    await t.run((ctx) =>
      ctx.db.insert('metadataRefreshRequests', {
        key: 'season:88:1',
        state: 'inFlight',
        lastRequestedAt: startedAt,
        attemptToken: seasonAttemptToken,
        expiresAt: startedAt + 1_000,
      }),
    );
    await t.mutation(internal.resolvedMetadata.requests.claimRefresh, {
      key: 'metadata:tv:88',
      token: `scheduled:${seasonAttemptToken}`,
      leaseMs: 1_000,
      requestKeys: ['season:88:1'],
      attemptToken: seasonAttemptToken,
    });

    const decision = (await asUser.mutation(api.resolvedMetadata.touch.touchTitle, {
      mediaType: 'tv',
      tmdbId: 88,
      force: true,
    })) as any;
    expect(decision).toMatchObject({
      scheduled: true,
      attemptToken: expect.stringContaining(':title:'),
    });
    await expect(
      t.query(internal.resolvedMetadata.orchestration.readRefreshRequest, { key: 'title:tv:88' }),
    ).resolves.toMatchObject({ state: 'inFlight', attemptToken: decision.attemptToken });

    await vi.advanceTimersByTimeAsync(1_001);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(
      t.query(internal.resolvedMetadata.orchestration.readRefreshRequest, { key: 'title:tv:88' }),
    ).resolves.toMatchObject({ state: 'succeeded' });
    await expect(
      t.query(internal.resolvedMetadata.reads.readTitle, { mediaType: 'tv', tmdbId: 88 }),
    ).resolves.toMatchObject({ title: 'Fresh after season lease' });
  });

  it('replaces an expired crashed request when a mounted client re-touches it', async () => {
    const { t, asUser } = await setup();
    const expiredAt = Date.now() - 1;
    await t.run((ctx) =>
      ctx.db.insert('metadataRefreshRequests', {
        key: 'title:movie:77',
        state: 'inFlight',
        lastRequestedAt: expiredAt - 1_000,
        attemptToken: 'crashed',
        expiresAt: expiredAt,
      }),
    );
    await expect(
      asUser.mutation(api.resolvedMetadata.touch.touchTitle, {
        mediaType: 'movie',
        tmdbId: 77,
      }),
    ).resolves.toMatchObject({ scheduled: true });
    const replacement = await t.run((ctx) =>
      ctx.db
        .query('metadataRefreshRequests')
        .withIndex('by_key', (query) => query.eq('key', 'title:movie:77'))
        .unique(),
    );
    expect(replacement).toMatchObject({ state: 'inFlight' });
    expect(replacement).not.toHaveProperty('errorCode');
  });

  it('rejects a superseded commit before writing title data', async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert('resolvedTitles', movieTitle({ refreshedAt: 1 }));
      await ctx.db.insert('metadataRefreshRequests', {
        key: 'title:movie:77',
        state: 'inFlight',
        lastRequestedAt: Date.now(),
        attemptToken: 'new-attempt',
        expiresAt: Date.now() + 60_000,
      });
    });
    await t.mutation(internal.resolvedMetadata.requests.claimRefresh, {
      key: 'metadata:movie:77',
      token: 'lease',
      leaseMs: 60_000,
    });
    await expect(
      t.mutation(internal.resolvedMetadata.publication.commitRefresh, {
        title: movieTitle({ title: 'Stale overwrite', refreshedAt: 2 }),
        keys: ['title:movie:77'],
        attemptToken: 'old-attempt',
        leaseKey: 'metadata:movie:77',
        leaseToken: 'lease',
      }),
    ).resolves.toBe(false);
    expect(
      await t.query(internal.resolvedMetadata.reads.readTitle, { mediaType: 'movie', tmdbId: 77 }),
    ).toMatchObject({ title: 'Stored movie', refreshedAt: 1 });
  });

  it('atomically commits title success with a failed selected season', async () => {
    const { t } = await setup();
    const now = Date.now();
    await t.run(async (ctx) => {
      for (const key of ['title:tv:88', 'season:88:1'])
        await ctx.db.insert('metadataRefreshRequests', {
          key,
          state: 'inFlight',
          lastRequestedAt: now,
          attemptToken: 'combined',
          expiresAt: now + 60_000,
        });
    });
    await t.mutation(internal.resolvedMetadata.requests.claimRefresh, {
      key: 'metadata:tv:88',
      token: 'lease',
      leaseMs: 60_000,
    });
    await expect(
      t.mutation(internal.resolvedMetadata.publication.commitRefresh, {
        title: {
          ...movieTitle({
            tmdbId: 88,
            mediaType: 'tv',
            title: 'Fresh title',
            seasons: [{ season: 1, name: 'Season 1', episodeCount: 1 }],
          }),
          mediaType: 'tv',
        },
        titleWrite: 'replace',
        season: {
          tmdbId: 88,
          season: 1,
          metadataProvider: 'tmdb',
          chunks: [[{ season: 1, episode: 1, name: 'Stale fallback' }]],
          episodeCount: 1,
          chunkCount: 1,
          refreshedAt: now,
          refreshAfter: now + 60_000,
          orderEpoch: 0,
        },
        outcomes: [
          { key: 'title:tv:88', state: 'succeeded' },
          { key: 'season:88:1', state: 'failed', errorCode: 'provider_failure' },
        ],
        attemptToken: 'combined',
        leaseKey: 'metadata:tv:88',
        leaseToken: 'lease',
      }),
    ).resolves.toBe(true);
    const state = await t.run(async (ctx) => ({
      requests: await ctx.db.query('metadataRefreshRequests').collect(),
      season: await ctx.db
        .query('resolvedSeasons')
        .withIndex('by_tmdb_season', (query) => query.eq('tmdbId', 88).eq('season', 1))
        .unique(),
    }));
    expect(state.requests.find((row) => row.key === 'title:tv:88')).toMatchObject({
      state: 'succeeded',
    });
    expect(state.requests.find((row) => row.key === 'season:88:1')).toMatchObject({
      state: 'failed',
      errorCode: 'provider_failure',
      retryAt: expect.any(Number),
    });
    expect(state.requests[0]?.completedAt).toBe(state.requests[1]?.completedAt);
    expect(state.season).toBeNull();
    expect(
      await t.query(internal.resolvedMetadata.reads.readTitle, { mediaType: 'tv', tmdbId: 88 }),
    ).toMatchObject({ title: 'Fresh title' });
  });

  it('aborts a refresh commit when the mapping identity changed mid-flight', async () => {
    const { t } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert('resolvedTitles', movieTitle({ refreshedAt: 1 }));
      await ctx.db.insert('titleMappings', {
        tmdbId: 77,
        mediaType: 'movie',
        tvdbId: 100,
        seasonOrder: 'official',
        source: 'manual',
        orderEpoch: 1,
        updatedAt: 1,
      });
      await ctx.db.insert('metadataRefreshRequests', {
        key: 'title:movie:77',
        state: 'inFlight',
        lastRequestedAt: Date.now(),
        attemptToken: 'attempt',
        expiresAt: Date.now() + 60_000,
      });
    });
    await t.mutation(internal.resolvedMetadata.requests.claimRefresh, {
      key: 'metadata:movie:77',
      token: 'lease',
      leaseMs: 60_000,
    });
    await setTitleMapping(t, {
      tmdbId: 77,
      mediaType: 'movie',
      tvdbId: 200,
      seasonOrder: 'dvd',
      source: 'manual',
    });
    await expect(
      t.mutation(internal.resolvedMetadata.publication.commitRefresh, {
        title: movieTitle({ title: 'Wrong mapping data', orderEpoch: 1, refreshedAt: 2 }),
        expectedMapping: {
          tvdbId: 100,
          seasonOrder: 'official',
          source: 'manual',
          orderEpoch: 1,
        },
        keys: ['title:movie:77'],
        attemptToken: 'attempt',
        leaseKey: 'metadata:movie:77',
        leaseToken: 'lease',
      }),
    ).resolves.toBe('mappingChanged');
    expect(
      await t.run((ctx) =>
        ctx.db
          .query('resolvedTitles')
          .withIndex('by_tmdb', (query) => query.eq('mediaType', 'movie').eq('tmdbId', 77))
          .unique(),
      ),
    ).toMatchObject({ title: 'Stored movie', refreshedAt: 1 });
  });

  it('rejects setSeasonWatched when the stored season epoch is stale', async () => {
    const { t, asUser } = await setup();
    const itemId = await addItem(asUser);
    await t.run((ctx) =>
      ctx.db.insert('titleMappings', {
        tmdbId: 88,
        mediaType: 'tv',
        source: 'manual',
        orderEpoch: 1,
        updatedAt: Date.now(),
      }),
    );
    await putSeason(t, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: [{ season: 1, episode: 1, name: 'Old order' }],
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
      orderEpoch: 0,
    });
    await expect(
      asUser.action(api.library.seasonWatched.setSeasonWatched, { itemId, season: 1 }),
    ).rejects.toThrow('metadata changed');
  });

  it('rejects a stale TMDB tap after a same-epoch transition to TVDB', async () => {
    const { t, asUser } = await setup(true);
    const itemId = await addItem(asUser);
    await t.run((ctx) =>
      ctx.db.insert('titleMappings', {
        tmdbId: 88,
        mediaType: 'tv',
        tvdbId: 808,
        seasonOrder: 'official',
        source: 'manual',
        orderEpoch: 0,
        updatedAt: Date.now(),
      }),
    );
    await putSeason(t, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tvdb',
      episodes: [{ season: 1, episode: 1, name: 'TVDB episode', providerEpisodeId: 801 }],
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
      orderEpoch: 0,
    });
    await expect(
      asUser.action(api.library.seasonWatched.setSeasonWatched, {
        itemId,
        season: 1,
        orderEpoch: 0,
        metadataProvider: 'tmdb',
      }),
    ).rejects.toMatchObject({ data: { code: 'stale_epoch', retryable: true } });
  });

  it('does not charge touch budgets for in-flight or backoff ingress guards', async () => {
    const { t, asUser } = await setup();
    const expiresAt = Date.now() + 60_000;
    await t.run(async (ctx) => {
      await ctx.db.insert('resolvedTitles', movieTitle());
      await ctx.db.insert('metadataRefreshRequests', {
        key: 'title:movie:77',
        state: 'inFlight',
        lastRequestedAt: Date.now(),
        attemptToken: 'active',
        expiresAt,
      });
    });
    for (let count = 0; count < 60; count += 1)
      await expect(
        asUser.mutation(api.resolvedMetadata.touch.touchTitle, {
          mediaType: 'movie',
          tmdbId: 77,
          title: 'Stored movie',
        }),
      ).resolves.toMatchObject({ scheduled: false, reason: 'inFlight', expiresAt });
    await expect(
      asUser.mutation(api.resolvedMetadata.touch.touchTitle, {
        mediaType: 'movie',
        tmdbId: 77,
        title: 'Stored movie',
        force: true,
      }),
    ).resolves.toMatchObject({ scheduled: false, reason: 'inFlight' });
    expect(await t.run((ctx) => ctx.db.query('requestThrottle').collect())).toEqual([]);

    const second = await setup();
    const failedAt = Date.now();
    await second.t.run(async (ctx) => {
      await ctx.db.insert('resolvedTitles', movieTitle());
      await ctx.db.insert('metadataRefreshRequests', {
        key: 'title:movie:77',
        state: 'failed',
        lastRequestedAt: failedAt,
        completedAt: failedAt,
        errorCode: 'upstream',
        attemptToken: 'failed',
        expiresAt: failedAt,
      });
    });
    await expect(
      second.asUser.mutation(api.resolvedMetadata.touch.touchTitle, {
        mediaType: 'movie',
        tmdbId: 77,
        title: 'Stored movie',
      }),
    ).resolves.toMatchObject({
      scheduled: false,
      reason: 'backoff',
      expiresAt: failedAt + 30_000,
      retryAt: failedAt + 30_000,
    });
    expect(await second.t.run((ctx) => ctx.db.query('requestThrottle').collect())).toEqual([]);
    await second.t.mutation(internal.resolvedMetadata.requests.claimRefresh, {
      key: 'metadata:movie:77',
      token: 'active-sync',
      leaseMs: 60_000,
    });
    await expect(
      second.asUser.mutation(api.resolvedMetadata.touch.touchTitle, {
        mediaType: 'movie',
        tmdbId: 77,
        title: 'Stored movie',
        force: true,
      }),
    ).resolves.toMatchObject({ scheduled: false, reason: 'debounced' });
    await second.t.mutation(internal.resolvedMetadata.requests.releaseRefresh, {
      key: 'metadata:movie:77',
      token: 'active-sync',
    });
    await expect(
      second.asUser.mutation(api.resolvedMetadata.touch.touchTitle, {
        mediaType: 'movie',
        tmdbId: 77,
        title: 'Stored movie',
        force: true,
      }),
    ).resolves.toMatchObject({ scheduled: false, reason: 'debounced' });
  });

  it('does not overwrite an active season failure backoff from a combined title touch', async () => {
    const { t, asUser } = await setup();
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert('resolvedTitles', {
        ...movieTitle({
          tmdbId: 88,
          mediaType: 'tv',
          title: 'Backoff show',
          seasons: [{ season: 1, name: 'Season 1', episodeCount: 1 }],
          refreshAfter: 0,
        }),
        mediaType: 'tv',
      });
      await ctx.db.insert('titleMappings', {
        tmdbId: 88,
        mediaType: 'tv',
        source: 'auto',
        orderEpoch: 0,
        updatedAt: now,
      });
      await ctx.db.insert('metadataRefreshRequests', {
        key: 'season:88:1',
        state: 'failed',
        lastRequestedAt: now,
        completedAt: now,
        errorCode: 'upstream',
        retryAt: now + 30_000,
        attemptToken: 'failed-season',
        expiresAt: now,
      });
    });

    await expect(
      asUser.mutation(api.resolvedMetadata.touch.touchTitle, {
        mediaType: 'tv',
        tmdbId: 88,
        title: 'Backoff show',
        season: 1,
      }),
    ).resolves.toMatchObject({
      scheduled: true,
      title: { scheduled: true },
      season: { scheduled: false, reason: 'backoff', retryAt: now + 30_000 },
    });
    await expect(
      t.query(internal.resolvedMetadata.orchestration.readRefreshRequest, { key: 'season:88:1' }),
    ).resolves.toMatchObject({
      state: 'failed',
      attemptToken: 'failed-season',
      retryAt: now + 30_000,
    });
  });
});
