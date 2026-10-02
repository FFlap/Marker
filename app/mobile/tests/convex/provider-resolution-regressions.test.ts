import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { api, internal } from '../../convex/_generated/api';
import type { ActionCtx } from '../../convex/_generated/server';
import schema from '../../convex/schema';
import { resolveFreshSeason } from '../../convex/resolvedMetadata/seasonResolution';
import { resolveFreshTitle } from '../../convex/resolvedMetadata/titleResolution';
import { publishCanonicalMetadata } from '../../convex/resolvedMetadata/publication';
import {
  mergeEpisodes,
  mergeTitle,
  type ResolvedTitle,
} from '../../convex/resolvedMetadata/shared';
import { putSeason } from './metadata-fixtures';

const modules = import.meta.glob('../../convex/**/*.ts');
const title = (overrides: Partial<ResolvedTitle> = {}): ResolvedTitle => ({
  tmdbId: 88,
  mediaType: 'tv',
  title: 'Returning series',
  episodeRunTime: [],
  genres: [],
  cast: [],
  seasons: [{ season: 1, name: 'Season 1', episodeCount: 1 }],
  metadataProvider: 'tmdb',
  orderEpoch: 0,
  refreshedAt: 1,
  refreshAfter: 2,
  ...overrides,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('does not relabel TMDB episodes as TVDB when the authoritative season is empty', async () => {
  const runAction = vi
    .fn()
    .mockResolvedValueOnce([
      { season: 1, episode: 1, name: 'Different order', providerEpisodeId: 123 },
    ])
    .mockResolvedValueOnce([]);
  const result = await resolveFreshSeason(
    { runAction } as unknown as ActionCtx,
    { tmdbId: 88, season: 1 },
    title({ metadataProvider: 'tvdb', tvdbId: 222, seasonOrder: 'dvd' }),
    null,
  );
  expect(result).toMatchObject({ episodes: [], persisted: true, partial: false });
});

it('does not relabel the TMDB season catalog when the TVDB guide has no seasons', () => {
  const merged = mergeTitle(
    88,
    'tv',
    title(),
    {
      tvdbId: 222,
      order: 'dvd',
      seasons: [],
      episodeRunTime: [],
      genres: ['Anime'],
    },
    10,
  );
  expect(merged.metadataProvider).toBe('tvdb');
  expect(merged.seasons).toEqual([]);
});

it('retains primary-provider coordinates when the secondary provider contains extra episodes', async () => {
  const runAction = vi
    .fn()
    .mockResolvedValueOnce([
      { season: 1, episode: 1, name: 'TVDB one', providerEpisodeId: 100, imageUrl: 'artwork' },
      { season: 1, episode: 2, name: 'TMDB only', providerEpisodeId: 101 },
    ])
    .mockResolvedValueOnce([{ season: 1, episode: 1, name: 'TVDB one', providerEpisodeId: 200 }]);
  const result = await resolveFreshSeason(
    { runAction } as unknown as ActionCtx,
    { tmdbId: 88, season: 1 },
    title({ metadataProvider: 'tvdb', tvdbId: 222, seasonOrder: 'official' }),
    null,
  );
  expect(result.episodes).toEqual([
    { season: 1, episode: 1, name: 'TVDB one', providerEpisodeId: 200, imageUrl: 'artwork' },
  ]);
});

it('does not borrow artwork from another provider order based only on episode coordinates', () => {
  const primary = [{ season: 1, episode: 1, name: 'Arc premiere', providerEpisodeId: 222 }];
  expect(
    mergeEpisodes(primary, [
      {
        season: 1,
        episode: 1,
        name: 'Different arc',
        imageUrl: 'wrong-artwork',
      },
    ]),
  ).toEqual(primary);
  expect(
    mergeEpisodes(primary, [
      {
        season: 1,
        episode: 1,
        name: 'Arc premiere',
        imageUrl: 'correct-artwork',
      },
    ])[0]?.imageUrl,
  ).toBe('correct-artwork');
  expect(
    mergeEpisodes(
      [{ ...primary[0], name: 'Episode 1' }],
      [{ season: 1, episode: 1, name: 'Episode 1', imageUrl: 'unverified-artwork' }],
    )[0]?.imageUrl,
  ).toBeUndefined();
});

it('refreshes a previously empty season instead of deleting it from the title catalog', async () => {
  const t = convexTest({ schema, modules });
  const userId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { clerkId: 'returning-season' });
    await ctx.db.insert('resolvedTitles', title());
    await ctx.db.insert('titleMappings', {
      tmdbId: 88,
      mediaType: 'tv',
      source: 'manual',
      orderEpoch: 0,
      updatedAt: 1,
    });
    return userId;
  });
  await putSeason(t, {
    tmdbId: 88,
    season: 1,
    metadataProvider: 'tmdb',
    episodes: [],
    orderEpoch: 0,
    refreshedAt: 1,
    refreshAfter: 2,
  });
  vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'test-token');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/season/1'))
        return Response.json({
          season_number: 1,
          episodes: [{ id: 900, episode_number: 1, name: 'New release', air_date: '2020-01-01' }],
        });
      return Response.json({
        id: 88,
        name: 'Returning series',
        genres: [],
        seasons: [{ season_number: 1, name: 'Season 1', episode_count: 1 }],
      });
    }),
  );

  const refreshed = await t.action(internal.resolvedMetadata.titleResolution.resolveTitleForUser, {
    userId,
    mediaType: 'tv',
    tmdbId: 88,
    title: 'Returning series',
  });
  expect(refreshed.seasons).toEqual([
    { season: 1, name: 'Season 1', episodeCount: 1, episodeCountVerified: true },
  ]);
  expect(
    await t.query(internal.resolvedMetadata.reads.readSeason, { tmdbId: 88, season: 1 }),
  ).toMatchObject({ episodeCount: 1, episodes: [{ name: 'New release' }] });
  const view = await t
    .withIdentity({ subject: 'returning-season' })
    .query(api.resolvedMetadata.reads.getTitle, { mediaType: 'tv', tmdbId: 88 });
  expect(view?.seasons).toHaveLength(1);
});

it('lets a newer title restore a season hidden by an older empty canonical count', async () => {
  const t = convexTest({ schema, modules });
  await t.run(async (ctx) => {
    await ctx.db.insert('users', { clerkId: 'new-count' });
    await ctx.db.insert('resolvedTitles', title({ refreshedAt: 20 }));
  });
  await putSeason(t, {
    tmdbId: 88,
    season: 1,
    metadataProvider: 'tmdb',
    episodes: [],
    orderEpoch: 0,
    refreshedAt: 10,
    refreshAfter: 30,
  });
  const view = await t
    .withIdentity({ subject: 'new-count' })
    .query(api.resolvedMetadata.reads.getTitle, { mediaType: 'tv', tmdbId: 88 });
  expect(view?.seasons).toEqual([{ season: 1, name: 'Season 1', episodeCount: 1 }]);
});

it('keeps confirmed empty seasons in storage so later refreshes can target them', async () => {
  const t = convexTest({ schema, modules });
  await t.run((ctx) =>
    publishCanonicalMetadata(
      ctx,
      {
        title: title(),
        titleWrite: 'replace',
        season: { season: 1, episodeCount: 0 },
        writeTitle: true,
        writeSeason: true,
        now: 10,
      },
      null,
      null,
    ),
  );
  const stored = await t.query(internal.resolvedMetadata.reads.readTitle, {
    mediaType: 'tv',
    tmdbId: 88,
  });
  expect(stored?.seasons).toEqual([
    { season: 1, name: 'Season 1', episodeCount: 0, episodeCountVerified: true },
  ]);
});

it('keeps unknown totals selectable while hiding confirmed empty seasons', async () => {
  const t = convexTest({ schema, modules });
  await t.run(async (ctx) => {
    await ctx.db.insert('users', { clerkId: 'unknown-counts' });
    await ctx.db.insert(
      'resolvedTitles',
      title({
        refreshedAt: 20,
        seasons: [
          { season: 1, name: 'Unknown', episodeCount: 0, episodeCountVerified: false },
          { season: 2, name: 'Empty', episodeCount: 0, episodeCountVerified: true },
          { season: 3, name: 'Previously loaded', episodeCount: 0, episodeCountVerified: false },
        ],
      }),
    );
  });
  await putSeason(t, {
    tmdbId: 88,
    season: 3,
    metadataProvider: 'tmdb',
    episodes: [{ season: 3, episode: 1, name: 'Existing episode' }],
    orderEpoch: 0,
    refreshedAt: 10,
    refreshAfter: 30,
  });
  const view = await t
    .withIdentity({ subject: 'unknown-counts' })
    .query(api.resolvedMetadata.reads.getTitle, { mediaType: 'tv', tmdbId: 88 });
  expect(view?.seasons).toEqual([
    { season: 1, name: 'Unknown', episodeCount: 0, episodeCountVerified: false },
    { season: 3, name: 'Previously loaded', episodeCount: 1, episodeCountVerified: true },
  ]);
});

it('uses the short retry interval when any TVDB season total remains unknown', async () => {
  const runAction = vi
    .fn()
    .mockResolvedValueOnce({ title: 'Anime', genres: [] })
    .mockResolvedValueOnce({
      tvdbId: 222,
      order: 'official',
      genres: ['Anime'],
      episodeRunTime: [],
      seasons: [
        { season: 2, name: 'Unavailable count', episodeCount: 0, episodeCountVerified: false },
      ],
    });
  const result = await resolveFreshTitle(
    { runAction } as unknown as ActionCtx,
    { mediaType: 'tv', tmdbId: 88 },
    null,
    null,
    false,
  );
  expect(result.partial).toBe(true);
  expect(result.value.refreshAfter - result.value.refreshedAt).toBe(5 * 60_000);
  expect(result.value.seasons[0]?.episodeCountVerified).toBe(false);
});

it('keeps queued episodes and repairs saved metadata when a refreshed title count is unknown', async () => {
  const t = convexTest({ schema, modules });
  const { userId, titleId } = await t.run(async (ctx) => ({
    userId: await ctx.db.insert('users', { clerkId: 'unknown-queue' }),
    titleId: await ctx.db.insert('resolvedTitles', title()),
  }));
  await putSeason(t, {
    tmdbId: 88,
    season: 1,
    metadataProvider: 'tmdb',
    episodes: [
      { season: 1, episode: 1, name: 'Canonical first', providerEpisodeId: 1 },
      { season: 1, episode: 2, name: 'Canonical next', providerEpisodeId: 2 },
    ],
    orderEpoch: 0,
    refreshedAt: 10,
    refreshAfter: 30,
  });
  const itemId = await t
    .withIdentity({ subject: 'unknown-queue' })
    .mutation(api.library.items.addItem, {
      tmdbId: 88,
      mediaType: 'tv',
      title: 'Returning series',
      status: 'watching',
    });
  const savedId = await t.run(async (ctx) => {
    await ctx.db.patch(titleId, {
      refreshedAt: 20,
      seasons: [{ season: 1, name: 'Season 1', episodeCount: 0, episodeCountVerified: false }],
    });
    return ctx.db.insert('episodes', {
      userId,
      itemId,
      season: 1,
      episode: 1,
      name: 'Outdated name',
      watched: true,
      tags: [],
      metadataProvider: 'tmdb',
      providerEpisodeId: 1,
    });
  });
  await t.mutation(internal.nextEpisode.startNextEpisodeRefresh, { itemId });
  expect((await t.run((ctx) => ctx.db.get(itemId)))?.nextEpisode).toMatchObject({
    episode: 2,
    name: 'Canonical next',
    providerEpisodeId: 2,
  });
  await t.run((ctx) => ctx.db.patch(savedId, { name: 'Outdated name' }));
  await t.mutation(internal.episodeProjectionRepair.startEpisodeProjectionRepair, { itemId });
  expect((await t.run((ctx) => ctx.db.get(savedId)))?.name).toBe('Canonical first');
});

it.each(['missing', 'stale', 'incomplete'])(
  'processes later loaded seasons when an unknown season has %s canonical data',
  async (state) => {
    const t = convexTest({ schema, modules });
    const userId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', { clerkId: 'unknown-gap' });
      await ctx.db.insert(
        'resolvedTitles',
        title({
          metadataProvider: 'tvdb',
          tvdbId: 222,
          seasonOrder: 'official',
          seasons: [
            { season: 1, name: 'Unknown', episodeCount: 0, episodeCountVerified: false },
            { season: 2, name: 'Loaded', episodeCount: 2 },
          ],
        }),
      );
      await ctx.db.insert('titleMappings', {
        tmdbId: 88,
        mediaType: 'tv',
        tvdbId: 222,
        seasonOrder: 'official',
        source: 'manual',
        orderEpoch: 0,
        updatedAt: 1,
      });
      return userId;
    });
    const firstSeason = {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tvdb' as const,
      orderEpoch: 0,
      refreshedAt: 10,
      refreshAfter: 30,
      episodes: [{ season: 1, episode: 1, name: 'Earlier episode', providerEpisodeId: 101 }],
    };
    if (state !== 'missing') {
      await putSeason(t, { ...firstSeason, orderEpoch: state === 'stale' ? 1 : 0 });
      if (state === 'incomplete')
        await t.run(async (ctx) => {
          const season = await ctx.db
            .query('resolvedSeasons')
            .withIndex('by_tmdb_season', (q) => q.eq('tmdbId', 88).eq('season', 1))
            .unique();
          await ctx.db.patch(season!._id, { chunksComplete: false });
        });
    }
    await putSeason(t, {
      ...firstSeason,
      season: 2,
      episodes: [
        { season: 2, episode: 1, name: 'Updated title', providerEpisodeId: 201 },
        { season: 2, episode: 2, name: 'Next episode', providerEpisodeId: 202 },
      ],
    });
    const itemId = await t
      .withIdentity({ subject: 'unknown-gap' })
      .mutation(api.library.items.addItem, {
        tmdbId: 88,
        mediaType: 'tv',
        title: 'Returning series',
        status: 'watching',
      });
    const savedId = await t.run(async (ctx) => {
      await ctx.db.patch(itemId, {
        nextEpisode: { season: 2, episode: 2, providerEpisodeId: 202 },
      });
      return ctx.db.insert('episodes', {
        userId,
        itemId,
        season: 2,
        episode: 1,
        name: 'Outdated title',
        watched: true,
        tags: [],
        metadataProvider: 'tvdb',
        seasonOrder: 'official',
        providerEpisodeId: 201,
      });
    });
    await t.mutation(internal.episodeProjectionRepair.startEpisodeProjectionRepair, { itemId });
    expect((await t.run((ctx) => ctx.db.get(savedId)))?.name).toBe('Updated title');
    await t.mutation(internal.nextEpisode.startNextEpisodeRefresh, { itemId });
    expect((await t.run((ctx) => ctx.db.get(itemId)))?.nextEpisode).toMatchObject({
      season: 2,
      episode: 2,
      providerEpisodeId: 202,
    });

    // Once the earlier season is available, its episodes take precedence again.
    await putSeason(t, firstSeason);
    await t.mutation(internal.nextEpisode.startNextEpisodeRefresh, { itemId });
    expect((await t.run((ctx) => ctx.db.get(itemId)))?.nextEpisode).toMatchObject({
      season: 1,
      episode: 1,
      providerEpisodeId: 101,
    });
  },
);

it('returns a stable season version and restarts stale cursors at the new first chunk', async () => {
  const t = convexTest({ schema, modules });
  await t.run((ctx) => ctx.db.insert('users', { clerkId: 'season-version' }));
  const episodes = Array.from({ length: 201 }, (_, index) => ({
    season: 1,
    episode: index + 1,
    name: `Episode ${index + 1}`,
  }));
  const put = (refreshedAt: number) =>
    putSeason(t, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes,
      orderEpoch: 0,
      refreshedAt,
      refreshAfter: refreshedAt + 60_000,
    });
  await put(1);
  const user = t.withIdentity({ subject: 'season-version' });
  const page = (cursor: string | null) =>
    user.query(api.resolvedMetadata.reads.getSeasonView, {
      tmdbId: 88,
      season: 1,
      paginationOpts: { cursor, numItems: 1 },
    });
  const first = await page(null);
  const second = await page(first.continueCursor);
  expect(second.page[0]?.seasonVersion).toBe(first.page[0]?.seasonVersion);
  expect(second.page[0]?.chunkIndex).toBe(1);
  await put(2);
  const restarted = await page(first.continueCursor);
  expect(restarted.page[0]?.chunkIndex).toBe(0);
  expect(restarted.page[0]?.seasonVersion).not.toBe(first.page[0]?.seasonVersion);
});

it('keeps provider budgets independent and resets an expired window without increasing a denied count', async () => {
  const t = convexTest({ schema, modules });
  const throttleId = await t.run((ctx) =>
    ctx.db.insert('requestThrottle', {
      key: 'tmdb-global',
      windowStart: Date.now(),
      count: 300,
    }),
  );
  expect(
    await t.mutation(internal.providerRateLimits.consumeGlobalProviderLimiter, {
      provider: 'tmdb',
    }),
  ).toBe(false);
  expect(
    await t.mutation(internal.providerRateLimits.consumeGlobalProviderLimiter, {
      provider: 'tvdb',
    }),
  ).toBe(true);
  expect((await t.run((ctx) => ctx.db.get(throttleId)))?.count).toBe(300);
  await t.run((ctx) => ctx.db.patch(throttleId, { windowStart: Date.now() - 60_001 }));
  expect(
    await t.mutation(internal.providerRateLimits.consumeGlobalProviderLimiter, {
      provider: 'tmdb',
    }),
  ).toBe(true);
  expect((await t.run((ctx) => ctx.db.get(throttleId)))?.count).toBe(1);
});
