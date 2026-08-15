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
