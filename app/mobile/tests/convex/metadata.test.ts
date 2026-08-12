import { afterEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { api, internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import { isTruncatedSnapshot, putNonFatal } from '../../convex/providerSnapshots';
import { MAX_METADATA_MUTATION_BYTES, serializedBytes } from '../../convex/seasonStorage';
import { mapSeasonDetails } from '../../convex/tmdb';
import { commitWatchWithOneRematch } from '../../convex/sync';
import { titleWriteForCapturedTitle } from '../../convex/resolvedMetadata';

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
  asUser.mutation(api.library.addItem, {
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
        await t.mutation(internal.resolvedMetadata.claimRefresh, {
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
          t.mutation(internal.resolvedMetadata.commitRefresh, {
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
        await t.mutation(internal.resolvedMetadata.releaseRefresh, {
          key: 'metadata:tv:88',
          token: leaseToken,
        });
      }

      expect(
        await t.query(internal.resolvedMetadata.readTitle, { mediaType: 'tv', tmdbId: 88 }),
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
    await t.mutation(internal.resolvedMetadata.claimRefresh, {
      key: 'metadata:tv:88',
      token: 'scheduled:season-one',
      leaseMs: 60_000,
    });

    const decision = (await asUser.mutation(api.resolvedMetadata.touchTitle, {
      mediaType: 'tv',
      tmdbId: 88,
      title: 'Stored show',
      season: 2,
    })) as any;
    expect(decision).toMatchObject({ scheduled: true, season: { scheduled: true } });
    const request = await t.query(internal.resolvedMetadata.readRefreshRequest, {
      key: 'season:88:2',
    });
    expect(request).toMatchObject({
      state: 'inFlight',
      attemptToken: decision.season.attemptToken,
    });

    await t.mutation(internal.resolvedMetadata.releaseRefresh, {
      key: 'metadata:tv:88',
      token: 'scheduled:season-one',
    });
    await t.action(internal.resolvedMetadata.orchestrateSeasonRefresh, {
      userId,
      tmdbId: 88,
      season: 2,
      key: 'season:88:2',
      attemptToken: decision.season.attemptToken,
    });
    await expect(
      t.query(internal.resolvedMetadata.readRefreshRequest, { key: 'season:88:2' }),
    ).resolves.toMatchObject({ state: 'succeeded' });
    await expect(
      t.query(internal.resolvedMetadata.readSeason, { tmdbId: 88, season: 2 }),
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
    const touch = (await asUser.mutation(api.resolvedMetadata.touchTitle, {
      mediaType: 'tv',
      tmdbId: 88,
      title: 'Stored show',
      season: 2,
    })) as any;
    expect(touch).toMatchObject({
      title: { scheduled: false, reason: 'inFlight' },
      season: { scheduled: true },
    });
    await t.mutation(internal.resolvedMetadata.completeRefreshRequest, {
      key: 'title:tv:88',
      attemptToken: 'title-attempt',
      state: 'succeeded',
    });
    await vi.waitFor(async () =>
      expect(
        await t.query(internal.resolvedMetadata.readSeason, { tmdbId: 88, season: 2 }),
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

    const touch = (await asUser.mutation(api.resolvedMetadata.touchTitle, {
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
    await t.mutation(internal.resolvedMetadata.putSeason, {
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

    const touch = (await asUser.mutation(api.resolvedMetadata.touchTitle, {
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
      await t.query(internal.resolvedMetadata.readSeason, { tmdbId: 88, season: 1 }),
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
    await t.mutation(internal.resolvedMetadata.claimRefresh, {
      key: 'metadata:tv:88',
      token: 'manual-lease',
      leaseMs: 60_000,
    });
    await t.mutation(internal.resolvedMetadata.commitRefresh, {
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
      t.query(internal.resolvedMetadata.readTitleMapping, { mediaType: 'tv', tmdbId: 88 }),
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
      t.query(internal.resolvedMetadata.readSeason, { tmdbId: 88, season: 1 }),
    ).resolves.toBeNull();
    await expect(
      asUser.action(api.library.setSeasonWatched, { itemId, season: 1 }),
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
        asUser.mutation(api.resolvedMetadata.touchTitle, {
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
      asUser.mutation(api.resolvedMetadata.touchTitle, {
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
      asUser.mutation(api.resolvedMetadata.touchTitle, {
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
      asUser.mutation(api.resolvedMetadata.touchTitle, {
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
      asUser.mutation(api.resolvedMetadata.touchTitle, {
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

  it('does not reuse a TVDB guide snapshot from a different mapping', async () => {
    const { t } = await setup();
    await t.run((ctx) =>
      ctx.db.insert('providerSnapshots', {
        key: 'tvdb:anime:v7:88:111:official',
        entry: {
          kind: 'tvdbGuide',
          value: {
            tvdbId: 111,
            title: 'Old guide',
            episodeRunTime: [],
            genres: ['Anime'],
            order: 'official',
            seasons: [],
          },
        },
        refreshedAt: Date.now(),
      }),
    );
    vi.stubEnv('TVDB_API_KEY', 'key');
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/login')) return new Response(JSON.stringify({ data: { token: 'token' } }));
      if (url.includes('/series/222/extended'))
        return new Response(
          JSON.stringify({
            data: {
              name: 'New guide',
              genres: [{ name: 'Anime' }],
              seasons: [
                {
                  id: 20,
                  number: 1,
                  name: 'First Arc',
                  type: { type: 'dvd' },
                },
              ],
            },
          }),
        );
      if (url.includes('/series/222/episodes/dvd/eng'))
        return new Response(
          JSON.stringify({
            data: { episodes: [{ id: 1, seasonNumber: 1, number: 1, name: 'New episode' }] },
            links: { next: null },
          }),
        );
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      t.action(internal.tvdb.refreshAnimeWithMapping, {
        tmdbId: 88,
        title: 'Mapped show',
        tvdbId: 222,
        order: 'dvd',
      }),
    ).resolves.toMatchObject({ tvdbId: 222, order: 'dvd', title: 'New guide' });
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes('/series/222/extended')),
    ).toBe(true);
    expect(
      await t.query(internal.providerSnapshots.get, { key: 'tvdb:anime:v7:88:222:dvd' }),
    ).toMatchObject({ value: { tvdbId: 222, order: 'dvd' } });
  });

  it('records a bounded marker when an oversized provider cache write fails', async () => {
    const runMutation = vi
      .fn()
      .mockRejectedValueOnce(new Error('Document is too large'))
      .mockResolvedValueOnce(undefined);
    const episodes = Array.from({ length: 6_000 }, (_, index) => ({
      season: 1,
      episode: index + 1,
      name: 'x'.repeat(300),
    }));
    await expect(
      putNonFatal(
        { runMutation },
        { key: 'tmdb:season:88:1', value: episodes, metricKey: 'synthetic-season' },
      ),
    ).resolves.toBe(false);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toMatchObject({
      entry: { kind: 'truncated', value: { __truncatedProviderSnapshot: true } },
    });
  });

  it('bounds oversized season ingestion, caches a marker, and reuses canonical chunks', async () => {
    const { t } = await setup();
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
    const rawEpisodes = Array.from({ length: 1_000 }, (_, index) => ({
      id: 10_000 + index,
      season_number: 1,
      episode_number: index + 1,
      name: `Episode ${index + 1}${'n'.repeat(400)}`,
      overview: 'o'.repeat(900),
      still_path: `/${'i'.repeat(600)}`,
      air_date: '2026-07-17',
    }));
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ season_number: 1, episodes: rawEpisodes })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const ingested = await t.action(internal.tmdb.internalSeasonDetails, {
      tmdbId: 88,
      season: 1,
    });
    expect(ingested).toHaveLength(1_000);
    expect(ingested[0]?.name).toHaveLength(300);
    expect(ingested[0]?.overview).toHaveLength(400);
    expect(ingested[0]?.imageUrl).toHaveLength(500);
    const snapshot = await t.query(internal.providerSnapshots.get, {
      key: 'tmdb:season:88:1',
    });
    expect(snapshot?.refreshedAt).toBeTypeOf('number');
    expect(isTruncatedSnapshot(snapshot?.value)).toBe(true);

    await t.mutation(internal.resolvedMetadata.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: ingested,
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
      orderEpoch: 0,
    });
    await expect(
      t.action(internal.tmdb.internalSeasonDetails, { tmdbId: 88, season: 1 }),
    ).resolves.toHaveLength(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      mapSeasonDetails({
        season_number: 1,
        episodes: Array.from({ length: 6_001 }, (_, index) => ({
          id: index,
          season_number: 1,
          episode_number: index,
          name: 'Episode',
        })),
      }),
    ).toHaveLength(6_000);
  });

  it('replaces a verified identity tuple together and clears a missing provider episode id', async () => {
    const { t, userId, asUser } = await setup();
    const itemId = await addItem(asUser);
    await t.run(async (ctx) => {
      await ctx.db.insert('titleMappings', {
        tmdbId: 88,
        mediaType: 'tv',
        tvdbId: 2,
        seasonOrder: 'dvd',
        source: 'manual',
        orderEpoch: 2,
        updatedAt: Date.now(),
      });
      await ctx.db.insert('resolvedTitles', {
        ...movieTitle({
          tmdbId: 88,
          mediaType: 'tv',
          title: 'Stored show',
          metadataProvider: 'tvdb',
          tvdbId: 2,
          seasonOrder: 'dvd',
          orderEpoch: 2,
          episodeRunTime: [24],
          seasons: [{ season: 1, name: 'Season 1', episodeCount: 1 }],
        }),
        mediaType: 'tv',
      });
      await ctx.db.insert('episodes', {
        userId,
        itemId,
        season: 1,
        episode: 1,
        watched: true,
        tags: [],
        metadataProvider: 'tmdb',
        seasonOrder: 'official',
        providerEpisodeId: 9001,
      });
    });
    await t.mutation(internal.resolvedMetadata.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tvdb',
      episodes: [{ season: 1, episode: 1, name: 'Verified without provider id' }],
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
      orderEpoch: 2,
    });

    await asUser.mutation(api.library.setEpisodeState, {
      itemId,
      season: 1,
      episode: 1,
      rating: 8,
    });
    const [saved] = await asUser.query(api.library.listEpisodes, { itemId, season: 1 });
    expect(saved).toMatchObject({ metadataProvider: 'tvdb', seasonOrder: 'dvd', rating: 8 });
    expect(saved.providerEpisodeId).toBeUndefined();
  });

  it('round-trips a season larger than one chunk with bounded strings', async () => {
    const { t, asUser } = await setup();
    const episodes = Array.from({ length: 121 }, (_, index) => ({
      season: 1,
      episode: index + 1,
      name: `Episode ${index + 1}${'x'.repeat(400)}`,
      overview: 'o'.repeat(800),
      imageUrl: `https://example.test/${'i'.repeat(600)}`,
    }));
    await t.mutation(internal.resolvedMetadata.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes,
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
      orderEpoch: 0,
    });
    const view = await asUser.query(api.resolvedMetadata.getSeasonView, {
      tmdbId: 88,
      season: 1,
      paginationOpts: { cursor: null, numItems: 100 },
    });
    expect(view.page).toHaveLength(1);
    expect(view.page[0]?.episodes).toHaveLength(120);
    expect(view.page[0]?.totalCount).toBe(121);
    expect(view.page[0]?.episodes[0]?.name).toHaveLength(300);
    expect(view.page[0]?.episodes[0]?.overview).toHaveLength(400);
    expect(view.isDone).toBe(false);
    const next = await asUser.query(api.resolvedMetadata.getSeasonView, {
      tmdbId: 88,
      season: 1,
      paginationOpts: { cursor: view.continueCursor, numItems: 100 },
    });
    expect(next.page[0]?.episodes).toHaveLength(1);
    expect(next.isDone).toBe(true);
    const storage = await t.run(async (ctx) => ({
      parent: await ctx.db
        .query('resolvedSeasons')
        .withIndex('by_tmdb_season', (query) => query.eq('tmdbId', 88).eq('season', 1))
        .unique(),
      chunks: await ctx.db.query('resolvedSeasonChunks').collect(),
    }));
    expect(storage.parent).toMatchObject({
      episodeCount: 121,
      chunkCount: 2,
      chunksComplete: true,
    });
    expect(storage.parent?.episodes).toBeUndefined();
    expect(storage.chunks.map((chunk) => chunk.episodes.length)).toEqual([120, 1]);
  });

  it('keeps the complete old season visible until a staged multi-chunk flip succeeds', async () => {
    const { t, asUser } = await setup(true);
    const now = Date.now();
    const attemptToken = 'staged-attempt';
    const leaseKey = 'metadata:tv:88';
    const titleValue = {
      ...movieTitle({
        tmdbId: 88,
        mediaType: 'tv',
        title: 'Versioned show',
        seasons: [{ season: 1, name: 'Season 1', episodeCount: 121 }],
        orderEpoch: 0,
      }),
      mediaType: 'tv' as const,
    };
    await t.run((ctx) => ctx.db.insert('resolvedTitles', titleValue));
    await t.mutation(internal.resolvedMetadata.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: [{ season: 1, episode: 1, name: 'Warm old episode' }],
      refreshedAt: now - 1_000,
      refreshAfter: now - 1_000 + 60_000,
      orderEpoch: 0,
    });
    const oldVersion = await t.run(async (ctx) => {
      for (const key of ['title:tv:88', 'season:88:1'])
        await ctx.db.insert('metadataRefreshRequests', {
          key,
          state: 'inFlight',
          lastRequestedAt: now,
          attemptToken,
          expiresAt: now + 60_000,
        });
      return (
        await ctx.db
          .query('resolvedSeasons')
          .withIndex('by_tmdb_season', (query) => query.eq('tmdbId', 88).eq('season', 1))
          .unique()
      )?.seasonVersion;
    });
    await t.mutation(internal.resolvedMetadata.claimRefresh, {
      key: leaseKey,
      token: attemptToken,
      leaseMs: 60_000,
    });
    const replacement = Array.from({ length: 121 }, (_, index) => ({
      season: 1,
      episode: index + 1,
      name: `New episode ${index + 1}`,
    }));
    const replacementTitle = {
      ...titleValue,
      title: 'Replacement show',
      metadataProvider: 'tvdb' as const,
      tvdbId: 900,
      seasonOrder: 'official',
      orderEpoch: 1,
      refreshedAt: now + 1,
    };
    const outcomes = [
      { key: 'title:tv:88', state: 'succeeded' as const },
      { key: 'season:88:1', state: 'succeeded' as const },
    ];
    await expect(
      t.mutation(internal.resolvedMetadata.commitRefresh, {
        title: replacementTitle,
        titleWrite: 'replace',
        season: {
          tmdbId: 88,
          season: 1,
          metadataProvider: 'tvdb',
          chunks: [replacement.slice(0, 120)],
          episodeCount: 121,
          chunkCount: 2,
          refreshedAt: now,
          refreshAfter: now + 60_000,
          orderEpoch: 1,
        },
        mapping: {
          tmdbId: 88,
          mediaType: 'tv',
          tvdbId: 900,
          seasonOrder: 'official',
          source: 'auto',
          orderEpoch: 1,
          updatedAt: now,
        },
        expectedMapping: { source: 'auto', orderEpoch: 0 },
        outcomes,
        attemptToken,
        leaseKey,
        leaseToken: attemptToken,
      }),
    ).resolves.toBe('staged');
    expect(
      await t.query(internal.resolvedMetadata.readTitle, { mediaType: 'tv', tmdbId: 88 }),
    ).toMatchObject({ title: 'Versioned show' });
    const stagedMapping = await t.query(internal.resolvedMetadata.readTitleMapping, {
      mediaType: 'tv',
      tmdbId: 88,
    });
    expect(stagedMapping).toMatchObject({ orderEpoch: 0 });
    expect(stagedMapping?.tvdbId).toBeUndefined();
    expect(
      await t.query(internal.resolvedMetadata.readSeason, { tmdbId: 88, season: 1 }),
    ).toMatchObject({ episodes: [{ name: 'Warm old episode' }] });
    expect(
      await asUser.query(api.resolvedMetadata.getSeasonRequestState, { tmdbId: 88, season: 1 }),
    ).toMatchObject({ state: 'inFlight' });
    expect(
      await asUser.query(api.resolvedMetadata.getSeasonView, {
        tmdbId: 88,
        season: 1,
        paginationOpts: { cursor: null, numItems: 1 },
      }),
    ).toMatchObject({ page: [{ episodes: [{ name: 'Warm old episode' }] }] });
    expect(
      await t.query(internal.resolvedMetadata.readTitle, { mediaType: 'tv', tmdbId: 88 }),
    ).toMatchObject({ title: 'Versioned show' });

    await t.mutation(internal.resolvedMetadata.appendRefreshSeasonChunk, {
      tmdbId: 88,
      season: 1,
      orderEpoch: 1,
      chunkIndex: 1,
      episodes: replacement.slice(120),
      attemptToken,
    });
    expect(
      await t.query(internal.resolvedMetadata.readSeason, { tmdbId: 88, season: 1 }),
    ).toMatchObject({ episodes: [{ name: 'Warm old episode' }] });
    expect(
      await asUser.query(api.resolvedMetadata.getSeasonView, {
        tmdbId: 88,
        season: 1,
        paginationOpts: { cursor: null, numItems: 1 },
      }),
    ).toMatchObject({ page: [{ episodes: [{ name: 'Warm old episode' }] }] });
    await expect(
      t.mutation(internal.resolvedMetadata.finalizeRefreshSeason, {
        tmdbId: 88,
        season: 1,
        outcomes,
        expectedMapping: { source: 'auto', orderEpoch: 0 },
        attemptToken,
        leaseKey,
        leaseToken: attemptToken,
      }),
    ).resolves.toBe(true);
    const published = await t.query(internal.resolvedMetadata.readSeason, {
      tmdbId: 88,
      season: 1,
    });
    expect(published?.episodes).toHaveLength(121);
    expect(published?.episodes[0]).toMatchObject({ name: 'New episode 1' });
    expect(
      await t.query(internal.resolvedMetadata.readTitle, { mediaType: 'tv', tmdbId: 88 }),
    ).toMatchObject({ title: 'Replacement show', orderEpoch: 1 });
    expect(
      await t.query(internal.resolvedMetadata.readTitleMapping, { mediaType: 'tv', tmdbId: 88 }),
    ).toMatchObject({ tvdbId: 900, seasonOrder: 'official', orderEpoch: 1 });
    expect(
      await asUser.query(api.resolvedMetadata.getSeasonRequestState, { tmdbId: 88, season: 1 }),
    ).toMatchObject({ state: 'succeeded' });
    expect(
      await t.run((ctx) =>
        ctx.db
          .query('resolvedSeasonChunks')
          .withIndex('by_tmdb_season_version_chunk', (query) =>
            query.eq('tmdbId', 88).eq('season', 1).eq('seasonVersion', oldVersion),
          )
          .collect(),
      ),
    ).toEqual([]);
  });

  it('marks a 1,200-episode season watched in bounded batches and reruns idempotently', async () => {
    const { t, asUser } = await setup(true);
    const itemId = await addItem(asUser);
    const episodes = Array.from({ length: 1_200 }, (_, index) => ({
      season: 1,
      episode: index + 1,
      name: `Episode ${index + 1}`,
      providerEpisodeId: 10_000 + index,
    }));
    await t.mutation(internal.resolvedMetadata.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes,
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
      orderEpoch: 0,
    });
    const view = await asUser.query(api.resolvedMetadata.getSeasonView, {
      tmdbId: 88,
      season: 1,
      paginationOpts: { cursor: null, numItems: 1_000 },
    });
    expect(view.page[0]?.episodes).toHaveLength(120);
    expect(view.page[0]?.totalCount).toBe(1_200);

    await expect(
      asUser.action(api.library.setSeasonWatched, { itemId, season: 1 }),
    ).resolves.toEqual({ processed: 1_200 });
    await expect(
      asUser.action(api.library.setSeasonWatched, { itemId, season: 1 }),
    ).resolves.toEqual({ processed: 1_200 });
    expect(await asUser.query(api.library.listEpisodes, { itemId, season: 1 })).toHaveLength(120);
    expect(
      await asUser.query(api.library.listEpisodes, { itemId, season: 1, pageCount: 2 }),
    ).toHaveLength(240);
    const saved = await asUser.query(api.library.listEpisodes, {
      itemId,
      season: 1,
      pageCount: 10,
    });
    expect(saved).toHaveLength(1_200);
    expect(saved.every((episode) => episode.watched)).toBe(true);
    expect(saved.at(-1)).toMatchObject({
      episode: 1_200,
      metadataProvider: 'tmdb',
      providerEpisodeId: 11_199,
    });
  }, 10_000);

  it('filters stale episode identities before applying the requested page limit', async () => {
    const { t, userId, asUser } = await setup();
    const itemId = await addItem(asUser);
    await t.run(async (ctx) => {
      await ctx.db.insert('titleMappings', {
        tmdbId: 88,
        mediaType: 'tv',
        source: 'manual',
        orderEpoch: 1,
        updatedAt: Date.now(),
      });
      await ctx.db.insert('resolvedTitles', {
        ...movieTitle({
          tmdbId: 88,
          mediaType: 'tv',
          title: 'Current show',
          metadataProvider: 'tmdb',
          orderEpoch: 1,
        }),
        mediaType: 'tv',
      });
      for (let episode = 1; episode <= 240; episode += 1)
        await ctx.db.insert('episodes', {
          userId,
          itemId,
          season: 1,
          episode,
          watched: true,
          tags: [],
          metadataProvider: episode <= 120 ? 'tvdb' : 'tmdb',
          ...(episode <= 120 && { seasonOrder: 'official' }),
        });
    });

    const page = await asUser.query(api.library.listEpisodes, { itemId, season: 1 });
    expect(page).toHaveLength(120);
    expect(page[0]?.episode).toBe(121);
    expect(page.at(-1)?.episode).toBe(240);
  });

  it('keeps current rows on page one after a 120-episode numbering shift', async () => {
    const { t, userId, asUser } = await setup();
    const itemId = await addItem(asUser);
    await t.mutation(internal.resolvedMetadata.putSeason, {
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

    const page = await asUser.query(api.library.listEpisodes, { itemId, season: 1 });
    expect(page).toHaveLength(120);
    expect(page[0]?.episode).toBe(101);
    expect(page.at(-1)?.episode).toBe(220);
  });

  it('enforces the public episode coordinate ceiling', async () => {
    const { asUser } = await setup();
    const itemId = await addItem(asUser);
    await expect(
      asUser.mutation(api.library.setEpisodeState, { itemId, season: 10_001, episode: 1 }),
    ).rejects.toThrow('Season must be an integer between 0 and 10000');
    await expect(
      asUser.mutation(api.library.setEpisodeState, { itemId, season: 1, episode: 10_001 }),
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
      t.mutation(internal.library.setSeasonWatchedBatch, {
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
    await t.mutation(internal.resolvedMetadata.putSeason, {
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

    await asUser.mutation(api.library.setEpisodeState, {
      itemId,
      season: 1,
      episode: 1,
      watched: true,
    });
    await expect(asUser.query(api.library.listEpisodeProgress, { itemId })).resolves.toEqual([
      {
        season: 1,
        total: 1,
        watchedCount: 1,
        currentTotal: 3,
        currentWatchedCount: 1,
        identityStale: false,
      },
    ]);
    await asUser.mutation(api.library.setEpisodeState, {
      itemId,
      season: 1,
      episode: 1,
      watched: false,
    });
    await expect(
      asUser.action(api.library.setSeasonWatched, { itemId, season: 1, watched: true }),
    ).resolves.toEqual({ processed: 3 });
    await expect(
      asUser.action(api.library.setSeasonWatched, { itemId, season: 1, watched: false }),
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

    await expect(asUser.query(api.library.listEpisodeProgress, { itemId })).resolves.toEqual([
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
    await t.mutation(internal.resolvedMetadata.putSeason, {
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
      asUser.query(api.library.listEpisodes, { itemId, season: 1 }),
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
    await t.mutation(internal.resolvedMetadata.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: canonical,
      refreshedAt: 100,
      refreshAfter: 100 + 60_000,
      orderEpoch: 0,
    });
    for (const episode of [1, 2])
      await asUser.mutation(api.library.setEpisodeState, {
        itemId,
        season: 1,
        episode,
        watched: true,
      });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await t.mutation(internal.resolvedMetadata.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: canonical,
      refreshedAt: 200,
      refreshAfter: 200 + 60_000,
      orderEpoch: 0,
    });
    await expect(asUser.query(api.library.listEpisodeProgress, { itemId })).resolves.toMatchObject([
      { currentTotal: 2, currentWatchedCount: 2, identityStale: false },
    ]);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(asUser.query(api.library.listEpisodeProgress, { itemId })).resolves.toMatchObject([
      { currentTotal: 2, currentWatchedCount: 2, identityStale: false },
    ]);
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
    await t.mutation(internal.resolvedMetadata.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: canonical,
      refreshedAt: 100,
      refreshAfter: 100 + 60_000,
      orderEpoch: 0,
    });
    for (const episode of [1, 2])
      await asUser.mutation(api.library.setEpisodeState, {
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
    await t.mutation(internal.resolvedMetadata.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: canonical,
      refreshedAt: 200,
      refreshAfter: 200 + 60_000,
      orderEpoch: 1,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(asUser.query(api.library.listEpisodeProgress, { itemId })).resolves.toMatchObject([
      { currentTotal: 2, currentWatchedCount: 2, identityStale: false },
    ]);
  });

  it('continues a season batch after a same-epoch canonical refresh interleaves', async () => {
    const { t, asUser } = await setup(true);
    const itemId = await addItem(asUser);
    const episodes = Array.from({ length: 1_200 }, (_, index) => ({
      season: 1,
      episode: index + 1,
      name: `Episode ${index + 1}`,
    }));
    await t.mutation(internal.resolvedMetadata.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes,
      refreshedAt: 100,
      refreshAfter: 100 + 60_000,
      orderEpoch: 0,
    });

    const plan = await t.query(internal.library.getSeasonWatchedPlan, {
      userId: (await t.run((ctx) => ctx.db.get(itemId)))!.userId,
      itemId,
      season: 1,
      watched: true,
    });
    const first = await t.mutation(internal.library.setSeasonWatchedBatch, {
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
    await t.mutation(internal.resolvedMetadata.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: [{ season: 1, episode: 0, name: 'Inserted correction' }, ...episodes],
      refreshedAt: 200,
      refreshAfter: 200 + 60_000,
      orderEpoch: 0,
    });
    const restarted = await t.mutation(internal.library.setSeasonWatchedBatch, {
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
      asUser.action(api.library.setSeasonWatched, { itemId, season: 1 }),
    ).resolves.toEqual({ processed: 1_201 });
    const saved = await asUser.query(api.library.listEpisodes, {
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
      t.mutation(internal.resolvedMetadata.pruneCanonicalData, { phase: 'titles' }),
    ).resolves.toMatchObject({ deleted: 1 });
    const ids = await t.run(async (ctx) =>
      (await ctx.db.query('resolvedTitles').collect()).map((row) => row.tmdbId),
    );
    expect(ids).toEqual(expect.arrayContaining([78, 88]));
    expect(ids).not.toContain(77);
  });

  it('namespaces canonical title references by media type during garbage collection', async () => {
    const { t, asUser } = await setup();
    await asUser.mutation(api.library.addItem, {
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
      t.mutation(internal.resolvedMetadata.pruneCanonicalData, { phase: 'titles' }),
    ).resolves.toMatchObject({ deleted: 1 });
    await expect(
      t.query(internal.resolvedMetadata.readTitle, { mediaType: 'movie', tmdbId: 77 }),
    ).resolves.toMatchObject({ title: 'Stored movie' });
    await expect(
      t.query(internal.resolvedMetadata.readTitle, { mediaType: 'tv', tmdbId: 77 }),
    ).resolves.toBeNull();
  });

  it('seeds title and season snapshots at the active mapping epoch', async () => {
    const { t, asUser } = await setup();
    await addItem(asUser);
    await asUser.mutation(api.library.addItem, {
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
      t.action(internal.resolvedMetadata.seedFromProviderSnapshots, {}),
    ).resolves.toMatchObject({ found: 2, seeded: 2 });
    await expect(
      t.query(internal.resolvedMetadata.readTitle, { mediaType: 'tv', tmdbId: 88 }),
    ).resolves.toMatchObject({ title: 'Seeded show', orderEpoch: 4 });
    await expect(
      t.query(internal.resolvedMetadata.readSeason, { tmdbId: 88, season: 1 }),
    ).resolves.toMatchObject({ orderEpoch: 4, episodes: [{ name: 'Seeded episode' }] });
    await expect(
      t.query(internal.resolvedMetadata.readTitleMapping, { mediaType: 'movie', tmdbId: 77 }),
    ).resolves.toMatchObject({ source: 'auto', orderEpoch: 0 });
    await expect(
      t.query(internal.resolvedMetadata.readTitle, { mediaType: 'movie', tmdbId: 77 }),
    ).resolves.toMatchObject({ title: 'Seeded movie', orderEpoch: 0 });
  });

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
      t.mutation(internal.resolvedMetadata.pruneCanonicalData, { phase: 'mappings' }),
    ).resolves.toMatchObject({ deleted: 0 });
    await expect(
      t.query(internal.resolvedMetadata.readTitleMapping, { mediaType: 'tv', tmdbId: 88 }),
    ).resolves.toMatchObject({ source: 'manual', orderEpoch: 3 });
    await expect(
      t.query(internal.resolvedMetadata.readTitleMapping, { mediaType: 'tv', tmdbId: 89 }),
    ).resolves.toMatchObject({ source: 'auto', orderEpoch: 0 });
  });

  it('publishes shared title metadata into item projections before list reads', async () => {
    const { t, asUser } = await setup();
    await t.run((ctx) => ctx.db.insert('users', { clerkId: 'user_shared_metadata_other' }));
    const other = t.withIdentity({ subject: 'user_shared_metadata_other' });
    const firstId = await asUser.mutation(api.library.addItem, {
      tmdbId: 77,
      mediaType: 'movie',
      title: 'Old fallback',
      status: 'watchlist',
    });
    const secondId = await other.mutation(api.library.addItem, {
      tmdbId: 77,
      mediaType: 'movie',
      title: 'Another fallback',
      status: 'watchlist',
    });
    await t.run((ctx) => ctx.db.insert('resolvedTitles', movieTitle({ title: 'Fresh shared' })));
    await t.mutation(internal.resolvedMetadata.refreshItemProjections, {
      mediaType: 'movie',
      tmdbId: 77,
    });

    expect(await asUser.query(api.library.listItems, {})).toMatchObject([
      { _id: firstId, title: 'Fresh shared' },
    ]);
    expect(await other.query(api.library.listItems, {})).toMatchObject([
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
      t.mutation(internal.resolvedMetadata.commitRefresh, {
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
      t.query(internal.resolvedMetadata.readTitle, { mediaType: 'tv', tmdbId: 88 }),
    ).resolves.toMatchObject({ title: 'Current epoch title', orderEpoch: 1 });
    await expect(
      asUser.query(api.resolvedMetadata.getSeasonView, {
        tmdbId: 88,
        season: 1,
        paginationOpts: { cursor: null, numItems: 1 },
      }),
    ).resolves.toMatchObject({ page: [{ episodes: [{ name: 'Current episode' }] }] });
    await expect(
      asUser.query(api.resolvedMetadata.getSeasonRequestState, { tmdbId: 88, season: 1 }),
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
    await t.mutation(internal.resolvedMetadata.claimRefresh, {
      key: 'metadata:movie:77',
      token: 'synchronous:adopter',
      leaseMs: 60_000,
    });

    await t.action(internal.resolvedMetadata.orchestrateRefresh, {
      userId,
      mediaType: 'movie',
      tmdbId: 77,
      keys: ['title:movie:77'],
      attemptToken: 'scheduled-before-adoption',
    });
    await expect(
      t.query(internal.resolvedMetadata.readRefreshRequest, { key: 'title:movie:77' }),
    ).resolves.toMatchObject({
      state: 'inFlight',
      attemptToken: 'scheduled-before-adoption',
    });
    await expect(
      t.mutation(internal.resolvedMetadata.adoptRefreshRequests, {
        keys: ['title:movie:77'],
        attemptToken: 'synchronous:adopter',
        leaseKey: 'metadata:movie:77',
        leaseToken: 'synchronous:adopter',
      }),
    ).resolves.toEqual(['title:movie:77']);
    await expect(
      t.query(internal.resolvedMetadata.readRefreshRequest, { key: 'title:movie:77' }),
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
    await t.mutation(internal.resolvedMetadata.claimRefresh, {
      key: 'metadata:movie:77',
      token: 'scheduled:slow-attempt',
      leaseMs: 1_000,
      requestKeys: ['title:movie:77'],
      attemptToken: 'slow-attempt',
    });

    vi.mocked(Date.now).mockReturnValue(startedAt + 1_500);
    await expect(
      t.mutation(internal.resolvedMetadata.renewRefreshAttempt, {
        key: 'metadata:movie:77',
        token: 'scheduled:slow-attempt',
        leaseMs: 60_000,
        requestKeys: ['title:movie:77'],
        attemptToken: 'slow-attempt',
      }),
    ).resolves.toBe(startedAt + 61_500);
    await expect(
      t.mutation(internal.resolvedMetadata.commitRefresh, {
        title: movieTitle({ title: 'Slow but healthy' }),
        outcomes: [{ key: 'title:movie:77', state: 'succeeded' }],
        attemptToken: 'slow-attempt',
        leaseKey: 'metadata:movie:77',
        leaseToken: 'scheduled:slow-attempt',
      }),
    ).resolves.toBe(true);
    await expect(
      t.query(internal.resolvedMetadata.readRefreshRequest, { key: 'title:movie:77' }),
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
    await t.mutation(internal.resolvedMetadata.claimRefresh, {
      key: 'metadata:tv:88',
      token: attemptToken,
      leaseMs: 60_000,
    });
    await expect(
      t.mutation(internal.resolvedMetadata.commitRefresh, {
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
    await t.mutation(internal.resolvedMetadata.appendRefreshSeasonChunk, {
      tmdbId: 88,
      season: 1,
      orderEpoch: 0,
      chunkIndex: 1,
      episodes: [{ season: 1, episode: 2, name: 'Two' }],
      attemptToken,
    });
    await expect(
      t.mutation(internal.resolvedMetadata.finalizeRefreshSeason, {
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
      t.query(internal.resolvedMetadata.readRefreshRequest, { key: 'season:88:1' }),
    ).resolves.toMatchObject({ state: 'succeeded' });
  });

  it('prunes stale staging parents and orphan chunks even for referenced titles', async () => {
    const { t, asUser } = await setup();
    await addItem(asUser);
    const old = Date.now() - 3 * 60 * 1000;
    await t.mutation(internal.resolvedMetadata.putSeason, {
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
      t.mutation(internal.resolvedMetadata.pruneCanonicalData, { phase: 'seasons' }),
    ).resolves.toMatchObject({ deleted: 2 });
    await expect(
      t.mutation(internal.resolvedMetadata.pruneCanonicalData, { phase: 'chunks' }),
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
      t.mutation(internal.resolvedMetadata.pruneCanonicalData, { phase: 'seasons' }),
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

    const decision = (await asUser.mutation(api.resolvedMetadata.touchTitle, {
      mediaType: 'tv',
      tmdbId: 88,
      title: 'Untrusted title',
      season: 999,
    })) as any;
    expect(decision).toMatchObject({
      title: { scheduled: false, reason: 'debounced' },
      season: { scheduled: true },
    });
    await t.action(internal.resolvedMetadata.orchestrateSeasonRefresh, {
      userId,
      tmdbId: 88,
      season: 999,
      key: 'season:88:999',
      attemptToken: decision.season.attemptToken,
    });

    await expect(
      asUser.query(api.resolvedMetadata.getSeasonRequestState, { tmdbId: 88, season: 999 }),
    ).resolves.toMatchObject({ state: 'notFound', errorCode: 'season_not_found' });
    await expect(t.run((ctx) => ctx.db.query('resolvedSeasons').collect())).resolves.toEqual([]);
    await expect(
      asUser.mutation(api.resolvedMetadata.touchTitle, {
        mediaType: 'tv',
        tmdbId: 88,
        season: 999,
      }),
    ).resolves.toMatchObject({ season: { scheduled: false, reason: 'notFound' } });
  });

  it('uses authoritative TMDB names for TVDB fallback discovery, never the touch title', async () => {
    const { t, userId, asUser } = await setup();
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'tmdb-key');
    vi.stubEnv('TVDB_API_KEY', 'tvdb-key');
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.endsWith('/login'))
          return new Response(JSON.stringify({ data: { token: 'tvdb-token' } }));
        if (url.includes('api.themoviedb.org/3/tv/88/season/1'))
          return new Response(
            JSON.stringify({
              season_number: 1,
              episodes: [{ id: 1, season_number: 1, episode_number: 1, name: 'TMDB episode' }],
            }),
          );
        if (url.includes('api.themoviedb.org/3/tv/88'))
          return new Response(
            JSON.stringify({
              id: 88,
              name: 'Authoritative Show',
              original_name: 'Authoritative Original',
              genres: [],
              credits: {},
              seasons: [{ season_number: 1, name: 'Season 1', episode_count: 1 }],
            }),
          );
        if (url.includes('/search/remoteid/88')) return new Response(JSON.stringify({ data: [] }));
        if (url.includes('/search?'))
          return new Response(
            JSON.stringify({
              data: [{ id: 'series-999', type: 'series', name: 'Wrong Anime' }],
            }),
          );
        return new Response('{}', { status: 404 });
      }),
    );

    const decision = (await asUser.mutation(api.resolvedMetadata.touchTitle, {
      mediaType: 'tv',
      tmdbId: 88,
      title: 'Wrong Anime',
      season: 1,
    })) as any;
    await t.action(internal.resolvedMetadata.orchestrateRefresh, {
      userId,
      mediaType: 'tv',
      tmdbId: 88,
      title: 'Wrong Anime',
      season: 1,
      keys: ['title:tv:88', 'season:88:1'],
      attemptToken: decision.title.attemptToken,
    });

    await expect(
      t.query(internal.resolvedMetadata.readTitle, { mediaType: 'tv', tmdbId: 88 }),
    ).resolves.toMatchObject({
      title: 'Authoritative Show',
      metadataProvider: 'tmdb',
    });
    await expect(
      t.query(internal.resolvedMetadata.readTitleMapping, { mediaType: 'tv', tmdbId: 88 }),
    ).resolves.not.toMatchObject({ tvdbId: 999 });
    expect(requestedUrls.some((url) => url.includes('query=Wrong%20Anime'))).toBe(false);
    expect(requestedUrls.some((url) => url.includes('/series/999/extended'))).toBe(false);
    expect(requestedUrls.some((url) => url.includes('query=Authoritative%20Show'))).toBe(true);
    expect(requestedUrls.some((url) => url.includes('query=Authoritative%20Original'))).toBe(true);
  });
});
