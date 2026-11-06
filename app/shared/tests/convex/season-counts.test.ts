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

it('loads counts for unselected seasons in the chosen order and caches title identity', async () => {
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
      return json({
        episodes: [
          { id: 101, seasonNumber: 1, number: 1, name: 'Pilot' },
          { id: 201, seasonNumber: 2, number: 1, name: 'First' },
          { id: 202, seasonNumber: 2, number: 2, name: 'Second' },
        ],
      });
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
  const guide = await t.action(internal.tvdb.refreshTitleExtras, args).then(
    async ({ anime }) =>
      anime && {
        ...anime,
        seasons: await t.action(internal.tvdb.loadSeasonSummaries, {
          tmdbId: 88,
          tvdbId: anime.tvdbId,
          order: anime.order,
          title: anime.title,
          seasons: anime.seasons,
        }),
      },
  );
  expect(guide?.seasons).toMatchObject([
    { season: 0, episodeCount: 0 },
    { season: 1, episodeCount: 1 },
    { season: 2, episodeCount: 2 },
    { season: 3, episodeCount: 0, episodeCountVerified: true },
    { season: 4, episodeCount: 0, episodeCountVerified: true },
  ]);
  for (const id of [11, 99]) {
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith(`/seasons/${id}/extended`)),
    ).toBe(false);
  }
  const requests = fetchMock.mock.calls.length;
  const cached = await t.action(internal.tvdb.refreshTitleExtras, args);
  expect(cached.anime?.tvdbId).toBe(222);
  expect(fetchMock).toHaveBeenCalledTimes(requests);
});

it('bounds season translation requests while preserving the full season list', async () => {
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
    if (url.includes('/series/333/episodes/')) return json({ episodes: [] });
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
    })
    .then(
      async ({ anime }) =>
        anime && {
          ...anime,
          seasons: await t.action(internal.tvdb.loadSeasonSummaries, {
            tmdbId: 89,
            tvdbId: anime.tvdbId,
            order: anime.order,
            title: anime.title,
            seasons: anime.seasons,
          }),
        },
    );
  expect(guide?.seasons).toHaveLength(80);
  expect(
    fetchMock.mock.calls.filter(([url]) => /\/seasons\/\d+\/extended$/.test(String(url))),
  ).toHaveLength(0);
  expect(guide?.seasons[79]).toMatchObject({
    season: 79,
    episodeCount: 0,
    episodeCountVerified: true,
  });
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
    .then(
      async ({ anime }) =>
        anime && {
          ...anime,
          seasons: await t.action(internal.tvdb.loadSeasonSummaries, {
            tmdbId: 91,
            tvdbId: anime.tvdbId,
            order: anime.order,
            title: anime.title,
            seasons: anime.seasons,
          }),
        },
    );
  expect(guide?.seasons).toMatchObject([
    { season: 0, episodeCount: 0, episodeCountVerified: true },
    { season: 1, episodeCount: 1, episodeCountVerified: true },
    { season: 2, episodeCount: 1, episodeCountVerified: true },
    { season: 3, episodeCount: 0, episodeCountVerified: true },
  ]);
  expect(
    (await t.action(internal.tvdb.refreshSeason, { tvdbId: 555, order: 'official', season: 1 }))[0]
      .name,
  ).toBe('English pilot');
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
      .then(
        async ({ anime }) =>
          anime && {
            ...anime,
            seasons: await t.action(internal.tvdb.loadSeasonSummaries, {
              tmdbId: 92,
              tvdbId: anime.tvdbId,
              order: anime.order,
              title: anime.title,
              seasons: anime.seasons,
            }),
          },
      ),
  ).rejects.toThrow('incomplete catalog');
});

it('publishes confirmed identity and basic names without loading the season catalog', async () => {
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
  });
  expect(result.anime?.seasons).toMatchObject([
    { name: 'Season 1', episodeCount: 0, episodeCountVerified: false },
    { name: 'Season 2', episodeCount: 0, episodeCountVerified: false },
    { name: 'Season 3', episodeCount: 0, episodeCountVerified: false },
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
    force: true,
  });
  expect(result.anime).toMatchObject({
    tvdbId: 559,
    seasons: [{ episodeCount: 0, episodeCountVerified: false }],
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
    force: true,
  });
  expect(result.anime?.tvdbId).toBe(560);
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/search'))).toBe(false);
});

it('does no speculative season work when the provider changes season identity', async () => {
  const t = convexTest({ schema, modules });
  vi.stubEnv('TVDB_API_KEY', 'identity-test');
  let seasonId = 51;
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    if (String(input).endsWith('/login')) return Response.json({ data: { token: 'token' } });
    expect(String(input)).toContain('/series/561/extended');
    return Response.json({
      data: {
        id: 561,
        name: 'Anime',
        genres: [{ name: 'Anime' }],
        seasons: [{ id: seasonId, number: 1, type: { type: 'official' } }],
      },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  const args = { tmdbId: 96, tvdbId: 561, title: 'Anime', force: true };
  await t.action(internal.tvdb.refreshTitleExtras, args);
  seasonId = 52;
  const result = await t.action(internal.tvdb.refreshTitleExtras, args);
  expect(result.anime?.seasons).toMatchObject([{ season: 1, episodeCountVerified: false }]);
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/seasons/'))).toBe(false);
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
