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

  it('persists and resolves a sibling season touched behind an active scheduled lease', async () => {
    const { t, userId, asUser } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert('resolvedTitles', {
        ...movieTitle({
          tmdbId: 88,
          mediaType: 'tv',
          title: 'Stored show',
          seasons: [
            { season: 1, name: 'Season 1', episodeCount: 1 },
            { season: 2, name: 'Season 2', episodeCount: 1 },
          ],
        }),
        mediaType: 'tv',
      });
      await ctx.db.insert('titleMappings', {
        tmdbId: 88,
        mediaType: 'tv',
        source: 'auto',
        orderEpoch: 0,
        updatedAt: Date.now(),
      });
      await ctx.db.insert('providerSnapshots', {
        key: 'tmdb:season:88:2',
        entry: {
          kind: 'episodes',
          value: [{ season: 2, episode: 1, name: 'Sibling season' }],
        },
        refreshedAt: Date.now(),
      });
    });
    await t.mutation(internal.resolvedMetadata.requests.claimRefresh, {
      key: 'metadata:tv:88',
      token: 'scheduled:season-one',
      leaseMs: 60_000,
    });

    const decision = (await asUser.mutation(api.resolvedMetadata.touch.touchTitle, {
      mediaType: 'tv',
      tmdbId: 88,
      title: 'Stored show',
      season: 2,
    })) as any;
    expect(decision).toMatchObject({ scheduled: true, season: { scheduled: true } });
    const request = await t.query(internal.resolvedMetadata.orchestration.readRefreshRequest, {
      key: 'season:88:2',
    });
    expect(request).toMatchObject({
      state: 'inFlight',
      attemptToken: decision.season.attemptToken,
    });

    await t.mutation(internal.resolvedMetadata.requests.releaseRefresh, {
      key: 'metadata:tv:88',
      token: 'scheduled:season-one',
    });
    await t.action(internal.resolvedMetadata.orchestration.orchestrateSeasonRefresh, {
      userId,
      tmdbId: 88,
      season: 2,
      key: 'season:88:2',
      attemptToken: decision.season.attemptToken,
    });
    await vi.waitFor(async () =>
      expect(
        await t.query(internal.resolvedMetadata.orchestration.readRefreshRequest, {
          key: 'season:88:2',
        }),
      ).toMatchObject({ state: 'succeeded' }),
    );
    await expect(
      t.query(internal.resolvedMetadata.reads.readSeason, { tmdbId: 88, season: 2 }),
    ).resolves.toMatchObject({ episodes: [{ name: 'Sibling season' }] });
  });

  it('schedules and resolves a season intent while its title request is in flight', async () => {
    const { t, asUser } = await setup();
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert('resolvedTitles', {
        ...movieTitle({
          tmdbId: 88,
          mediaType: 'tv',
          title: 'Stored show',
          episodeRunTime: [24],
          seasons: [{ season: 2, name: 'Season 2', episodeCount: 1 }],
        }),
        mediaType: 'tv',
      });
      await ctx.db.insert('metadataRefreshRequests', {
        key: 'title:tv:88',
        state: 'inFlight',
        lastRequestedAt: now,
        attemptToken: 'title-attempt',
        expiresAt: now + 60_000,
      });
    });
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              season_number: 2,
              episodes: [{ id: 202, season_number: 2, episode_number: 1, name: 'Season two' }],
            }),
          ),
      ),
    );
    const touch = (await asUser.mutation(api.resolvedMetadata.touch.touchTitle, {
      mediaType: 'tv',
      tmdbId: 88,
      title: 'Stored show',
      season: 2,
    })) as any;
    expect(touch).toMatchObject({
      title: { scheduled: false, reason: 'inFlight' },
      season: { scheduled: true },
    });
    await t.mutation(internal.resolvedMetadata.requests.completeRefreshRequest, {
      key: 'title:tv:88',
      attemptToken: 'title-attempt',
      state: 'succeeded',
    });
    await vi.waitFor(async () =>
      expect(
        await t.query(internal.resolvedMetadata.reads.readSeason, { tmdbId: 88, season: 2 }),
      ).toMatchObject({ episodes: [{ name: 'Season two', providerEpisodeId: 202 }] }),
    );
  });

  it('uses one attempt and one atomic commit for a cold title plus selected season', async () => {
    const { t, asUser } = await setup();
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/season/1'))
          return new Response(
            JSON.stringify({
              season_number: 1,
              episodes: [{ id: 101, season_number: 1, episode_number: 1, name: 'Pilot' }],
            }),
          );
        return new Response(
          JSON.stringify({
            id: 88,
            name: 'Cold show',
            seasons: [{ season_number: 1, name: 'Season 1', episode_count: 1 }],
            genres: [],
            credits: {},
          }),
        );
      }),
    );

    const touch = (await asUser.mutation(api.resolvedMetadata.touch.touchTitle, {
      mediaType: 'tv',
      tmdbId: 88,
      title: 'Cold show',
      season: 1,
    })) as any;
    expect(touch.title.attemptToken).toBe(touch.season.attemptToken);

    await vi.waitFor(async () => {
      const state = await t.run(async (ctx) => ({
        title: await ctx.db
          .query('metadataRefreshRequests')
          .withIndex('by_key', (query) => query.eq('key', 'title:tv:88'))
          .unique(),
        season: await ctx.db
          .query('metadataRefreshRequests')
          .withIndex('by_key', (query) => query.eq('key', 'season:88:1'))
          .unique(),
        canonicalTitle: await ctx.db
          .query('resolvedTitles')
          .withIndex('by_tmdb', (query) => query.eq('mediaType', 'tv').eq('tmdbId', 88))
          .unique(),
        canonicalSeason: await ctx.db
          .query('resolvedSeasons')
          .withIndex('by_tmdb_season', (query) => query.eq('tmdbId', 88).eq('season', 1))
          .unique(),
      }));
      expect(state.title).toMatchObject({
        state: 'succeeded',
        attemptToken: touch.title.attemptToken,
      });
      expect(state.season).toMatchObject({
        state: 'succeeded',
        attemptToken: touch.title.attemptToken,
      });
      expect(state.title?.completedAt).toBe(state.season?.completedAt);
      expect(state.canonicalTitle).toMatchObject({ title: 'Cold show', orderEpoch: 0 });
      expect(state.canonicalSeason).toMatchObject({ episodeCount: 1, orderEpoch: 0 });
    });
  });

  it('commits a refreshed title and fails its stale selected season in the same attempt', async () => {
    const { t, asUser } = await setup();
    await t.run((ctx) =>
      ctx.db.insert('resolvedTitles', {
        ...movieTitle({
          tmdbId: 88,
          mediaType: 'tv',
          title: 'Old title',
          refreshAfter: 0,
          seasons: [{ season: 1, name: 'Season 1', episodeCount: 1 }],
        }),
        mediaType: 'tv',
      }),
    );
    await t.mutation(internal.resolvedMetadata.requests.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: [{ season: 1, episode: 1, name: 'Cached episode' }],
      refreshedAt: 1,
      refreshAfter: 0,
      orderEpoch: 0,
    });
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/season/1')) return new Response('{}', { status: 503 });
        return new Response(
          JSON.stringify({
            id: 88,
            name: 'Fresh title',
            seasons: [{ season_number: 1, name: 'Season 1', episode_count: 1 }],
            genres: [],
            credits: {},
          }),
        );
      }),
    );

    const touch = (await asUser.mutation(api.resolvedMetadata.touch.touchTitle, {
      mediaType: 'tv',
      tmdbId: 88,
      title: 'Old title',
      season: 1,
    })) as any;
    await vi.waitFor(async () => {
      const state = await t.run(async (ctx) => ({
        requests: await ctx.db.query('metadataRefreshRequests').collect(),
        title: await ctx.db
          .query('resolvedTitles')
          .withIndex('by_tmdb', (query) => query.eq('mediaType', 'tv').eq('tmdbId', 88))
          .unique(),
      }));
      const titleRequest = state.requests.find((row) => row.key === 'title:tv:88');
      const seasonRequest = state.requests.find((row) => row.key === 'season:88:1');
      expect(titleRequest).toMatchObject({
        state: 'succeeded',
        attemptToken: touch.title.attemptToken,
      });
      expect(seasonRequest).toMatchObject({
        state: 'failed',
        attemptToken: touch.title.attemptToken,
        retryAt: expect.any(Number),
      });
      expect(titleRequest?.completedAt).toBe(seasonRequest?.completedAt);
      expect(state.title).toMatchObject({ title: 'Fresh title' });
    });
    expect(
      await t.query(internal.resolvedMetadata.reads.readSeason, { tmdbId: 88, season: 1 }),
    ).toMatchObject({ refreshedAt: 1, episodes: [{ name: 'Cached episode' }] });
  });

  it('never auto-adopts a discovered identity over a manual mapping', async () => {
    const { t } = await setup();
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert('titleMappings', {
        tmdbId: 88,
        mediaType: 'tv',
        tvdbId: 111,
        seasonOrder: 'dvd',
        source: 'manual',
        orderEpoch: 4,
        updatedAt: now,
      });
      await ctx.db.insert('metadataRefreshRequests', {
        key: 'title:tv:88',
        state: 'inFlight',
        lastRequestedAt: now,
        attemptToken: 'manual-attempt',
        expiresAt: now + 60_000,
      });
    });
    await t.mutation(internal.resolvedMetadata.requests.claimRefresh, {
      key: 'metadata:tv:88',
      token: 'manual-lease',
      leaseMs: 60_000,
    });
    await t.mutation(internal.resolvedMetadata.publication.commitRefresh, {
      title: {
        ...movieTitle({
          tmdbId: 88,
          mediaType: 'tv',
          metadataProvider: 'tvdb',
          tvdbId: 222,
          seasonOrder: 'official',
          orderEpoch: 5,
        }),
        mediaType: 'tv',
      },
      mapping: {
        tmdbId: 88,
        mediaType: 'tv',
        tvdbId: 222,
        seasonOrder: 'official',
        source: 'auto',
        orderEpoch: 5,
        updatedAt: now,
      },
      expectedMapping: {
        tvdbId: 111,
        seasonOrder: 'dvd',
        source: 'manual',
        orderEpoch: 4,
      },
      outcomes: [{ key: 'title:tv:88', state: 'succeeded' }],
      attemptToken: 'manual-attempt',
      leaseKey: 'metadata:tv:88',
      leaseToken: 'manual-lease',
    });
    await expect(
      t.query(internal.resolvedMetadata.reads.readTitleMapping, { mediaType: 'tv', tmdbId: 88 }),
    ).resolves.toMatchObject({
      source: 'manual',
      tvdbId: 111,
      seasonOrder: 'dvd',
      orderEpoch: 4,
    });
  });

  it('treats a missing season mapping as a read miss and a retryable watched rejection', async () => {
    const { t, asUser } = await setup();
    const itemId = await addItem(asUser);
    await t.run(async (ctx) => {
      await ctx.db.insert('resolvedSeasons', {
        tmdbId: 88,
        season: 1,
        metadataProvider: 'tmdb',
        episodeCount: 1,
        chunkCount: 1,
        chunksComplete: true,
        seasonVersion: 'unmapped',
        refreshedAt: Date.now(),
        refreshAfter: Date.now() + 60_000,
        orderEpoch: 0,
      });
      await ctx.db.insert('resolvedSeasonChunks', {
        tmdbId: 88,
        season: 1,
        orderEpoch: 0,
        seasonVersion: 'unmapped',
        chunkIndex: 0,
        refreshedAt: Date.now(),
        episodes: [{ season: 1, episode: 1, name: 'Unmapped episode' }],
      });
    });
    await expect(
      t.query(internal.resolvedMetadata.reads.readSeason, { tmdbId: 88, season: 1 }),
    ).resolves.toBeNull();
    await expect(
      asUser.action(api.library.seasonWatched.setSeasonWatched, { itemId, season: 1 }),
    ).rejects.toMatchObject({ data: { code: 'stale_epoch', retryable: true } });
  });

  it('returns repeated in-flight touches before reading malformed season chunk data', async () => {
    const { t, asUser } = await setup();
    const expiresAt = Date.now() + 60_000;
    await t.run(async (ctx) => {
      await ctx.db.insert('resolvedSeasons', {
        tmdbId: 88,
        season: 1,
        metadataProvider: 'tmdb',
        episodeCount: 6_001,
        chunkCount: 51,
        refreshedAt: Date.now(),
        refreshAfter: Date.now() + 60_000,
        orderEpoch: 0,
      });
      for (const key of ['title:tv:88', 'season:88:1'])
        await ctx.db.insert('metadataRefreshRequests', {
          key,
          state: 'inFlight',
          lastRequestedAt: Date.now(),
          attemptToken: 'active',
          expiresAt,
        });
    });
    for (let count = 0; count < 3; count += 1)
      await expect(
        asUser.mutation(api.resolvedMetadata.touch.touchTitle, {
          mediaType: 'tv',
          tmdbId: 88,
          season: 1,
        }),
      ).resolves.toMatchObject({
        scheduled: false,
        title: { reason: 'inFlight' },
        season: { reason: 'inFlight' },
      });
  });

  it('caps distinct unknown touch keys per user', async () => {
    const { t, userId, asUser } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert('requestThrottle', {
        key: `metadata-touch-new:${userId}`,
        windowStart: Date.now(),
        count: 240,
      });
    });
    await expect(
      asUser.mutation(api.resolvedMetadata.touch.touchTitle, {
        mediaType: 'movie',
        tmdbId: 241,
        title: 'One too many',
      }),
    ).rejects.toMatchObject({ data: { code: 'new_touch_key_budget' } });
  });

  it('does not charge known canonical films against the unknown touch-key budget', async () => {
    const { t, userId, asUser } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert(
        'resolvedTitles',
        movieTitle({ tmdbId: 999, mediaType: 'movie', title: 'Known film' }),
      );
      await ctx.db.insert('requestThrottle', {
        key: `metadata-touch-new:${userId}`,
        windowStart: Date.now(),
        count: 240,
      });
    });

    await expect(
      asUser.mutation(api.resolvedMetadata.touch.touchTitle, {
        mediaType: 'movie',
        tmdbId: 999,
        title: 'Known film',
      }),
    ).resolves.toMatchObject({ scheduled: true });
  });

  it('bypasses a successful touch debounce when current-epoch data is invisible', async () => {
    const { t, asUser } = await setup();
    const completedAt = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert('resolvedTitles', movieTitle({ orderEpoch: 0 }));
      await ctx.db.insert('titleMappings', {
        tmdbId: 77,
        mediaType: 'movie',
        source: 'manual',
        orderEpoch: 1,
        updatedAt: completedAt,
      });
      await ctx.db.insert('metadataRefreshRequests', {
        key: 'title:movie:77',
        state: 'succeeded',
        lastRequestedAt: completedAt,
        completedAt,
        attemptToken: 'old',
        expiresAt: completedAt,
      });
    });
    await expect(
      asUser.mutation(api.resolvedMetadata.touch.touchTitle, {
        mediaType: 'movie',
        tmdbId: 77,
      }),
    ).resolves.toMatchObject({ scheduled: true });
  });

  it('does not debounce against a season parent whose episode chunks are incomplete', async () => {
    const { t, asUser } = await setup();
    const completedAt = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert('resolvedTitles', {
        ...movieTitle({
          tmdbId: 88,
          mediaType: 'tv',
          title: 'Chunked show',
          seasons: [{ season: 1, name: 'Season 1', episodeCount: 1 }],
        }),
        mediaType: 'tv',
      });
      await ctx.db.insert('resolvedSeasons', {
        tmdbId: 88,
        season: 1,
        metadataProvider: 'tmdb',
        episodeCount: 1,
        chunkCount: 1,
        refreshedAt: completedAt,
        refreshAfter: completedAt + 60_000,
        orderEpoch: 0,
      });
      for (const key of ['title:tv:88', 'season:88:1'])
        await ctx.db.insert('metadataRefreshRequests', {
          key,
          state: 'succeeded',
          lastRequestedAt: completedAt,
          completedAt,
          attemptToken: 'previous',
          expiresAt: completedAt,
        });
    });
    await expect(
      asUser.mutation(api.resolvedMetadata.touch.touchTitle, {
        mediaType: 'tv',
        tmdbId: 88,
        title: 'Chunked show',
        season: 1,
      }),
    ).resolves.toMatchObject({
      title: { scheduled: false, reason: 'debounced' },
      season: { scheduled: true },
    });
  });
});
