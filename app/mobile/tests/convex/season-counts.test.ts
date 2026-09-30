import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';

const modules = import.meta.glob('../../convex/**/*.ts');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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
  const guide = await t.action(internal.tvdb.refreshAnimeWithMapping, args);
  expect(guide?.seasons).toMatchObject([
    { season: 0, episodeCount: 0 },
    { season: 1, episodeCount: 1 },
    { season: 2, episodeCount: 2 },
    { season: 3, episodeCount: 0 },
    { season: 4, episodeCount: 0 },
  ]);
  for (const id of [11, 99]) {
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith(`/seasons/${id}/extended`)),
    ).toBe(false);
  }
  const requests = fetchMock.mock.calls.length;
  expect(await t.action(internal.tvdb.refreshAnimeWithMapping, args)).toEqual(guide);
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
  const guide = await t.action(internal.tvdb.refreshAnimeWithMapping, {
    tmdbId: 89,
    tvdbId: 333,
    title: 'Long anime',
    order: 'dvd',
    requestedSeason: 79,
  });
  expect(guide?.seasons).toHaveLength(80);
  expect(
    fetchMock.mock.calls.filter(([url]) => /\/seasons\/\d+\/extended$/.test(String(url))),
  ).toHaveLength(64);
  expect(guide?.seasons[79]).toMatchObject({ season: 79, episodeCount: 0 });
});
