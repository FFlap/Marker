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
});
