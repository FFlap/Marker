import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { internal } from '../../convex/_generated/api';
import { Effect } from 'effect';
import type { ActionCtx } from '../../convex/_generated/server';
import { loadTitleSchedulesEffect } from '../../convex/calendarProviders';
import schema from '../../convex/schema';

const modules = import.meta.glob('../../convex/**/*.ts');
const savedEpisodes = [{ season: 1, episode: 1, name: 'Existing episode' }];

beforeEach(() => {
  vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'test-token');
  vi.stubEnv('TVDB_API_KEY', 'test-key');
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each([
  { provider: 'tmdb', key: 'tmdb:season:88:1' },
  { provider: 'tvdb', key: 'tvdb:season:88:official:1' },
] as const)(
  'does not replace a $provider season snapshot with a malformed successful response',
  async ({ provider, key }) => {
    const t = convexTest({ schema, modules });
    await t.mutation(internal.providerSnapshots.put, {
      key,
      entry: { kind: 'episodes', value: savedEpisodes },
    });
    for (const payload of [{}, { episodes: null }, { episodes: {} }, { episodes: [[]] }]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL | Request) =>
          String(input).endsWith('/login')
            ? Response.json({ data: { token: 'test-token' } })
            : Response.json(provider === 'tvdb' ? { data: payload } : payload),
        ),
      );
      const result =
        provider === 'tmdb'
          ? t.action(internal.tmdb.refreshSeasonDetails, { tmdbId: 88, season: 1, force: true })
          : t.action(internal.tvdb.refreshSeason, {
              tvdbId: 88,
              order: 'official',
              season: 1,
              force: true,
            });
      await expect(result).rejects.toThrow('malformed data');
      expect(await t.query(internal.providerSnapshots.get, { key })).toMatchObject({
        value: savedEpisodes,
      });
    }
  },
);

it('continues to accept explicitly empty seasons and TMDB season 404s', async () => {
  const t = convexTest({ schema, modules });
  for (const response of [Response.json({ episodes: [] }), new Response('{}', { status: 404 })]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    );
    await expect(
      t.action(internal.tmdb.refreshSeasonDetails, {
        tmdbId: 88,
        season: 1,
        force: true,
      }),
    ).resolves.toEqual([]);
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) =>
      Response.json({
        data: String(input).endsWith('/login') ? { token: 'test-token' } : { episodes: [] },
      }),
    ),
  );
  await expect(
    t.action(internal.tvdb.refreshSeason, {
      tvdbId: 88,
      order: 'official',
      season: 1,
      force: true,
    }),
  ).resolves.toEqual([]);
});

it('rejects a malformed TVDB season catalog before caching a successfully empty guide', async () => {
  const t = convexTest({ schema, modules });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) =>
      Response.json({
        data: String(input).endsWith('/login')
          ? { token: 'test-token' }
          : { id: 88, name: 'Anime', genres: [{ name: 'Anime' }], seasons: {} },
      }),
    ),
  );
  await expect(
    t.action(internal.tvdb.refreshAnimeWithMapping, {
      tmdbId: 88,
      tvdbId: 88,
      order: 'official',
      title: 'Anime',
      force: true,
    }),
  ).rejects.toThrow('malformed data');
  expect(
    await t.query(internal.providerSnapshots.get, { key: 'tvdb:anime:v10:88:88:official' }),
  ).toBeNull();
});

it.each([
  { episodes: [null] },
  { episodes: [[]] },
  { episodes: [{ id: 201 }] },
  { episodes: [{ id: 201, seasonNumber: 1, number: 1, name: 'Released' }, {}] },
])('does not verify a partial or malformed TVDB episode count: %j', async ({ episodes }) => {
  const t = convexTest({ schema, modules });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/login')) return Response.json({ data: { token: 'test-token' } });
      if (url.includes('/series/88/extended'))
        return Response.json({
          data: {
            name: 'Anime',
            genres: [{ name: 'Anime' }],
            seasons: [{ id: 10, number: 1, type: { type: 'official' } }],
          },
        });
      if (url.endsWith('/seasons/10/extended'))
        return Response.json({ data: { id: 10, episodes } });
      return new Response('{}', { status: 404 });
    }),
  );
  const guide = await t.action(internal.tvdb.refreshAnimeWithMapping, {
    tmdbId: 88,
    tvdbId: 88,
    order: 'official',
    title: 'Anime',
    requestedSeason: 2,
    force: true,
  });
  expect(guide?.seasons).toEqual([
    { season: 1, name: 'Season 1', episodeCount: 0, episodeCountVerified: false },
  ]);
});

it.each([-1, 1.5])('ignores an invalid optional calendar season hint: %s', async (season) => {
  const fetch = vi.fn(async () =>
    Response.json({
      seasons: [],
      last_episode_to_air: { season_number: season },
      episodes: [],
    }),
  );
  vi.stubGlobal('fetch', fetch);
  const ctx = {
    runQuery: async (_ref: unknown, { keys }: { keys: string[] }) => keys.map(() => null),
    runMutation: async () => true,
  } as unknown as ActionCtx;
  await expect(
    Effect.runPromise(
      loadTitleSchedulesEffect(
        ctx,
        [
          {
            item: { tmdbId: 88, mediaType: 'tv', title: 'Show', status: 'watching' },
            hasSavedSchedule: false,
          },
        ],
        '2026-10-01',
        '2026-10-31',
        'US',
        false,
      ),
    ),
  ).resolves.toMatchObject({ results: [{ events: [], failed: false }] });
  expect(fetch).toHaveBeenCalledTimes(1);
});
