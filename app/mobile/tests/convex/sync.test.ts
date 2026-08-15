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
  const asUser = Object.assign(t.withIdentity({ subject: clerkId }), {
    recordWatch: (args: Parameters<typeof t.action>[1]) =>
      t.action(internal.sync.recordWatchFromExtensionInternal, { ...args, userId }),
  });
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

describe('watch sync', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('recordWatch stamps the canonical provider episode id', async () => {
    const { t, asUser } = await setup();
    const itemId = await addItem(asUser);
    await t.run((ctx) =>
      ctx.db.insert('resolvedTitles', {
        ...movieTitle({
          tmdbId: 88,
          mediaType: 'tv',
          title: 'Stored show',
          episodeRunTime: [24],
          seasons: [{ season: 1, name: 'Season 1', episodeCount: 2 }],
        }),
        mediaType: 'tv',
      }),
    );
    await t.mutation(internal.resolvedMetadata.requests.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: [
        { season: 1, episode: 1, name: 'Pilot', runtime: 24, providerEpisodeId: 12345 },
        { season: 1, episode: 2, name: 'Next', runtime: 24, providerEpisodeId: 12346 },
      ],
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
      orderEpoch: 0,
    });

    await asUser.recordWatch({
      service: 'netflix',
      seriesTitle: 'Stored show',
      seasonNumber: 1,
      episodeNumber: 1,
    });
    expect(
      await asUser.query(api.library.episodes.listEpisodes, { itemId, season: 1 }),
    ).toMatchObject([
      {
        metadataProvider: 'tmdb',
        providerEpisodeId: 12345,
        season: 1,
        episode: 1,
      },
    ]);
    expect(await t.run((ctx) => ctx.db.get(itemId))).toMatchObject({
      nextEpisode: { season: 1, episode: 2, name: 'Next', providerEpisodeId: 12346 },
    });
  });

  it('CAS-protects recordWatch from a same-epoch numbering correction', async () => {
    const { t, userId, asUser } = await setup();
    const itemId = await addItem(asUser);
    await t.run((ctx) =>
      ctx.db.insert('resolvedTitles', {
        ...movieTitle({
          tmdbId: 88,
          mediaType: 'tv',
          title: 'Stored show',
          seasons: [{ season: 1, name: 'Season 1', episodeCount: 2 }],
          refreshAfter: Date.now() + 60_000,
        }),
        mediaType: 'tv',
      }),
    );
    await t.mutation(internal.resolvedMetadata.requests.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: [{ season: 1, episode: 1, name: 'Target episode' }],
      refreshedAt: 100,
      refreshAfter: Date.now() + 60_000,
      orderEpoch: 0,
    });
    await t.mutation(internal.resolvedMetadata.requests.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: [
        { season: 1, episode: 1, name: 'Different episode' },
        { season: 1, episode: 2, name: 'Target episode' },
      ],
      refreshedAt: 200,
      refreshAfter: Date.now() + 60_000,
      orderEpoch: 0,
    });

    await expect(
      t.mutation(internal.sync.recordWatchInternal, {
        userId,
        itemId,
        season: 1,
        episode: 1,
        matchedOrderEpoch: 0,
        matchedProvider: 'tmdb',
        matchedSeasonRefreshedAt: 100,
      }),
    ).rejects.toMatchObject({ data: { code: 'stale_season_version', retryable: true } });
    expect(await asUser.query(api.library.episodes.listEpisodes, { itemId, season: 1 })).toEqual(
      [],
    );

    await expect(
      asUser.recordWatch({
        service: 'netflix',
        seriesTitle: 'Stored show',
        episodeTitle: 'Target episode',
      }),
    ).resolves.toMatchObject({ ok: true, season: 1, episode: 2 });
    expect(
      await asUser.query(api.library.episodes.listEpisodes, { itemId, season: 1 }),
    ).toMatchObject([{ season: 1, episode: 2, watched: true }]);
  });

  it('rejects a sync commit if its matched mapping changed', async () => {
    const { t, userId, asUser } = await setup();
    const itemId = await addItem(asUser);
    await t.run((ctx) =>
      ctx.db.insert('titleMappings', {
        tmdbId: 88,
        mediaType: 'tv',
        tvdbId: 2,
        seasonOrder: 'dvd',
        source: 'manual',
        orderEpoch: 2,
        updatedAt: Date.now(),
      }),
    );
    await expect(
      t.mutation(internal.sync.recordWatchInternal, {
        userId,
        itemId,
        season: 1,
        episode: 1,
        matchedOrderEpoch: 1,
        matchedProvider: 'tvdb',
      }),
    ).rejects.toMatchObject({ data: { code: 'stale_epoch' } });
  });

  it('keeps compact progress after a numbering correction while the guide hides the stale row', async () => {
    vi.useFakeTimers();
    const { t, userId, asUser } = await setup();
    const itemId = await addItem(asUser);
    await t.run((ctx) =>
      ctx.db.insert('resolvedTitles', {
        ...movieTitle({
          tmdbId: 88,
          mediaType: 'tv',
          title: 'Corrected show',
          seasons: [{ season: 1, name: 'Season 1', episodeCount: 1 }],
        }),
        mediaType: 'tv',
      }),
    );
    await t.mutation(internal.resolvedMetadata.requests.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: [{ season: 1, episode: 1, name: 'Old slot', providerEpisodeId: 101 }],
      refreshedAt: 100,
      refreshAfter: 100 + 60_000,
      orderEpoch: 0,
    });
    await t.mutation(internal.sync.recordWatchInternal, {
      userId,
      itemId,
      season: 1,
      episode: 1,
      matchedOrderEpoch: 0,
      matchedProvider: 'tmdb',
      matchedSeasonRefreshedAt: 100,
    });
    await t.mutation(internal.resolvedMetadata.requests.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: [{ season: 1, episode: 1, name: 'Replacement slot', providerEpisodeId: 202 }],
      refreshedAt: 200,
      refreshAfter: 200 + 60_000,
      orderEpoch: 0,
    });

    await expect(
      asUser.query(api.library.episodes.listEpisodes, { itemId, season: 1 }),
    ).resolves.toEqual([]);
    await expect(
      asUser.query(api.library.episodes.listEpisodeProgress, { itemId }),
    ).resolves.toEqual([
      {
        season: 1,
        watchedCount: 1,
        total: 1,
        currentWatchedCount: 1,
        currentTotal: 1,
        identityStale: false,
      },
    ]);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(
      asUser.query(api.library.episodes.listEpisodeProgress, { itemId }),
    ).resolves.toEqual([
      {
        season: 1,
        watchedCount: 1,
        total: 1,
        currentWatchedCount: 0,
        currentTotal: 1,
        identityStale: false,
      },
    ]);
    await expect(asUser.query(api.stats.profile, {})).resolves.toMatchObject({
      episodesWatched: 1,
    });
  });

  it('rebuilds current progress and marks only canonical tuples after a numbering correction', async () => {
    vi.useFakeTimers();
    const { t, userId, asUser } = await setup();
    const itemId = await addItem(asUser);
    await t.mutation(internal.resolvedMetadata.requests.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: [{ season: 1, episode: 1, name: 'Old E1', providerEpisodeId: 101 }],
      refreshedAt: 100,
      refreshAfter: 100 + 60_000,
      orderEpoch: 0,
    });
    await t.mutation(internal.sync.recordWatchInternal, {
      userId,
      itemId,
      season: 1,
      episode: 1,
      matchedOrderEpoch: 0,
      matchedProvider: 'tmdb',
      matchedSeasonRefreshedAt: 100,
    });
    await t.mutation(internal.resolvedMetadata.requests.putSeason, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: [{ season: 1, episode: 101, name: 'Current E101', providerEpisodeId: 101 }],
      refreshedAt: 200,
      refreshAfter: 200 + 60_000,
      orderEpoch: 0,
    });

    await expect(
      asUser.query(api.library.episodes.listEpisodeProgress, { itemId }),
    ).resolves.toMatchObject([
      { season: 1, currentWatchedCount: 1, currentTotal: 1, identityStale: false },
    ]);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await expect(
      asUser.query(api.library.episodes.listEpisodeProgress, { itemId }),
    ).resolves.toMatchObject([
      { season: 1, currentWatchedCount: 0, currentTotal: 1, identityStale: false },
    ]);
    await expect(
      asUser.action(api.library.seasonWatched.setSeasonWatched, {
        itemId,
        season: 1,
        watched: true,
      }),
    ).resolves.toEqual({ processed: 1 });
    await expect(
      asUser.query(api.library.episodes.listEpisodes, { itemId, season: 1 }),
    ).resolves.toMatchObject([{ episode: 101, providerEpisodeId: 101, watched: true }]);
    await expect(
      asUser.query(api.library.episodes.listEpisodeProgress, { itemId }),
    ).resolves.toMatchObject([
      { season: 1, currentWatchedCount: 1, currentTotal: 1, identityStale: false },
    ]);
    await expect(
      t.run((ctx) =>
        ctx.db
          .query('episodes')
          .withIndex('by_item', (query) =>
            query.eq('itemId', itemId).eq('season', 1).eq('episode', 1),
          )
          .unique(),
      ),
    ).resolves.toMatchObject({ episode: 1, watched: true });
  });

  it('rematches once after stale_epoch before surfacing any second retryable conflict', async () => {
    const commit = vi
      .fn<(match: { episode: number }) => Promise<boolean>>()
      .mockRejectedValueOnce(new ConvexError({ code: 'stale_epoch', retryable: true }))
      .mockResolvedValueOnce(true);
    const refreshEpoch = vi.fn(async () => undefined);
    const rematch = vi.fn(async () => ({ episode: 2 }));

    await expect(
      commitWatchWithOneRematch({ episode: 1 }, commit, rematch, refreshEpoch),
    ).resolves.toEqual({ resolved: { episode: 2 }, recorded: true });
    expect(refreshEpoch).toHaveBeenCalledTimes(1);
    expect(rematch).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls).toEqual([[{ episode: 1 }], [{ episode: 2 }]]);

    const conflictingCommit = vi.fn(async () => {
      throw new ConvexError({ code: 'stale_epoch', retryable: true });
    });
    const secondRematch = vi.fn(async () => ({ episode: 3 }));
    await expect(
      commitWatchWithOneRematch(
        { episode: 1 },
        conflictingCommit,
        secondRematch,
        async () => undefined,
      ),
    ).rejects.toMatchObject({ data: { code: 'stale_epoch', retryable: true } });
    expect(secondRematch).toHaveBeenCalledTimes(1);
    expect(conflictingCommit).toHaveBeenCalledTimes(2);
  });
});
