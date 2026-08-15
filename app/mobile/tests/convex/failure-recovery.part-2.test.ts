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

describe('metadata failure recovery', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('leaves an interrupted staged write in-flight until expiry re-touch schedules recovery', async () => {
    const { t, asUser } = await setup(true);
    const now = Date.now();
    const attemptToken = 'interrupted-attempt';
    const leaseKey = 'metadata:tv:88';
    const titleValue = {
      ...movieTitle({
        tmdbId: 88,
        mediaType: 'tv',
        title: 'Interrupted show',
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
      episodes: [{ season: 1, episode: 1, name: 'Still visible' }],
      refreshedAt: now - 1_000,
      refreshAfter: now - 1_000 + 60_000,
      orderEpoch: 0,
    });
    await t.run((ctx) =>
      ctx.db.insert('metadataRefreshRequests', {
        key: 'season:88:1',
        state: 'inFlight',
        lastRequestedAt: now,
        attemptToken,
        expiresAt: now + 60_000,
      }),
    );
    await t.mutation(internal.resolvedMetadata.claimRefresh, {
      key: leaseKey,
      token: attemptToken,
      leaseMs: 60_000,
    });
    await expect(
      t.mutation(internal.resolvedMetadata.commitRefresh, {
        title: { ...titleValue, title: 'Never published' },
        titleWrite: 'replace',
        season: {
          tmdbId: 88,
          season: 1,
          metadataProvider: 'tmdb',
          chunks: [
            Array.from({ length: 120 }, (_, index) => ({
              season: 1,
              episode: index + 1,
              name: `Interrupted ${index + 1}`,
            })),
          ],
          episodeCount: 121,
          chunkCount: 2,
          refreshedAt: now,
          refreshAfter: now + 60_000,
          orderEpoch: 0,
        },
        expectedMapping: { source: 'auto', orderEpoch: 0 },
        outcomes: [{ key: 'season:88:1', state: 'succeeded' }],
        attemptToken,
        leaseKey,
        leaseToken: attemptToken,
      }),
    ).resolves.toBe('staged');
    expect(
      await t.query(internal.resolvedMetadata.readRefreshRequest, { key: 'season:88:1' }),
    ).toMatchObject({ state: 'inFlight', attemptToken });
    expect(
      await t.query(internal.resolvedMetadata.readTitle, { mediaType: 'tv', tmdbId: 88 }),
    ).toMatchObject({ title: 'Interrupted show' });

    await t.run(async (ctx) => {
      const request = await ctx.db
        .query('metadataRefreshRequests')
        .withIndex('by_key', (query) => query.eq('key', 'season:88:1'))
        .unique();
      const lease = await ctx.db
        .query('metadataRefreshLeases')
        .withIndex('by_key', (query) => query.eq('key', leaseKey))
        .unique();
      await ctx.db.patch(request!._id, { expiresAt: now - 1 });
      await ctx.db.patch(lease!._id, { expiresAt: now - 1 });
    });
    const retry = (await asUser.mutation(api.resolvedMetadata.touchTitle, {
      mediaType: 'tv',
      tmdbId: 88,
      title: 'Interrupted show',
      season: 1,
    })) as any;
    expect(retry.scheduled).toBe(true);
    expect(retry.season.attemptToken).not.toBe(attemptToken);
    expect(
      await t.query(internal.resolvedMetadata.readSeason, { tmdbId: 88, season: 1 }),
    ).toMatchObject({ episodes: [{ name: 'Still visible' }] });
    expect(
      await t.query(internal.resolvedMetadata.readTitle, { mediaType: 'tv', tmdbId: 88 }),
    ).toMatchObject({ title: 'Interrupted show' });
  });

  it('aborts a season batch on epoch change and an idempotent rerun converges', async () => {
    const { t, userId, asUser } = await setup(true);
    const itemId = await addItem(asUser);
    const episodes = Array.from({ length: 600 }, (_, index) => ({
      season: 1,
      episode: index + 1,
      name: `Old ${index + 1}`,
    }));
    await t.run((ctx) =>
      ctx.db.insert('titleMappings', {
        tmdbId: 88,
        mediaType: 'tv',
        source: 'manual',
        orderEpoch: 0,
        updatedAt: Date.now(),
      }),
    );
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
      userId,
      itemId,
      season: 1,
      watched: true,
    });
    await t.mutation(internal.library.setSeasonWatchedBatch, {
      userId,
      itemId,
      season: 1,
      watched: true,
      offset: 0,
      expectedRefreshedAt: plan.refreshedAt,
      expectedOrderEpoch: plan.orderEpoch,
      expectedMetadataProvider: plan.metadataProvider,
    });
    await t.run(async (ctx) => {
      const mapping = await ctx.db
        .query('titleMappings')
        .withIndex('by_tmdb', (query) => query.eq('mediaType', 'tv').eq('tmdbId', 88))
        .unique();
      await ctx.db.patch(mapping!._id, { orderEpoch: 1, updatedAt: Date.now() });
    });
    await t.mutation(internal.resolvedMetadata.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: episodes.map((episode) => ({ ...episode, name: `New ${episode.episode}` })),
      refreshedAt: 200,
      refreshAfter: 200 + 60_000,
      orderEpoch: 1,
    });
    await expect(
      t.mutation(internal.library.setSeasonWatchedBatch, {
        userId,
        itemId,
        season: 1,
        watched: true,
        offset: 120,
        expectedRefreshedAt: plan.refreshedAt,
        expectedOrderEpoch: plan.orderEpoch,
        expectedMetadataProvider: plan.metadataProvider,
      }),
    ).rejects.toMatchObject({ data: { code: 'stale_epoch', retryable: true } });

    await expect(
      asUser.action(api.library.setSeasonWatched, { itemId, season: 1 }),
    ).resolves.toEqual({ processed: 600 });
    expect(
      await asUser.query(api.library.listEpisodes, { itemId, season: 1, pageCount: 5 }),
    ).toHaveLength(600);
  });

  it('aborts a later season batch when the provider changes at the same epoch', async () => {
    const { t, userId, asUser } = await setup(true);
    const itemId = await addItem(asUser);
    const episodes = Array.from({ length: 600 }, (_, index) => ({
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
      userId,
      itemId,
      season: 1,
      watched: true,
      orderEpoch: 0,
      metadataProvider: 'tmdb',
    });
    await t.mutation(internal.library.setSeasonWatchedBatch, {
      userId,
      itemId,
      season: 1,
      watched: true,
      offset: 0,
      expectedRefreshedAt: plan.refreshedAt,
      expectedOrderEpoch: plan.orderEpoch,
      expectedMetadataProvider: plan.metadataProvider,
    });
    await t.mutation(internal.resolvedMetadata.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tvdb',
      episodes: episodes.map((episode, index) => ({
        ...episode,
        providerEpisodeId: 90_000 + index,
      })),
      refreshedAt: 200,
      refreshAfter: 200 + 60_000,
      orderEpoch: 0,
    });
    await expect(
      t.mutation(internal.library.setSeasonWatchedBatch, {
        userId,
        itemId,
        season: 1,
        watched: true,
        offset: 120,
        expectedRefreshedAt: plan.refreshedAt,
        expectedOrderEpoch: plan.orderEpoch,
        expectedMetadataProvider: plan.metadataProvider,
      }),
    ).rejects.toMatchObject({ data: { code: 'stale_epoch', retryable: true } });
  });

  it('aborts an auto-mapping commit when the same identity and epoch become manual mid-flight', async () => {
    const { t } = await setup();
    const now = Date.now();
    await t.run(async (ctx) => {
      await ctx.db.insert('resolvedTitles', {
        ...movieTitle({
          tmdbId: 88,
          mediaType: 'tv',
          title: 'Visible before refresh',
          metadataProvider: 'tvdb',
          tvdbId: 111,
          seasonOrder: 'official',
          orderEpoch: 0,
          refreshedAt: 1,
        }),
        mediaType: 'tv',
      });
      await ctx.db.insert('titleMappings', {
        tmdbId: 88,
        mediaType: 'tv',
        tvdbId: 111,
        seasonOrder: 'official',
        source: 'auto',
        orderEpoch: 0,
        updatedAt: 1,
      });
      await ctx.db.insert('metadataRefreshRequests', {
        key: 'title:tv:88',
        state: 'inFlight',
        lastRequestedAt: now,
        attemptToken: 'auto-attempt',
        expiresAt: now + 60_000,
      });
    });
    await t.mutation(internal.resolvedMetadata.claimRefresh, {
      key: 'metadata:tv:88',
      token: 'auto-lease',
      leaseMs: 60_000,
    });

    await t.mutation(internal.resolvedMetadata.setTitleMapping, {
      tmdbId: 88,
      mediaType: 'tv',
      tvdbId: 111,
      seasonOrder: 'official',
      source: 'manual',
    });
    await expect(
      t.mutation(internal.resolvedMetadata.commitRefresh, {
        title: {
          ...movieTitle({
            tmdbId: 88,
            mediaType: 'tv',
            title: 'Resolved against auto',
            metadataProvider: 'tvdb',
            tvdbId: 111,
            seasonOrder: 'official',
            orderEpoch: 0,
          }),
          mediaType: 'tv',
        },
        mapping: {
          tmdbId: 88,
          mediaType: 'tv',
          tvdbId: 111,
          seasonOrder: 'official',
          source: 'auto',
          orderEpoch: 0,
          updatedAt: now,
        },
        expectedMapping: {
          tvdbId: 111,
          seasonOrder: 'official',
          source: 'auto',
          orderEpoch: 0,
        },
        outcomes: [{ key: 'title:tv:88', state: 'succeeded' }],
        attemptToken: 'auto-attempt',
        leaseKey: 'metadata:tv:88',
        leaseToken: 'auto-lease',
      }),
    ).resolves.toBe('mappingChanged');
    await expect(
      t.query(internal.resolvedMetadata.readTitle, { mediaType: 'tv', tmdbId: 88 }),
    ).resolves.toMatchObject({ title: 'Visible before refresh', orderEpoch: 0 });
    await expect(
      t.query(internal.resolvedMetadata.readTitleMapping, { mediaType: 'tv', tmdbId: 88 }),
    ).resolves.toMatchObject({ source: 'manual', orderEpoch: 0 });
    await expect(
      t.query(internal.resolvedMetadata.readRefreshRequest, { key: 'title:tv:88' }),
    ).resolves.toMatchObject({ state: 'inFlight', attemptToken: 'auto-attempt' });
  });

  it('rejects an unrelated TMDB remote-id result and uses verified title search', async () => {
    const { t, userId } = await setup();
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
        if (url.includes('api.themoviedb.org/3/tv/124'))
          return new Response(
            JSON.stringify({
              id: 124,
              name: 'Authoritative Anime',
              original_name: 'Authoritative Original',
              genres: [],
              credits: {},
              seasons: [],
            }),
          );
        if (url.includes('/search/remoteid/124'))
          return new Response(
            JSON.stringify({
              data: [
                {
                  sourceName: 'TheMovieDB.com',
                  series: { id: 111, name: 'Unrelated Anime', aliases: ['Wrong Alias'] },
                },
              ],
            }),
          );
        if (url.includes('/search?'))
          return new Response(
            JSON.stringify({
              data: [{ id: 'series-999', type: 'series', name: 'Authoritative Anime' }],
            }),
          );
        if (url.includes('/series/999/extended'))
          return new Response(
            JSON.stringify({
              data: {
                name: 'Authoritative Anime',
                genres: [{ name: 'Anime' }],
                seasons: [],
              },
            }),
          );
        return new Response('{}', { status: 404 });
      }),
    );

    await expect(
      t.action(internal.resolvedMetadata.resolveTitleForUser, {
        userId,
        mediaType: 'tv',
        tmdbId: 124,
        title: 'Untrusted touch title',
      }),
    ).resolves.toMatchObject({ tvdbId: 999, title: 'Authoritative Anime' });
    expect(requestedUrls.some((url) => url.includes('/series/111/extended'))).toBe(false);
    expect(requestedUrls.some((url) => url.includes('query=Authoritative%20Anime'))).toBe(true);
    expect(requestedUrls.some((url) => url.includes('/series/999/extended'))).toBe(true);
  });
});
