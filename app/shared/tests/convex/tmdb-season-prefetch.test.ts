import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';

const modules = import.meta.glob('../../convex/**/*.ts');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('fetches missing seasons in one HTTP request, reuses snapshots, and skips omitted endpoints', async () => {
  const t = convexTest(schema, modules);
  vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'test');
  const fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          'season/1': {
            episodes: [{ id: 101, season_number: 1, episode_number: 1, name: 'First' }],
          },
          'season/2': {
            episodes: [{ id: 201, season_number: 2, episode_number: 1, name: 'Second' }],
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
  vi.stubGlobal('fetch', fetchMock);
  await t.action(internal.tmdb.prefetchSeasonDetails, { tmdbId: 37854, seasons: [1, 2, 1, 3] });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0]![0])).toContain(
    'append_to_response=season/1,season/2,season/3',
  );
  const first = await t.query(internal.providerSnapshots.get, { key: 'tmdb:season:37854:1' });
  expect(first).toMatchObject({
    kind: 'episodes',
    value: [{ season: 1, episode: 1, name: 'First', providerEpisodeId: 101 }],
  });
  expect(await t.query(internal.providerSnapshots.get, { key: 'tmdb:season:37854:3' })).toBeNull();
  await t.action(internal.tmdb.prefetchSeasonDetails, { tmdbId: 37854, seasons: [1, 2] });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await t.action(internal.tmdb.prefetchSeasonDetails, { tmdbId: 37854, seasons: [2, 3] });
  expect(String(fetchMock.mock.calls[1]![0])).toContain('append_to_response=season/3');
});

it('rejects oversized and invalid season batches before making provider requests', async () => {
  const t = convexTest(schema, modules);
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  await expect(
    t.action(internal.tmdb.prefetchSeasonDetails, {
      tmdbId: 37854,
      seasons: Array.from({ length: 21 }, (_, i) => i),
    }),
  ).rejects.toThrow('20 seasons');
  await expect(
    t.action(internal.tmdb.prefetchSeasonDetails, { tmdbId: 37854, seasons: [-1] }),
  ).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});
