import { afterEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { api, internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import {
  mapMovieDetails,
  mapSearchResponse,
  mapSeasonDetails,
  mapTvDetails,
} from '../../convex/tmdb';

const modules = import.meta.glob('../../convex/**/*.ts');

async function setup() {
  const t = convexTest(schema, modules);
  const clerkId = 'user_coverage_test';
  const userId = await t.run((ctx) => ctx.db.insert('users', { clerkId }));
  const asUser = Object.assign(t.withIdentity({ subject: clerkId }), {
    recordWatch: (args: Parameters<typeof t.action>[1]) =>
      t.action(internal.sync.recordWatchFromExtensionInternal, { ...args, userId }),
  });
  return { t, userId, asUser };
}

function add(title: string, tmdbId: number, extra: Record<string, unknown> = {}) {
  return {
    tmdbId,
    mediaType: 'tv' as const,
    title,
    status: 'watchlist' as const,
    ...extra,
  };
}

describe('settings and ordering', () => {
  it('roundtrips settings and guards both operations', async () => {
    const { t, asUser } = await setup();
    await expect(t.query(api.settings.getSettings, {})).rejects.toThrow('Authentication required');
    await expect(t.mutation(api.settings.setSettings, { defaultView: 'posters' })).rejects.toThrow(
      'Authentication required',
    );
    expect(await asUser.query(api.settings.getSettings, {})).toMatchObject({
      defaultView: 'list',
      gridColumns: 3,
      listTextSize: 'medium',
      listColumns: 1,
    });
    await asUser.mutation(api.settings.setSettings, {
      defaultView: 'posters',
      gridColumns: 5,
      listTextSize: 'large',
      listColumns: 2,
    });
    expect(await asUser.query(api.settings.getSettings, {})).toMatchObject({
      defaultView: 'posters',
      gridColumns: 5,
      listTextSize: 'large',
      listColumns: 2,
    });
    await asUser.mutation(api.settings.setSettings, { gridColumns: 4 });
    expect(await asUser.query(api.settings.getSettings, {})).toMatchObject({
      defaultView: 'posters',
      gridColumns: 4,
      listTextSize: 'large',
      listColumns: 2,
    });
  });

  it('supports top, bottom, midpoint, and empty-list reorder ranks', async () => {
    const { asUser } = await setup();
    const first = await asUser.mutation(api.library.addItem, add('First', 1));
    const second = await asUser.mutation(api.library.addItem, add('Second', 2));
    expect(await asUser.mutation(api.library.reorderItem, { itemId: second, afterId: first })).toBe(
      0,
    );
    expect(
      await asUser.mutation(api.library.reorderItem, { itemId: first, beforeId: second }),
    ).toBe(1);
    expect(await asUser.mutation(api.library.reorderItem, { itemId: first })).toBe(-1);
  });

  it('recomputes stale reorder claims and rejects untrusted neighbors', async () => {
    const { t, asUser } = await setup();
    const ids = [];
    for (let index = 0; index < 5; index += 1)
      ids.push(await asUser.mutation(api.library.addItem, add(`Item ${index}`, index + 10)));

    // Reversed and non-adjacent claims are projected onto an authoritative slot.
    await asUser.mutation(api.library.reorderItem, {
      itemId: ids[4],
      beforeId: ids[3],
      afterId: ids[1],
    });
    await asUser.mutation(api.library.reorderItem, {
      itemId: ids[0],
      beforeId: ids[1],
      afterId: ids[3],
    });

    const crossStatus = await asUser.mutation(
      api.library.addItem,
      add('Watching', 99, { status: 'watching' }),
    );
    await expect(
      asUser.mutation(api.library.reorderItem, { itemId: ids[0], afterId: crossStatus }),
    ).rejects.toThrow('Neighbors must share a status');

    await t.run((ctx) => ctx.db.insert('users', { clerkId: 'user_reorder_other' }));
    const other = t.withIdentity({ subject: 'user_reorder_other' });
    const foreign = await other.mutation(api.library.addItem, add('Foreign', 100));
    await expect(
      asUser.mutation(api.library.reorderItem, { itemId: ids[0], beforeId: foreign }),
    ).rejects.toThrow('Item not found');

    for (let count = 0; count < 8; count += 1)
      await asUser.mutation(api.library.reorderItem, {
        itemId: ids[count % ids.length],
        afterId: ids[(count + 2) % ids.length],
      });
    const ordered = (await asUser.query(api.library.listItems, {}))
      .filter((item) => item.status === 'watchlist')
      .sort((a, b) => a.rank - b.rank || a._creationTime - b._creationTime);
    expect(new Set(ordered.map((item) => item.rank)).size).toBe(ordered.length);
    expect(ordered.every((item, index) => index === 0 || ordered[index - 1].rank < item.rank)).toBe(
      true,
    );
  });

  it('rebalances only a bounded window when adjacent ranks become dense', async () => {
    const { t, asUser } = await setup();
    const ids = [];
    for (let index = 0; index < 20; index += 1)
      ids.push(await asUser.mutation(api.library.addItem, add(`Dense ${index}`, index + 200)));
    await t.run(async (ctx) => {
      await ctx.db.patch(ids[9], { rank: 10 });
      await ctx.db.patch(ids[10], { rank: 10 + 1e-12 });
    });

    await asUser.mutation(api.library.reorderItem, {
      itemId: ids[19],
      beforeId: ids[9],
      afterId: ids[10],
    });
    const rows = await t.run(async (ctx) =>
      Promise.all([ids[1], ids[9], ids[10], ids[18], ids[19]].map((id) => ctx.db.get(id))),
    );
    expect(rows[0]?.rank).toBe(2);
    expect(rows[3]?.rank).toBe(19);
    expect(rows[4]!.rank).toBeGreaterThan(rows[1]!.rank);
    expect(rows[4]!.rank).toBeLessThan(rows[2]!.rank);
  });
});

describe('rating clearing and stats', () => {
  it('clears item and episode ratings without changing other fields', async () => {
    const { asUser } = await setup();
    const itemId = await asUser.mutation(
      api.library.addItem,
      add('Daredevil', 61889, { rating: 9, tags: ['hero'] }),
    );
    await asUser.mutation(api.library.setEpisodeState, {
      itemId,
      season: 1,
      episode: 1,
      rating: 8.5,
      tags: ['pilot'],
    });
    await asUser.mutation(api.library.updateItem, { itemId, clearRating: true });
    await asUser.mutation(api.library.setEpisodeState, {
      itemId,
      season: 1,
      episode: 1,
      clearRating: true,
    });
    expect((await asUser.query(api.library.listItems, {}))[0]).toMatchObject({ tags: ['hero'] });
    expect((await asUser.query(api.library.listItems, {}))[0].rating).toBeUndefined();
    const episode = (await asUser.query(api.library.listEpisodes, { itemId, season: 1 }))[0];
    expect(episode).toMatchObject({ tags: ['pilot'] });
    expect(episode.rating).toBeUndefined();
  });

  it('uses runtime fallbacks, ignores unrated items, and orders tied tags alphabetically', async () => {
    const { t, userId, asUser } = await setup();
    const show = await asUser.mutation(
      api.library.addItem,
      add('Show', 10, { runtime: 45, rating: 8, tags: ['zeta', 'alpha'] }),
    );
    const fallback = await asUser.mutation(api.library.addItem, add('Fallback', 11));
    await asUser.mutation(api.library.addItem, add('Unrated', 12, { tags: ['beta'] }));
    await asUser.mutation(api.library.setEpisodeState, {
      itemId: show,
      season: 1,
      episode: 1,
      watched: true,
    });
    await asUser.mutation(api.library.setEpisodeState, {
      itemId: fallback,
      season: 1,
      episode: 1,
      watched: true,
    });
    await t.run((ctx) =>
      ctx.db.insert('episodes', {
        userId,
        itemId: show,
        season: 0,
        episode: 99,
        watched: true,
        unverified: true,
        runtime: 999,
        tags: [],
        metadataProvider: 'tmdb',
      }),
    );
    const stats = await asUser.query(api.stats.profile, {});
    expect(stats.totalWatchMinutes).toBe(75);
    expect(stats.episodesWatched).toBe(2);
    expect(stats.avgRating).toBe(8);
    expect(stats.topTags.map((entry) => entry.tag)).toEqual(['alpha', 'beta', 'zeta']);
  });

  it('counts zero watches as zero movie minutes', async () => {
    const { asUser } = await setup();
    await asUser.mutation(api.library.addItem, {
      ...add('Unwatched movie', 99, { status: 'watched', runtime: 120, timesWatched: 0 }),
      mediaType: 'movie',
    });
    expect((await asUser.query(api.stats.profile, {})).totalWatchMinutes).toBe(0);
  });
});

describe('TMDB mappers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('maps movie, TV, cast, seasons, and episode runtimes', () => {
    expect(
      mapMovieDetails({
        id: 299534,
        title: 'Avengers: Endgame',
        poster_path: '/endgame.jpg',
        runtime: 181,
        genres: [{ name: 'Adventure' }],
        credits: { cast: [{ name: 'Robert Downey Jr.', character: 'Tony Stark' }] },
      }),
    ).toMatchObject({
      id: 299534,
      posterPath: '/endgame.jpg',
      runtime: 181,
      genres: ['Adventure'],
    });
    expect(
      mapTvDetails({
        id: 61889,
        name: 'Daredevil',
        poster_path: '/daredevil.jpg',
        episode_run_time: [52],
        seasons: [{ season_number: 1, name: 'Season 1', episode_count: 13 }],
        credits: { cast: [{ name: 'Charlie Cox', character: 'Matt Murdock' }] },
      }),
    ).toMatchObject({
      posterPath: '/daredevil.jpg',
      episodeRunTime: [52],
      seasons: [{ season: 1, name: 'Season 1', episodeCount: 13 }],
      cast: [{ name: 'Charlie Cox', character: 'Matt Murdock' }],
    });
    expect(
      mapSeasonDetails({
        season_number: 1,
        episodes: [{ episode_number: 1, name: 'Into the Ring', runtime: 53 }],
      }),
    ).toEqual([
      expect.objectContaining({ season: 1, episode: 1, name: 'Into the Ring', runtime: 53 }),
    ]);
  });

  it('classifies Japanese animation as Anime and exposes TMDB episode stills', () => {
    expect(
      mapMovieDetails({
        id: 1,
        title: 'Anime Movie',
        original_language: 'ja',
        genres: [{ name: 'Animation' }, { name: 'Action' }],
      }).genres,
    ).toEqual(['Animation', 'Action', 'Anime']);
    expect(
      mapTvDetails({
        id: 2,
        name: 'Anime Series',
        original_language: 'ja',
        genres: [{ name: 'Animation' }],
      }).genres,
    ).toEqual(['Animation', 'Anime']);
    expect(
      mapSeasonDetails({
        season_number: 1,
        episodes: [{ episode_number: 1, name: 'Pilot', still_path: '/episode-still.jpg' }],
      })[0],
    ).toMatchObject({
      stillPath: '/episode-still.jpg',
      imageUrl: 'https://image.tmdb.org/t/p/w500/episode-still.jpg',
    });
  });

  it('rejects malformed required TMDB detail fields', () => {
    expect(() => mapMovieDetails({ id: 'bad', title: 'Movie' })).toThrow(
      'TMDB returned malformed data',
    );
    expect(() => mapMovieDetails({ id: 1 })).toThrow('TMDB returned malformed data');
    expect(() => mapTvDetails({ id: 1, name: '   ' })).toThrow('TMDB returned malformed data');
    expect(mapSearchResponse({ results: [{ media_type: 'tv', id: 1 }] })).toEqual([]);
  });
});

describe('TVDB provider snapshots', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('stores the resolved guide and seeds the initial season snapshot', async () => {
    const { t } = await setup();
    vi.stubEnv('TVDB_API_KEY', 'tvdb-key');
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'tmdb-key');
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('api.themoviedb.org/3/tv/123'))
        return new Response(
          JSON.stringify({
            id: 123,
            name: 'Snapshot Anime',
            original_name: 'Snapshot Anime',
            genres: [],
            seasons: [{ season_number: 1, name: 'Season 1', episode_count: 1 }],
          }),
        );
      if (url.endsWith('/login'))
        return new Response(JSON.stringify({ data: { token: 'tvdb-token' } }));
      if (url.includes('/search/remoteid/'))
        return new Response(
          JSON.stringify({
            data: [
              {
                sourceName: 'TheMovieDB.com',
                series: { id: 457078, name: 'Snapshot Anime' },
              },
            ],
          }),
        );
      if (url.includes('/series/457078/extended'))
        return new Response(
          JSON.stringify({
            data: {
              name: 'Snapshot Anime',
              firstAired: '2026-01-01',
              averageRuntime: 24,
              defaultSeasonType: 1,
              genres: [{ name: 'Anime' }],
              seasons: [
                {
                  id: 10,
                  number: 1,
                  name: 'Season 1',
                  type: { id: 1, type: 'official' },
                },
              ],
            },
          }),
        );
      if (url.includes('/series/457078/episodes/official/eng'))
        return new Response(
          JSON.stringify({
            data: {
              episodes: [
                {
                  id: 100,
                  seasonNumber: 1,
                  number: 1,
                  name: 'Ready immediately',
                  image: 'v4/episode/100/screencap.jpg',
                },
              ],
            },
            links: { next: null },
          }),
        );
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const guide = await t.action(internal.tvdb.refreshAnime, {
      tmdbId: 123,
      title: 'Snapshot Anime',
    });
    expect(guide).toMatchObject({
      tvdbId: 457078,
      selectedSeason: 1,
      selectedEpisodes: [{ season: 1, episode: 1, name: 'Ready immediately' }],
    });
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).includes('/episodes/official/eng?page=0&season=1'),
      ),
    ).toBe(true);
    const callsAfterResolve = fetchMock.mock.calls.length;
    await t.action(internal.tvdb.refreshAnime, { tmdbId: 123, title: 'Snapshot Anime' });
    expect(
      await t.action(internal.tvdb.refreshSeason, {
        tvdbId: 457078,
        order: 'official',
        season: 1,
      }),
    ).toMatchObject([{ name: 'Ready immediately' }]);
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterResolve);
  });
});

describe('authenticated watch sync', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const watch = (
    asUser: Awaited<ReturnType<typeof setup>>['asUser'],
    seriesTitle: string,
    extra = {},
  ) =>
    asUser.recordWatch({
      service: 'netflix',
      seriesTitle,
      seasonNumber: 1,
      episodeNumber: 1,
      ...extra,
    });

  it('finds a TV item after same-title movies without calling TMDB', async () => {
    const { asUser } = await setup();
    await asUser.mutation(api.library.addItem, add('Shared Title', 1, { mediaType: 'movie' }));
    await asUser.mutation(api.library.addItem, add('Shared Title', 2, { mediaType: 'movie' }));
    const tvId = await asUser.mutation(api.library.addItem, add('Shared Title', 3));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(watch(asUser, ' Shared Title ')).resolves.toEqual({
      ok: true,
      season: 1,
      episode: 1,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await asUser.query(api.library.listEpisodes, { itemId: tvId, season: 1 })).toHaveLength(
      1,
    );
  });

  it('preserves watched and freshly ranks inactive items moved to watching', async () => {
    const { asUser } = await setup();
    const watchedId = await asUser.mutation(
      api.library.addItem,
      add('Watched Show', 1, { status: 'watched' }),
    );
    const existingWatching = await asUser.mutation(
      api.library.addItem,
      add('Existing', 2, { status: 'watching' }),
    );
    const watchlistId = await asUser.mutation(api.library.addItem, add('Watchlist Show', 3));
    const droppedId = await asUser.mutation(
      api.library.addItem,
      add('Dropped Show', 4, { status: 'dropped' }),
    );

    await watch(asUser, 'Watched Show');
    await watch(asUser, 'Watchlist Show');
    await watch(asUser, 'Dropped Show');

    const items = await asUser.query(api.library.listItems, {});
    expect(items.find((item) => item._id === watchedId)?.status).toBe('watched');
    const moved = items.find((item) => item._id === watchlistId);
    const existing = items.find((item) => item._id === existingWatching);
    const resumed = items.find((item) => item._id === droppedId);
    expect(moved?.status).toBe('watching');
    expect(moved!.rank).toBeGreaterThan(existing!.rank);
    expect(resumed?.status).toBe('watching');
    expect(resumed!.rank).toBeGreaterThan(moved!.rank);
  });

  it('returns unmatched when TMDB has no exact title match', async () => {
    const { asUser } = await setup();
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ results: [{ id: 1, name: 'Almost the Show' }] }), {
          status: 200,
        }),
      ),
    );

    await expect(watch(asUser, 'The Show')).resolves.toEqual({
      ok: false,
      reason: 'unmatched',
    });
  });

  it('resolves a franchise container through its season title and records the named episode', async () => {
    const { asUser } = await setup();
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/search/tv')) {
        const query = new URL(url).searchParams.get('query');
        return new Response(
          JSON.stringify({
            results:
              query === 'Rascal Does Not Dream of Bunny Girl Senpai'
                ? [{ id: 82739, name: 'Rascal Does Not Dream of Bunny Girl Senpai' }]
                : [],
          }),
          { status: 200 },
        );
      }
      if (url.includes('/season/1'))
        return new Response(
          JSON.stringify({
            season_number: 1,
            episodes: [
              {
                season_number: 1,
                episode_number: 1,
                name: 'My Senpai is a Bunny Girl',
                runtime: 24,
              },
            ],
          }),
          { status: 200 },
        );
      return new Response(
        JSON.stringify({
          id: 82739,
          name: 'Rascal Does Not Dream of Bunny Girl Senpai',
          seasons: [{ season_number: 1 }],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      asUser.recordWatch({
        service: 'crunchyroll',
        seriesTitle: 'Rascal Does Not Dream Series',
        seasonTitle: 'Rascal Does Not Dream of Bunny Girl Senpai',
        episodeNumber: 1,
        episodeTitle: 'My Senpai is a Bunny Girl',
      }),
    ).resolves.toEqual({ ok: true, season: 1, episode: 1 });
    const items = await asUser.query(api.library.listItems, {});
    expect(items).toMatchObject([
      { tmdbId: 82739, title: 'Rascal Does Not Dream of Bunny Girl Senpai' },
    ]);
    expect(
      await asUser.query(api.library.listEpisodes, { itemId: items[0]!._id, season: 1 }),
    ).toMatchObject([{ season: 1, episode: 1, name: 'My Senpai is a Bunny Girl' }]);
  });

  it('returns unmatched when neither a franchise container nor its season title resolves', async () => {
    const { asUser } = await setup();
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 })),
    );
    await expect(
      asUser.recordWatch({
        service: 'crunchyroll',
        seriesTitle: 'Unknown Container',
        seasonTitle: 'Unknown Entry',
        episodeNumber: 1,
        episodeTitle: 'Pilot',
      }),
    ).resolves.toEqual({ ok: false, reason: 'unmatched' });
  });

  it('throws a retryable upstream ConvexError when TMDB fails', async () => {
    const { asUser } = await setup();
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('TMDB unavailable')));

    await expect(watch(asUser, 'Unavailable Show')).rejects.toMatchObject({
      data: { code: 'upstream' },
    });
  });

  it('records the same episode idempotently', async () => {
    const { asUser } = await setup();
    const itemId = await asUser.mutation(api.library.addItem, add('The Middle', 1422));

    await watch(asUser, 'the middle', { episodeTitle: 'Pilot' });
    await watch(asUser, 'the middle', { episodeTitle: 'Pilot' });

    const episodes = await asUser.query(api.library.listEpisodes, { itemId, season: 1 });
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toMatchObject({ watched: true, name: 'Pilot' });
  });

  it('resolves a specials episode by its TMDB name', async () => {
    const { asUser } = await setup();
    const itemId = await asUser.mutation(api.library.addItem, add('Special Show', 99));
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const body = url.includes('/season/0')
        ? {
            season_number: 0,
            episodes: [
              {
                season_number: 0,
                episode_number: 5,
                name: 'No Coincidences in This Summer Sky',
                runtime: 24,
              },
            ],
          }
        : {
            id: 99,
            name: 'Special Show',
            seasons: [{ season_number: 0, name: 'Specials', episode_count: 5 }],
          };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      asUser.recordWatch({
        service: 'crunchyroll',
        seriesTitle: 'Special Show',
        episodeTitle: 'No Coincidences in This Summer Sky',
      }),
    ).resolves.toEqual({ ok: true, season: 0, episode: 5 });
    expect(await asUser.query(api.library.listEpisodes, { itemId, season: 0 })).toMatchObject([
      { season: 0, episode: 5, name: 'No Coincidences in This Summer Sky', runtime: 24 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('resolves a season-one episode by name without a season hint', async () => {
    const { asUser } = await setup();
    const itemId = await asUser.mutation(api.library.addItem, add('Season One Show', 101));
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const match = String(input).match(/season\/(\d+)/);
      if (!match)
        return new Response(
          JSON.stringify({
            id: 101,
            name: 'Season One Show',
            seasons: [{ season_number: 0 }, { season_number: 1 }],
          }),
          { status: 200 },
        );
      const season = Number(match[1]);
      return new Response(
        JSON.stringify({
          season_number: season,
          episodes: [
            {
              season_number: season,
              episode_number: season === 1 ? 3 : 1,
              name: season === 1 ? 'The First Adventure' : 'Behind the Scenes',
              runtime: 24,
            },
          ],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      asUser.recordWatch({
        service: 'crunchyroll',
        seriesTitle: 'Season One Show',
        episodeTitle: 'The First Adventure',
      }),
    ).resolves.toEqual({ ok: true, season: 1, episode: 3 });
    expect(await asUser.query(api.library.listEpisodes, { itemId, season: 1 })).toMatchObject([
      { season: 1, episode: 3, name: 'The First Adventure', runtime: 24 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['no matching name', { 0: ['Something Else'], 1: ['Another'] }],
    ['an ambiguous name', { 0: ['Recap', 'Recap'], 1: ['Other'] }],
    ['a name duplicated across seasons', { 0: ['Recap'], 1: ['Recap'] }],
  ])('returns unmatched-episode for %s', async (_case, names) => {
    const { asUser } = await setup();
    await asUser.mutation(api.library.addItem, add('Named Show', 100));
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const match = String(input).match(/season\/(\d+)/);
      if (!match)
        return new Response(
          JSON.stringify({
            id: 100,
            name: 'Named Show',
            seasons: [{ season_number: 0 }, { season_number: 1 }],
          }),
          { status: 200 },
        );
      const season = Number(match[1]);
      return new Response(
        JSON.stringify({
          season_number: season,
          episodes: names[season as 0 | 1].map((name, i) => ({
            season_number: season,
            episode_number: i + 1,
            name,
          })),
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      asUser.recordWatch({
        service: 'netflix',
        seriesTitle: 'Named Show',
        ...(_case === 'an ambiguous name' ? { episodeNumber: 7 } : {}),
        episodeTitle: 'Recap',
      }),
    ).resolves.toEqual({ ok: false, reason: 'unmatched-episode' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('creates an exact-matched watching item exactly once when the episode is unmatched', async () => {
    const { asUser } = await setup();
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/search/tv'))
        return new Response(JSON.stringify({ results: [{ id: 501, name: 'Watching Show' }] }), {
          status: 200,
        });
      if (url.includes('/season/'))
        return new Response(
          JSON.stringify({
            season_number: Number(url.match(/season\/(\d+)/)?.[1] ?? 0),
            episodes: [{ season_number: 1, episode_number: 1, name: 'Something Else' }],
          }),
          { status: 200 },
        );
      return new Response(
        JSON.stringify({
          id: 501,
          name: 'Watching Show',
          seasons: [{ season_number: 0 }, { season_number: 1 }],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const args = {
      service: 'netflix' as const,
      seriesTitle: 'Watching Show',
      episodeTitle: 'Missing Episode',
    };
    await expect(asUser.recordWatch(args)).resolves.toEqual({
      ok: false,
      reason: 'unmatched-episode',
    });
    await expect(asUser.recordWatch(args)).resolves.toEqual({
      ok: false,
      reason: 'unmatched-episode',
    });
    const items = await asUser.query(api.library.listItems, {});
    expect(items).toMatchObject([{ tmdbId: 501, title: 'Watching Show', status: 'watching' }]);
    expect(items).toHaveLength(1);
    expect(
      await asUser.query(api.library.listEpisodes, { itemId: items[0]!._id, season: 1 }),
    ).toEqual([]);
  });

  it('does not create an auto-matched item on upstream failure and a retry converges', async () => {
    const { asUser } = await setup();
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
    let failDetails = true;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/search/tv'))
        return new Response(JSON.stringify({ results: [{ id: 502, name: 'Retry Show' }] }), {
          status: 200,
        });
      if (failDetails) throw new Error('details unavailable');
      if (url.includes('/season/1'))
        return new Response(
          JSON.stringify({
            season_number: 1,
            episodes: [{ season_number: 1, episode_number: 1, name: 'Pilot' }],
          }),
          { status: 200 },
        );
      return new Response(
        JSON.stringify({ id: 502, name: 'Retry Show', seasons: [{ season_number: 1 }] }),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(watch(asUser, 'Retry Show')).rejects.toMatchObject({
      data: { code: 'upstream' },
    });
    expect(await asUser.query(api.library.listItems, {})).toEqual([]);

    failDetails = false;
    await expect(watch(asUser, 'Retry Show')).resolves.toEqual({
      ok: true,
      season: 1,
      episode: 1,
    });
    const items = await asUser.query(api.library.listItems, {});
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ tmdbId: 502, status: 'watching' });
    await expect(
      asUser.query(api.library.listEpisodes, { itemId: items[0]!._id, season: 1 }),
    ).resolves.toMatchObject([{ episode: 1, watched: true }]);
  });

  it('stores an unlisted special by client episode number after zero TMDB name matches', async () => {
    const { asUser } = await setup();
    const itemId = await asUser.mutation(api.library.addItem, add('Named Show', 100));
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
    const fetchMock = vi.fn(
      async (input: string | URL | Request) =>
        new Response(
          JSON.stringify(
            String(input).includes('/season/')
              ? {
                  season_number: 1,
                  episodes: [{ season_number: 1, episode_number: 1, name: 'Pilot' }],
                }
              : { id: 100, name: 'Named Show', seasons: [{ season_number: 1 }] },
          ),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      asUser.recordWatch({
        service: 'crunchyroll',
        seriesTitle: 'Named Show',
        episodeNumber: 4,
        episodeTitle: 'Unlisted OVA',
      }),
    ).resolves.toEqual({ ok: true, season: 0, episode: 4, unverified: true });
    expect(await asUser.query(api.library.listEpisodes, { itemId, season: 0 })).toMatchObject([
      { season: 0, episode: 4, name: 'Unlisted OVA', watched: true, unverified: true },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns unmatched without fetching specials when a show has no season zero', async () => {
    const { asUser } = await setup();
    await asUser.mutation(api.library.addItem, add('No Specials', 104));
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ id: 104, name: 'No Specials', seasons: [{ season_number: 1 }] }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      asUser.recordWatch({
        service: 'netflix',
        seriesTitle: 'No Specials',
        episodeTitle: 'Missing',
      }),
    ).resolves.toEqual({ ok: false, reason: 'unmatched-episode' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats a season details 404 as an empty episode list', async () => {
    const { asUser } = await setup();
    await asUser.mutation(api.library.addItem, add('Stale Specials', 105));
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
    const fetchMock = vi.fn(async (input: string | URL | Request) =>
      String(input).includes('/season/0')
        ? new Response('{}', { status: 404 })
        : new Response(
            JSON.stringify({
              id: 105,
              name: 'Stale Specials',
              seasons: [{ season_number: 0 }],
            }),
            { status: 200 },
          ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      asUser.recordWatch({
        service: 'netflix',
        seriesTitle: 'Stale Specials',
        episodeNumber: 2,
        episodeTitle: 'Missing',
      }),
    ).resolves.toEqual({ ok: true, season: 0, episode: 2, unverified: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps a TMDB 500 classified as retryable upstream', async () => {
    const { asUser } = await setup();
    await asUser.mutation(api.library.addItem, add('Broken Specials', 106));
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 500 })));

    await expect(
      asUser.recordWatch({
        service: 'netflix',
        seriesTitle: 'Broken Specials',
        episodeTitle: 'Missing',
      }),
    ).rejects.toMatchObject({ data: { code: 'upstream' } });
  });

  it.each(["Journey's", 'Journey’s', 'Part:  1', 'Part 1'])(
    'normalizes punctuation and whitespace in episode name %s',
    async (episodeTitle) => {
      const { asUser } = await setup();
      await asUser.mutation(api.library.addItem, add('Variants', 101));
      vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
      const fetchMock = vi.fn(
        async (input: string | URL | Request) =>
          new Response(
            JSON.stringify(
              String(input).includes('/season/0')
                ? {
                    season_number: 0,
                    episodes: [
                      {
                        season_number: 0,
                        episode_number: 1,
                        name: episodeTitle.includes('Journey') ? 'Journey’s' : 'Part 1',
                      },
                    ],
                  }
                : { id: 101, name: 'Variants', seasons: [{ season_number: 0 }] },
            ),
            { status: 200 },
          ),
      );
      vi.stubGlobal('fetch', fetchMock);
      await expect(
        asUser.recordWatch({
          service: 'netflix',
          seriesTitle: 'Variants',
          episodeTitle,
        }),
      ).resolves.toMatchObject({ ok: true, season: 0, episode: 1 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it('scans only specials plus the supplied season and ignores unscanned names', async () => {
    const { asUser } = await setup();
    await asUser.mutation(api.library.addItem, add('Scoped', 102));
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const match = String(input).match(/season\/(\d+)/);
      return new Response(
        JSON.stringify(
          match
            ? {
                season_number: Number(match[1]),
                episodes: [
                  {
                    season_number: Number(match[1]),
                    episode_number: 1,
                    name: Number(match[1]) === 3 ? 'Hidden' : 'Other',
                  },
                ],
              }
            : {
                id: 102,
                name: 'Scoped',
                seasons: [{ season_number: 0 }, { season_number: 2 }, { season_number: 3 }],
              },
        ),
        { status: 200 },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      asUser.recordWatch({
        service: 'netflix',
        seriesTitle: 'Scoped',
        seasonNumber: 2,
        episodeTitle: 'Hidden',
      }),
    ).resolves.toEqual({ ok: false, reason: 'unmatched-episode' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/season/3'))).toBe(false);
  });

  it('caps unverified season-zero records and preserves verified names', async () => {
    const { t, userId, asUser } = await setup();
    const itemId = await asUser.mutation(api.library.addItem, add('Capped', 103));
    await t.run(async (ctx) => {
      for (let episode = 1; episode <= 50; episode += 1)
        await ctx.db.insert('episodes', {
          userId,
          itemId,
          season: 0,
          episode,
          name: `OVA ${episode}`,
          watched: true,
          unverified: true,
          tags: [],
          metadataProvider: 'tmdb',
        });
    });
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'token');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ id: 103, name: 'Capped', seasons: [] }), { status: 200 }),
      ),
    );
    await expect(
      asUser.recordWatch({
        service: 'netflix',
        seriesTitle: 'Capped',
        episodeNumber: 51,
        episodeTitle: 'OVA 51',
      }),
    ).resolves.toEqual({ ok: false, reason: 'unmatched-episode' });

    await asUser.mutation(api.library.setEpisodeState, {
      itemId,
      season: 1,
      episode: 1,
      name: 'Canonical',
      watched: true,
    });
    await watch(asUser, 'Capped', { episodeTitle: 'Wrong' });
    expect(
      (await asUser.query(api.library.listEpisodes, { itemId, season: 1 })).find(
        (episode) => episode.season === 1,
      )?.name,
    ).toBe('Canonical');
  });

  it('rejects an episode without coordinates or a title', async () => {
    const { asUser } = await setup();
    await expect(asUser.recordWatch({ service: 'netflix', seriesTitle: 'Show' })).rejects.toThrow(
      'Episode coordinates or title required',
    );
  });
});
