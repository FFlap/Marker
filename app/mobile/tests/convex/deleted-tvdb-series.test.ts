import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { api, internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import { putSeason } from './metadata-fixtures';

const modules = import.meta.glob('../../convex/**/*.ts');
const title = 'Smoking Behind the Supermarket with You';
const candidate = (id: number, tmdbId = 296286) => ({
  id: `series-${id}`,
  type: 'series',
  name: title,
  remote_ids: [{ id: String(tmdbId), sourceName: 'TheMovieDB.com' }],
});
const episodes = Array.from({ length: 12 }, (_, index) => ({
  id: 12033461 + index,
  seasonNumber: 1,
  number: index + 1,
  name: `TVDB episode ${index + 1}`,
  aired: '2026-07-09',
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
function provider(
  state: 'deleted' | 'outage' | 'unavailable' | 'ambiguous' | 'mismatch' = 'deleted',
  genre = 'Animation',
) {
  vi.stubEnv('TVDB_API_KEY', 'test-key');
  vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'test-token');
  const json = (data: unknown) => new Response(JSON.stringify({ data }));
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('api.themoviedb.org'))
      return new Response(
        JSON.stringify(
          url.includes('/season/1')
            ? { episodes: [] }
            : {
                id: 296286,
                name: title,
                genres: [{ name: 'Animation' }],
                seasons: [{ season_number: 1, name: 'Season 1', episode_count: 12 }],
              },
        ),
      );
    if (url.endsWith('/login')) return json({ token: 'test-token' });
    if (url.includes('/series/465973/')) {
      if (state === 'outage') throw new Error('Network unavailable');
      if (state === 'unavailable') return new Response('{}', { status: 503 });
      return new Response('{}', { status: 404 });
    }
    if (url.includes('/search/remoteid/'))
      return json([
        {
          sourceName: 'TheMovieDB.com',
          series: { id: 465973, name: title },
        },
      ]);
    if (url.includes('/search?'))
      return json([
        candidate(465973),
        candidate(483430, state === 'mismatch' ? 999 : 296286),
        ...(state === 'ambiguous' ? [candidate(483431)] : []),
      ]);
    if (url.includes('/series/483430/extended'))
      return json({
        id: 483430,
        name: title,
        genres: [{ name: genre }],
        seasons: [{ id: 2272421, number: 1, type: { type: 'official' } }],
      });
    if (url.includes('/series/483430/episodes/official/eng')) return json({ episodes });
    if (url.includes('/translations/eng')) return json({});
    throw new Error(`Unexpected URL: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
it('repairs the automatic mapping and publishes twelve TVDB episodes through canonical refresh', async () => {
  const t = convexTest({ schema, modules });
  provider();
  const userId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { clerkId: 'recovery-user' });
    await ctx.db.insert('titleMappings', {
      tmdbId: 296286,
      mediaType: 'tv',
      tvdbId: 465973,
      seasonOrder: 'official',
      source: 'auto',
      orderEpoch: 0,
      updatedAt: 0,
    });
    await ctx.db.insert('resolvedTitles', {
      tmdbId: 296286,
      mediaType: 'tv',
      title,
      tvdbId: 465973,
      seasonOrder: 'official',
      metadataProvider: 'tvdb',
      orderEpoch: 0,
      episodeRunTime: [],
      genres: ['Anime'],
      cast: [],
      seasons: [{ season: 1, name: 'Season 1', episodeCount: 0, episodeCountVerified: true }],
      refreshedAt: 0,
      refreshAfter: 0,
    });
    return userId;
  });
  await putSeason(t, {
    tmdbId: 296286,
    season: 1,
    metadataProvider: 'tvdb',
    episodes: [],
    orderEpoch: 0,
    refreshedAt: 0,
    refreshAfter: 0,
  });
  await t.action(internal.resolvedMetadata.titleResolution.resolveTitleForUser, {
    userId,
    tmdbId: 296286,
    mediaType: 'tv',
    title,
  });
  expect(
    await t.query(internal.resolvedMetadata.reads.readTitleMapping, {
      tmdbId: 296286,
      mediaType: 'tv',
    }),
  ).toMatchObject({ tvdbId: 483430, source: 'auto', orderEpoch: 1 });
  const asUser = t.withIdentity({ subject: 'recovery-user' });
  const view = await asUser.query(api.resolvedMetadata.reads.getTitleView, {
    tmdbId: 296286,
    mediaType: 'tv',
  });
  expect(view.title).toMatchObject({
    metadataProvider: 'tvdb',
    tvdbId: 483430,
    seasons: [{ season: 1, episodeCount: 12 }],
  });
  const season = await t.query(internal.resolvedMetadata.reads.readSeason, {
    tmdbId: 296286,
    season: 1,
  });
  expect(season).toMatchObject({ metadataProvider: 'tvdb', orderEpoch: 1, episodeCount: 12 });
  expect(season?.episodes.map((episode) => episode.providerEpisodeId)).toEqual(
    episodes.map((episode) => episode.id),
  );
  const page = await asUser.query(api.resolvedMetadata.reads.getSeasonView, {
    tmdbId: 296286,
    season: 1,
    paginationOpts: { cursor: null, numItems: 1 },
  });
  expect(page.page[0]).toMatchObject({ metadataProvider: 'tvdb', totalCount: 12 });
  expect(page.page[0].episodes).toHaveLength(12);
});
it.each(['outage', 'unavailable', 'ambiguous', 'mismatch'] as const)(
  'does not replace a mapping on %s',
  async (state) => {
    const t = convexTest({ schema, modules });
    const fetchMock = provider(state);
    await expect(
      t.action(internal.tvdb.refreshAnimeWithMapping, {
        tmdbId: 296286,
        tvdbId: 465973,
        title,
      }),
    ).rejects.toThrow();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/series/483430/'))).toBe(
      false,
    );
  },
);
it('reuses the recovered guide for automatic mappings without repeating provider requests', async () => {
  const t = convexTest({ schema, modules });
  const fetchMock = provider();
  const guide = await t.action(internal.tvdb.refreshAnimeWithMapping, {
    tmdbId: 296286,
    tvdbId: 465973,
    title,
  });
  expect(guide?.tvdbId).toBe(483430);
  const requests = fetchMock.mock.calls.length;
  expect(
    await t.action(internal.tvdb.refreshAnimeWithMapping, {
      tmdbId: 296286,
      tvdbId: 483430,
      title,
    }),
  ).toEqual(guide);
  expect(fetchMock).toHaveBeenCalledTimes(requests);

  // A cached automatic lookup must not override a different explicit identity.
  await expect(
    t.action(internal.tvdb.refreshAnimeWithMapping, {
      tmdbId: 296286,
      tvdbId: 465973,
      order: 'official',
      title,
    }),
  ).rejects.toThrow('TVDB record not found');
});
it('recovers when the search index returns a deleted series for a first-time lookup', async () => {
  const t = convexTest({ schema, modules });
  provider('deleted', 'Anime');
  const guide = await t.action(internal.tvdb.refreshAnime, { tmdbId: 296286, title });
  expect(guide).toMatchObject({ tvdbId: 483430, selectedEpisodes: expect.any(Array) });
  expect(guide?.selectedEpisodes).toHaveLength(12);
});
it('does not rediscover a manually pinned missing TVDB record', async () => {
  const t = convexTest({ schema, modules });
  const fetchMock = provider();
  await expect(
    t.action(internal.tvdb.refreshAnimeWithMapping, {
      tmdbId: 296286,
      tvdbId: 465973,
      title,
      order: 'official',
    }),
  ).rejects.toThrow('TVDB record not found');
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/search'))).toBe(false);
});
it('does not cache a missing season endpoint as a successfully empty season', async () => {
  const t = convexTest({ schema, modules });
  provider();
  await expect(
    t.action(internal.tvdb.refreshSeason, {
      tvdbId: 465973,
      order: 'official',
      season: 1,
    }),
  ).rejects.toThrow('TVDB record not found');
  expect(
    await t.query(internal.providerSnapshots.get, {
      key: 'tvdb:season:465973:official:1',
    }),
  ).toBeNull();
});
