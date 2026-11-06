import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { internal, api } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import { reusableCatalog } from '../../convex/tvdbCatalog';
import { enrichTitle, nextReleaseBoundary } from '../../convex/resolvedMetadata/enrichment';
import type { ActionCtx } from '../../convex/_generated/server';

const modules = import.meta.glob('../../convex/**/*.ts');
const setup = () => {
  const t = convexTest({ schema, modules });
  const ctx = { runQuery: t.query, runMutation: t.mutation } as ActionCtx;
  return { t, ctx };
};
afterEach(() => vi.restoreAllMocks());
const catalog = Array.from({ length: 400 }, (_, index) => ({
  id: index + 1,
  season: index < 200 ? 1 : 2,
  episode: (index % 200) + 1,
  name: `English ${index}`,
  overview: 'x'.repeat(400),
}));

it('reuses all catalog chunks for sibling seasons and isolates identity/order', async () => {
  const { t, ctx } = setup();
  const load = vi.fn().mockResolvedValue(catalog);
  expect(await reusableCatalog(ctx, 1, 'official', load)).toEqual(catalog);
  expect(await reusableCatalog(ctx, 1, 'official', load)).toEqual(catalog);
  expect(load).toHaveBeenCalledTimes(1);
  await reusableCatalog(ctx, 2, 'official', load);
  await reusableCatalog(ctx, 1, 'dvd', load);
  expect(load).toHaveBeenCalledTimes(3);
  const stored = await t.run((ctx) => ctx.db.query('providerSnapshots').collect());
  expect(stored.filter((row) => row.entry.kind === 'episodes')).toHaveLength(12);
  expect(stored.every((row) => JSON.stringify(row).length < 700 * 1024)).toBe(true);
});

it('deduplicates concurrent loads, bypasses on force and recovers after failure and missing chunks', async () => {
  const { t, ctx } = setup();
  const load = vi.fn().mockResolvedValue(catalog);
  await Promise.all([reusableCatalog(ctx, 1, 'dvd', load), reusableCatalog(ctx, 1, 'dvd', load)]);
  expect(load).toHaveBeenCalledTimes(1);
  await reusableCatalog(ctx, 1, 'dvd', load, true);
  expect(load).toHaveBeenCalledTimes(2);
  await t.run(async (ctx) => {
    for (const row of await ctx.db.query('providerSnapshots').collect())
      if (row.entry.kind === 'episodes') await ctx.db.delete(row._id);
  });
  load.mockRejectedValueOnce(new Error('offline'));
  await expect(reusableCatalog(ctx, 1, 'dvd', load)).rejects.toThrow('offline');
  expect(await reusableCatalog(ctx, 1, 'dvd', load)).toEqual(catalog);
  expect(load).toHaveBeenCalledTimes(4);
});

it('expires the reusable catalog and releases leases after provider errors', async () => {
  const { ctx } = setup();
  const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(catalog);
  await expect(reusableCatalog(ctx, 1, 'official', load)).rejects.toThrow('offline');
  await reusableCatalog(ctx, 1, 'official', load);
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now + 16 * 60_000);
  await reusableCatalog(ctx, 1, 'official', load);
  expect(load).toHaveBeenCalledTimes(3);
});

const movie = () => ({
  tmdbId: 77,
  mediaType: 'movie' as const,
  title: 'Movie',
  genres: ['Animation'],
  cast: [{ name: 'Actor', character: 'Hero' }],
  seasons: [],
  episodeRunTime: [],
  metadataProvider: 'tmdb' as const,
  orderEpoch: 0,
  refreshedAt: Date.now(),
  refreshAfter: Date.now() + 60_000,
});

it.each(['movie', 'tv'] as const)(
  'skips background enrichment for TMDB %s titles',
  async (mediaType) => {
    const { t, ctx } = setup();
    const title = { ...movie(), mediaType };
    await t.run((ctx) => ctx.db.insert('resolvedTitles', title));
    const runAction = vi.fn();
    await enrichTitle._handler({ ...ctx, runAction } as ActionCtx, {
      mediaType,
      tmdbId: 77,
      refreshedAt: title.refreshedAt,
    });
    expect(runAction).not.toHaveBeenCalled();
    expect(await t.run((ctx) => ctx.db.query('metadataRefreshLeases').collect())).toEqual([]);
  },
);

it('serves fresh titles without creating refresh requests and force admits work', async () => {
  const { t } = setup();
  await t.run(async (ctx) => {
    await ctx.db.insert('users', { clerkId: 'loading-test' });
    await ctx.db.insert('resolvedTitles', movie());
  });
  const user = t.withIdentity({ subject: 'loading-test' });
  expect(
    await user.mutation(api.resolvedMetadata.touch.touchTitle, { mediaType: 'movie', tmdbId: 77 }),
  ).toMatchObject({ scheduled: false });
  expect(await t.run((ctx) => ctx.db.query('metadataRefreshRequests').collect())).toEqual([]);
  expect(
    await user.mutation(api.resolvedMetadata.touch.touchTitle, {
      mediaType: 'movie',
      tmdbId: 77,
      force: true,
    }),
  ).toMatchObject({ scheduled: true });
  expect(nextReleaseBoundary(Date.parse('2026-11-04T23:59:59Z'))).toBe(
    Date.parse('2026-11-05T00:00:00Z'),
  );
});

it('bounds definitive guide misses without caching transient errors or suppressing artwork', async () => {
  const { t } = setup();
  vi.stubEnv('TVDB_API_KEY', 'negative-cache-test');
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    if (String(input).endsWith('/login')) return Response.json({ data: { token: 'test-token' } });
    return Response.json({
      data: {
        id: 10,
        name: 'Drama',
        genres: [{ name: 'Drama' }],
        characters: [{ name: 'Hero', image: '/hero.jpg' }],
      },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  try {
    const args = { tmdbId: 10, tvdbId: 10, title: 'Drama', metadataOnly: true };
    expect((await t.action(internal.tvdb.refreshTitleExtras, args)).anime).toBeNull();
    const count = fetchMock.mock.calls.length;
    await t.action(internal.tvdb.refreshTitleExtras, args);
    expect(fetchMock).toHaveBeenCalledTimes(count);
    expect(
      await t.action(internal.tvdb.getCharacterArtwork, {
        mediaType: 'tv',
        tmdbId: 10,
        tvdbId: 10,
        title: 'Drama',
      }),
    ).toHaveLength(1);
    const beforeExpiry = fetchMock.mock.calls.length;
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 16 * 60_000);
    await t.action(internal.tvdb.refreshTitleExtras, args);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(beforeExpiry);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

it('loads selected and sibling seasons from one English catalog and refetches on force', async () => {
  const { t } = setup();
  vi.stubEnv('TVDB_API_KEY', 'season-reuse-test');
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/login')) return Response.json({ data: { token: 'token' } });
    expect(url).toContain('/episodes/official/eng?page=0');
    return Response.json({
      data: {
        episodes: [
          { id: 1, seasonNumber: 1, number: 1, name: 'English pilot' },
          { id: 2, seasonNumber: 2, number: 1, name: 'English sequel' },
        ],
      },
      links: { next: null },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  try {
    const args = { tvdbId: 123, order: 'official' };
    expect(await t.action(internal.tvdb.refreshSeason, { ...args, season: 1 })).toMatchObject([
      { name: 'English pilot' },
    ]);
    expect(await t.action(internal.tvdb.refreshSeason, { ...args, season: 2 })).toMatchObject([
      { name: 'English sequel' },
    ]);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/episodes/'))).toHaveLength(
      1,
    );
    await t.action(internal.tvdb.refreshSeason, { ...args, season: 2, force: true });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/episodes/'))).toHaveLength(
      2,
    );
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

it('fences enrichment when a manual mapping changes during provider work', async () => {
  const { t, ctx } = setup();
  const title = {
    ...movie(),
    mediaType: 'tv' as const,
    metadataProvider: 'tvdb' as const,
    tvdbId: 123,
    seasonOrder: 'official',
  };
  await t.run(async (ctx) => {
    await ctx.db.insert('resolvedTitles', title);
    await ctx.db.insert('titleMappings', {
      mediaType: 'tv',
      tmdbId: 77,
      source: 'auto',
      tvdbId: 123,
      seasonOrder: 'official',
      orderEpoch: 0,
      updatedAt: 1,
    });
  });
  const runAction = vi.fn(async () => {
    await t.run(async (ctx) => {
      const mapping = (await ctx.db.query('titleMappings').collect())[0]!;
      await ctx.db.patch(mapping._id, { source: 'manual', tvdbId: 456, orderEpoch: 1 });
    });
    return {
      anime: {
        tvdbId: 123,
        order: 'official',
        seasons: [{ season: 1, name: 'Obsolete', episodeCount: 3 }],
      },
      characters: [],
    };
  });
  await enrichTitle._handler({ ...ctx, runAction } as unknown as ActionCtx, {
    mediaType: 'tv',
    tmdbId: 77,
    refreshedAt: title.refreshedAt,
  });
  const stored = await t.run((ctx) => ctx.db.query('resolvedTitles').collect());
  expect(stored[0]?.seasons).toEqual([]);
});

it('does not record a guide miss after a transient provider failure', async () => {
  const { t } = setup();
  vi.stubEnv('TVDB_API_KEY', 'transient-test');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/login')) return Response.json({ data: { token: 'token' } });
      return new Response('{}', { status: 401 });
    }),
  );
  try {
    await expect(
      t.action(internal.tvdb.refreshTitleExtras, {
        tmdbId: 12,
        tvdbId: 12,
        title: 'Anime',
        metadataOnly: true,
      }),
    ).rejects.toThrow();
    expect(
      await t.run(async (ctx) =>
        (await ctx.db.query('providerSnapshots').collect()).filter(
          (row) => row.entry.kind === 'tvdbMiss',
        ),
      ),
    ).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});

it('keeps interactive leases available and preserves season counts published during enrichment', async () => {
  const { t, ctx } = setup();
  const title = {
    ...movie(),
    mediaType: 'tv' as const,
    metadataProvider: 'tvdb' as const,
    tvdbId: 123,
    seasonOrder: 'official',
    seasons: [{ season: 1, name: 'Season 1', episodeCount: 0, episodeCountVerified: false }],
  };
  const id = await t.run(async (ctx) => {
    await ctx.db.insert('titleMappings', {
      mediaType: 'tv',
      tmdbId: 77,
      source: 'auto',
      tvdbId: 123,
      seasonOrder: 'official',
      orderEpoch: 0,
      updatedAt: 1,
    });
    return ctx.db.insert('resolvedTitles', title);
  });
  const runAction = vi.fn(async () => {
    expect(
      await t.mutation(internal.resolvedMetadata.requests.claimRefresh, {
        key: 'metadata:tv:77',
        token: 'interactive',
        leaseMs: 60_000,
      }),
    ).toBe(true);
    await t.run((ctx) =>
      ctx.db.patch(id, {
        seasons: [{ season: 1, name: 'Season 1', episodeCount: 8, episodeCountVerified: true }],
        cast: [
          {
            name: 'Actor',
            character: 'Hero',
            characterImageUrl: 'https://example.com/current.jpg',
          },
        ],
      }),
    );
    return {
      anime: {
        tvdbId: 123,
        order: 'official',
        seasons: [{ season: 1, name: 'Enriched arc', episodeCount: 7, episodeCountVerified: true }],
      },
      characters: [{ name: 'Hero', imageUrl: 'https://example.com/late.jpg' }],
    };
  });
  await enrichTitle._handler({ ...ctx, runAction } as unknown as ActionCtx, {
    mediaType: 'tv',
    tmdbId: 77,
    refreshedAt: title.refreshedAt,
  });
  const saved = await t.query(internal.resolvedMetadata.reads.readTitle, {
    mediaType: 'tv',
    tmdbId: 77,
  });
  expect(saved?.cast[0].characterImageUrl).toBe('https://example.com/current.jpg');
  expect(runAction).toHaveBeenCalledTimes(1);
  expect(saved?.seasons).toEqual([
    { season: 1, name: 'Enriched arc', episodeCount: 8, episodeCountVerified: true },
  ]);
});
