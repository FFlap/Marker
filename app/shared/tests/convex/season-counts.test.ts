import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';

const modules = import.meta.glob('../../convex/**/*.ts');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it('loads counts for unselected seasons in the chosen order and caches the complete guide', async () => {
  const t = convexTest({ schema, modules });
  vi.stubEnv('TVDB_API_KEY', 'test-key');
  const json = (data: unknown) => new Response(JSON.stringify({ data }));
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/login')) return json({ token: 'test-token' });
    if (url.includes('/series/222/extended'))
      return json({
        name: 'Test anime',
        genres: [{ name: 'Anime' }],
        seasons: [
          { id: 10, number: 0, type: { type: 'dvd' } },
          { id: 11, number: 1, type: { type: 'dvd' } },
          { id: 12, number: 2, type: { type: 'dvd' } },
          { id: 13, number: 3, episodeCount: 24, type: { type: 'dvd' } },
          { id: 14, number: 4, type: { type: 'dvd' } },
          { id: 99, number: 2, type: { type: 'official' } },
        ],
      });
    if (url.includes('/series/222/episodes/dvd/eng'))
      return json({ episodes: [{ id: 101, seasonNumber: 1, number: 1, name: 'Pilot' }] });
    if (url.endsWith('/seasons/10/extended')) return json({ id: 10, episodes: [] });
    if (url.endsWith('/seasons/12/extended'))
      return json({
        id: 12,
        episodes: [
          { id: 201, seasonNumber: 1, number: 1, name: 'First', aired: '2020-01-01' },
          { id: 202, seasonNumber: 1, number: 2, name: 'Second', aired: '2020-01-02' },
          { id: 202, seasonNumber: 1, number: 2, name: 'Second', aired: '2020-01-02' },
        ],
      });
    if (url.endsWith('/seasons/13/extended'))
      return json({
        id: 13,
        episodes: [
          { id: 301, seasonNumber: 3, number: 1, name: 'Upcoming', aired: '2999-01-01' },
          { id: 302, seasonNumber: 3, number: 2, name: 'Episode 2' },
        ],
      });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const args = { tmdbId: 88, tvdbId: 222, title: 'Test anime', order: 'dvd' };
  const guide = await t
    .action(internal.tvdb.refreshTitleExtras, args)
    .then((result) => result.anime);
  expect(guide?.seasons).toMatchObject([
    { season: 0, episodeCount: 0 },
    { season: 1, episodeCount: 1 },
    { season: 2, episodeCount: 2 },
    { season: 3, episodeCount: 0, episodeCountVerified: true },
    { season: 4, episodeCount: 0, episodeCountVerified: false },
  ]);
  for (const id of [11, 99]) {
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith(`/seasons/${id}/extended`)),
    ).toBe(false);
  }
  const requests = fetchMock.mock.calls.length;
  expect(
    await t.action(internal.tvdb.refreshTitleExtras, args).then((result) => result.anime),
  ).toEqual(guide);
  expect(fetchMock).toHaveBeenCalledTimes(requests);
});

it('bounds eager count requests while preserving the full season list', async () => {
  const t = convexTest({ schema, modules });
  vi.stubEnv('TVDB_API_KEY', 'test-key');
  const json = (data: unknown) => new Response(JSON.stringify({ data }));
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/login')) return json({ token: 'test-token' });
    if (url.includes('/series/333/extended'))
      return json({
        name: 'Long anime',
        genres: [{ name: 'Anime' }],
        seasons: Array.from({ length: 80 }, (_, number) => ({
          id: number + 1,
          number,
          type: { type: 'dvd' },
        })),
      });
    const seasonId = url.match(/\/seasons\/(\d+)\/extended$/)?.[1];
    if (seasonId) return json({ id: Number(seasonId), episodes: [{ id: 1000 }] });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const guide = await t
    .action(internal.tvdb.refreshTitleExtras, {
      tmdbId: 89,
      tvdbId: 333,
      title: 'Long anime',
      order: 'dvd',
      requestedSeason: 79,
    })
    .then((result) => result.anime);
  expect(guide?.seasons).toHaveLength(80);
  expect(
    fetchMock.mock.calls.filter(([url]) => /\/seasons\/\d+\/extended$/.test(String(url))),
  ).toHaveLength(64);
  expect(guide?.seasons[79]).toMatchObject({
    season: 79,
    episodeCount: 0,
    episodeCountVerified: false,
  });
});

it('retries an incomplete cached guide after five minutes and verifies the recovered count', async () => {
  const t = convexTest({ schema, modules });
  vi.stubEnv('TVDB_API_KEY', 'test-key');
  let countsAvailable = false;
  const json = (data: unknown) => Response.json({ data });
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/login')) return json({ token: 'test-token' });
    if (url.includes('/series/444/extended'))
      return json({
        name: 'Retry anime',
        genres: [{ name: 'Anime' }],
        seasons: [{ id: 42, number: 2, type: { type: 'official' } }],
      });
    if (url.endsWith('/seasons/42/extended') && countsAvailable)
      return json({
        id: 42,
        episodes: [{ id: 421, seasonNumber: 2, number: 1, name: 'Released' }],
      });
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const args = {
    tmdbId: 90,
    tvdbId: 444,
    title: 'Retry anime',
    order: 'official',
    requestedSeason: 3,
  };
  const incomplete = await t
    .action(internal.tvdb.refreshTitleExtras, args)
    .then((result) => result.anime);
  expect(incomplete?.seasons[0]).toMatchObject({ episodeCount: 0, episodeCountVerified: false });
  const cachedRequests = fetchMock.mock.calls.length;
  await t.action(internal.tvdb.refreshTitleExtras, args).then((result) => result.anime);
  expect(fetchMock).toHaveBeenCalledTimes(cachedRequests);

  countsAvailable = true;
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now + 5 * 60_000 + 1);
  const recovered = await t
    .action(internal.tvdb.refreshTitleExtras, args)
    .then((result) => result.anime);
  expect(recovered?.seasons[0]).toMatchObject({ episodeCount: 1, episodeCountVerified: true });
});

it('builds a complete default aired-order guide from one translated catalog, including future and empty seasons', async () => {
  const t = convexTest({ schema, modules });
  vi.stubEnv('TVDB_API_KEY', 'test-key');
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/login')) return Response.json({ data: { token: 'token' } });
    if (url.includes('/series/555/extended'))
      return Response.json({
        data: {
          name: 'Catalog anime',
          defaultSeasonType: 1,
          genres: [{ name: 'Anime' }],
          seasons: [0, 1, 2, 3].map((number) => ({
            id: 50 + number,
            number,
            type: { id: 1, type: 'official' },
          })),
        },
      });
    if (url.includes('/episodes/official/eng?page=0'))
      return Response.json({
        data: {
          episodes: [
            { id: 1, seasonNumber: 1, number: 1, name: 'English pilot', aired: '2020-01-01' },
          ],
        },
        links: { total_items: 3, page_size: 1, next: 'page=1' },
      });
    if (url.includes('/episodes/official/eng?page=1'))
      return Response.json({
        data: {
          episodes: [
            { id: 2, seasonNumber: 2, number: 1, name: 'English second', aired: '2020-01-02' },
          ],
        },
        links: { next: 'page=2' },
      });
    if (url.includes('/episodes/official/eng?page=2'))
      return Response.json({
        data: {
          episodes: [{ id: 3, seasonNumber: 2, number: 2, name: 'Future', aired: '2999-01-01' }],
        },
        links: { next: null },
      });
    if (url.includes('/translations/eng'))
      return Response.json({ data: { name: 'Translated arc' } });
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const guide = await t
    .action(internal.tvdb.refreshTitleExtras, {
      tmdbId: 91,
      tvdbId: 555,
      title: 'Catalog anime',
      order: 'official',
      force: true,
    })
    .then((result) => result.anime);
  expect(guide?.seasons).toMatchObject([
    { season: 0, episodeCount: 0, episodeCountVerified: true },
    { season: 1, episodeCount: 1, episodeCountVerified: true },
    { season: 2, episodeCount: 1, episodeCountVerified: true },
    { season: 3, episodeCount: 0, episodeCountVerified: true },
  ]);
  expect(guide?.selectedEpisodes?.[0].name).toBe('English pilot');
  expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/episodes/'))).toHaveLength(
    3,
  );
  expect(fetchMock.mock.calls.some(([url]) => /\/seasons\/\d+\/extended/.test(String(url)))).toBe(
    false,
  );
});

it('rejects an incomplete translated catalog instead of publishing incorrect verified totals', async () => {
  const t = convexTest({ schema, modules });
  vi.stubEnv('TVDB_API_KEY', 'test-key');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/login')) return Response.json({ data: { token: 'token' } });
      if (url.includes('/series/556/extended'))
        return Response.json({
          data: {
            name: 'Incomplete anime',
            defaultSeasonType: 1,
            genres: [{ name: 'Anime' }],
            seasons: [{ id: 51, number: 1, type: { id: 1, type: 'official' } }],
          },
        });
      if (url.includes('/translations/eng')) return Response.json({ data: { name: 'Arc' } });
      if (url.includes('page=0'))
        return Response.json({
          data: { episodes: [{ id: 1, seasonNumber: 1, number: 1, name: 'Pilot' }] },
          links: { total_items: 2, page_size: 1, next: 'page=1' },
        });
      return Response.json({ data: { episodes: [] }, links: { next: null } });
    }),
  );
  await expect(
    t
      .action(internal.tvdb.refreshTitleExtras, {
        tmdbId: 92,
        tvdbId: 556,
        title: 'Incomplete anime',
        order: 'official',
        force: true,
      })
      .then((result) => result.anime),
  ).rejects.toThrow('incomplete catalog');
});

it('returns names, verified counts and character artwork without fetching episode rows in metadata mode', async () => {
  const t = convexTest({ schema, modules });
  vi.stubEnv('TVDB_API_KEY', 'test-key');
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/login')) return Response.json({ data: { token: 'token' } });
    if (url.includes('/series/557/extended'))
      return Response.json({
        data: {
          id: 557,
          name: 'Metadata anime',
          defaultSeasonType: 1,
          genres: [{ name: 'Anime' }],
          characters: [{ name: 'Hero', image: '/hero.jpg' }],
          seasons: [1, 2, 3].map((number) => ({
            id: 50 + number,
            number,
            type: { id: 1, type: 'official' },
          })),
          episodes: [
            { id: 1, seasonNumber: 1, number: 1, name: 'Original language', aired: '2020-01-01' },
            { id: 2, seasonNumber: 2, number: 1, name: 'Future', aired: '2999-01-01' },
          ],
        },
      });
    const seasonId = url.match(/\/seasons\/(5[123])\/extended/)?.[1];
    if (seasonId)
      return Response.json({
        data: {
          id: Number(seasonId),
          translations: { nameTranslations: [{ language: 'eng', name: 'English arc' }] },
          episodes:
            seasonId === '51'
              ? [{ id: 1, seasonNumber: 1, number: 1, name: 'Original', aired: '2020-01-01' }]
              : seasonId === '52'
                ? [{ id: 2, seasonNumber: 2, number: 1, name: 'Future', aired: '2999-01-01' }]
                : [],
        },
      });
    if (url.includes('/translations/eng')) return Response.json({ data: { name: 'English arc' } });
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const result = await t.action(internal.tvdb.refreshTitleExtras, {
    tmdbId: 93,
    tvdbId: 557,
    title: 'Metadata anime',
    force: true,
    metadataOnly: true,
  });
  expect(result.anime?.seasons).toMatchObject([
    { name: 'English arc', episodeCount: 1, episodeCountVerified: true },
    { name: 'English arc', episodeCount: 0, episodeCountVerified: true },
    { name: 'English arc', episodeCount: 0, episodeCountVerified: true },
  ]);
  expect(result.characters?.[0]).toMatchObject({
    name: 'Hero',
    imageUrl: 'https://artworks.thetvdb.com/banners/hero.jpg',
  });
  expect(result.anime?.selectedEpisodes).toBeUndefined();
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/episodes/official/eng'))).toBe(
    false,
  );
  // Metadata-only cache entries cannot masquerade as fully hydrated episode guides.
  await expect(
    t.query(internal.providerSnapshots.get, { key: 'tvdb:season:557:official:1' }),
  ).resolves.toBeNull();
});

it('validates a TMDB TVDB-ID hint and falls back when TVDB contradicts the identity', async () => {
  const t = convexTest({ schema, modules });
  vi.stubEnv('TVDB_API_KEY', 'test-key');
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/login')) return Response.json({ data: { token: 'token' } });
    if (url.includes('/series/558/extended'))
      return Response.json({
        data: {
          id: 558,
          name: 'Wrong series',
          remoteIds: [{ sourceName: 'TheMovieDB.com', id: '999' }],
          characters: [{ name: 'Wrong character', image: '/wrong.jpg' }],
        },
      });
    if (url.includes('/search/remoteid/94'))
      return Response.json({
        data: [{ sourceName: 'TMDB', series: { id: 559, name: 'Right anime' } }],
      });
    if (url.includes('/series/559/extended'))
      return Response.json({
        data: {
          id: 559,
          name: 'Right anime',
          defaultSeasonType: 1,
          genres: [{ name: 'Anime' }],
          seasons: [{ id: 51, number: 1, type: { id: 1, type: 'official' } }],
          episodes: [{ id: 1, seasonNumber: 1, number: 1, name: 'Pilot', aired: '2020-01-01' }],
          characters: [{ name: 'Right character', image: '/right.jpg' }],
        },
      });
    if (url.includes('/seasons/51/extended'))
      return Response.json({
        data: {
          id: 51,
          translations: { nameTranslations: [{ language: 'eng', name: 'English arc' }] },
          episodes: [{ id: 1, seasonNumber: 1, number: 1, name: 'Pilot', aired: '2020-01-01' }],
        },
      });
    if (url.includes('/translations/eng')) return Response.json({ data: { name: 'English arc' } });
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const result = await t.action(internal.tvdb.refreshTitleExtras, {
    tmdbId: 94,
    tvdbIdHint: 558,
    title: 'Right anime',
    metadataOnly: true,
    force: true,
  });
  expect(result.anime).toMatchObject({
    tvdbId: 559,
    seasons: [{ episodeCount: 1, episodeCountVerified: true }],
  });
  expect(result.characters?.map((character) => character.name)).toEqual(['Right character']);
});

it('uses a verified external ID without a redundant TVDB search', async () => {
  const t = convexTest({ schema, modules });
  vi.stubEnv('TVDB_API_KEY', 'test-key');
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/login')) return Response.json({ data: { token: 'token' } });
    if (url.includes('/series/560/extended'))
      return Response.json({
        data: {
          id: 560,
          name: 'Verified anime',
          defaultSeasonType: 1,
          genres: [{ name: 'Anime' }],
          remoteIds: [{ sourceName: 'TheMovieDB.com', id: '95' }],
          seasons: [{ id: 51, number: 1, type: { id: 1, type: 'official' } }],
          episodes: [{ id: 1, seasonNumber: 1, number: 1, name: 'Pilot', aired: '2020-01-01' }],
        },
      });
    if (url.includes('/seasons/51/extended'))
      return Response.json({
        data: {
          id: 51,
          translations: { nameTranslations: [{ language: 'eng', name: 'English arc' }] },
          episodes: [{ id: 1, seasonNumber: 1, number: 1, name: 'Pilot', aired: '2020-01-01' }],
        },
      });
    if (url.includes('/translations/eng')) return Response.json({ data: { name: 'English arc' } });
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const result = await t.action(internal.tvdb.refreshTitleExtras, {
    tmdbId: 95,
    tvdbIdHint: 560,
    title: 'Verified anime',
    metadataOnly: true,
    force: true,
  });
  expect(result.anime?.tvdbId).toBe(560);
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/search'))).toBe(false);
});

it.each(['same', 'series-name', 'new-season', 'new-order'] as const)(
  'overlaps fresh season reads with the series response and validates %s identities',
  async (change) => {
    const t = convexTest({ schema, modules });
    vi.stubEnv('TVDB_API_KEY', 'prefetch-test-key');
    let phase = 0,
      prefetched = 0;
    let releaseSeries!: () => void;
    const seriesReady = new Promise<void>((resolve) => {
      releaseSeries = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/login')) return Response.json({ data: { token: 'token' } });
        if (url.includes('/series/561/extended')) {
          if (phase) await seriesReady;
          const changed = phase > 0 && (change === 'new-season' || change === 'new-order');
          return Response.json({
            data: {
              id: 561,
              name: 'Concurrent anime',
              genres: [{ name: 'Anime' }],
              defaultSeasonType: change === 'new-order' && changed ? 2 : 1,
              seasons: [
                {
                  id: changed ? 52 : 51,
                  number: 1,
                  ...(change === 'series-name' && {
                    name: phase ? 'Fresh series arc' : 'Old series arc',
                  }),
                  type: {
                    id: change === 'new-order' && changed ? 2 : 1,
                    type: change === 'new-order' && changed ? 'dvd' : 'official',
                  },
                },
              ],
            },
          });
        }
        const id = url.match(/\/seasons\/(5[12])\/extended/)?.[1];
        if (id) {
          if (phase && id === '51') prefetched++;
          const count = phase === 0 ? 1 : id === '51' ? 2 : 3;
          return Response.json({
            data: {
              id: Number(id),
              translations: {
                nameTranslations: [
                  {
                    language: 'eng',
                    ...(change !== 'series-name' && {
                      name: phase ? (id === '51' ? 'Fresh arc' : 'New identity arc') : 'Old arc',
                    }),
                  },
                ],
              },
              episodes: Array.from({ length: count }, (_, index) => ({
                id: Number(id) * 10 + index,
                seasonNumber: 1,
                number: index + 1,
                name: 'Released episode',
                aired: '2020-01-01',
              })),
            },
          });
        }
        throw new Error(`Unexpected request ${url}`);
      }),
    );
    const args = {
      tmdbId: 96,
      tvdbId: 561,
      title: 'Concurrent anime',
      metadataOnly: true,
      force: true,
    };
    const initial = await t.action(internal.tvdb.refreshTitleExtras, args);
    expect(initial.anime?.seasons[0]).toMatchObject({
      name: change === 'series-name' ? 'Old series arc' : 'Old arc',
      episodeCount: 1,
    });
    phase = 1;
    const refreshing = t.action(internal.tvdb.refreshTitleExtras, args);
    try {
      await vi.waitFor(() => expect(prefetched).toBe(1));
    } finally {
      releaseSeries();
    }
    const result = await refreshing;
    expect(result.anime?.seasons[0]).toMatchObject({
      name:
        change === 'series-name'
          ? 'Fresh series arc'
          : change === 'same'
            ? 'Fresh arc'
            : 'New identity arc',
      episodeCount: change === 'same' || change === 'series-name' ? 2 : 3,
      episodeCountVerified: true,
    });
    expect(result.anime?.order).toBe(change === 'new-order' ? 'dvd' : 'official');
    // Confirmed IDs reuse the fresh HTTP response even when series names supply fallbacks.
    expect(prefetched).toBe(1);
  },
);

it.each([true, false])(
  'loads a translated catalog beyond five pages (totals: %s)',
  async (withTotals) => {
    const t = convexTest({ schema, modules });
    vi.stubEnv('TVDB_API_KEY', 'large-catalog-test');
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/login')) return Response.json({ data: { token: 'large-catalog' } });
      const page = Number(new URL(url).searchParams.get('page'));
      return Response.json({
        data: {
          episodes: [
            {
              id: page + 1,
              seasonNumber: page + 1,
              number: 1,
              name: 'Episode',
              aired: '2020-01-01',
            },
          ],
        },
        links: {
          ...(withTotals && { total_items: 6, page_size: 1 }),
          next: page < 5 ? `page=${page + 1}` : null,
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const episodes = await t.action(internal.tvdb.refreshSeason, {
      tvdbId: 555,
      order: 'official',
      season: 6,
      force: true,
    });
    expect(episodes).toMatchObject([{ season: 6, episode: 1 }]);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/episodes/'))).toHaveLength(
      6,
    );
  },
);

it('cancels outdated season prefetches before fetching a changed season identity', async () => {
  const t = convexTest({ schema, modules });
  vi.stubEnv('TVDB_API_KEY', 'cancel-prefetch-test');
  let phase = 0;
  let notifyOldStarted!: () => void;
  const oldStarted = new Promise<void>((resolve) => {
    notifyOldStarted = resolve;
  });
  let aborted = false;
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/login')) return Response.json({ data: { token: 'cancel-prefetch' } });
    if (url.includes('/series/561/extended')) {
      if (phase) await oldStarted;
      return Response.json({
        data: {
          id: 561,
          name: 'Anime',
          genres: [{ name: 'Anime' }],
          defaultSeasonType: 1,
          seasons: [{ id: phase ? 52 : 51, number: 1, type: { id: 1, type: 'official' } }],
        },
      });
    }
    if (phase && url.includes('/seasons/51/extended')) {
      notifyOldStarted();
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(new Error('aborted'));
          },
          { once: true },
        );
      });
    }
    const id = url.includes('/seasons/52/extended') ? 52 : 51;
    return Response.json({
      data: {
        id,
        name: 'Fresh arc',
        episodes: [{ id: 1, seasonNumber: 1, number: 1, name: 'Pilot', aired: '2020-01-01' }],
      },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  const args = { tmdbId: 96, tvdbId: 561, title: 'Anime', metadataOnly: true, force: true };
  await t.action(internal.tvdb.refreshTitleExtras, args);
  phase = 1;
  const result = await t.action(internal.tvdb.refreshTitleExtras, args);
  expect(aborted).toBe(true);
  expect(result.anime?.seasons).toMatchObject([
    { name: 'Fresh arc', episodeCount: 1, episodeCountVerified: true },
  ]);
  expect(
    fetchMock.mock.calls.filter(([url]) => String(url).includes('/seasons/52/extended')),
  ).toHaveLength(1);
});

it.each([true, false])(
  'rejects catalog overflow without publishing a partial season (totals: %s)',
  async (withTotals) => {
    const t = convexTest({ schema, modules });
    vi.stubEnv('TVDB_API_KEY', 'catalog-overflow-test');
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/login')) return Response.json({ data: { token: 'catalog-overflow' } });
      const page = Number(new URL(url).searchParams.get('page'));
      return Response.json({
        data: { episodes: [{ id: page + 1, seasonNumber: 1, number: page + 1, name: 'Episode' }] },
        links: { ...(withTotals && { total_items: 101, page_size: 1 }), next: `page=${page + 1}` },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      t.action(internal.tvdb.refreshSeason, {
        tvdbId: 555,
        order: 'official',
        season: 1,
        force: true,
      }),
    ).rejects.toThrow('safety limit');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/episodes/'))).toHaveLength(
      withTotals ? 1 : 100,
    );
    expect(
      await t.query(internal.providerSnapshots.get, { key: 'tvdb:season:555:official:1' }),
    ).toBeNull();
  },
);
