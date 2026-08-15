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
