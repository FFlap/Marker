import { afterEach, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../../convex/schema';
import { internal } from '../../convex/_generated/api';
import { selectSeriesMatch } from '../../convex/tvdbParsing';

const title = 'That Time I Got Reincarnated as a Slime';
// Relevant fields from TVDB v4 search, in the observed API order (2026-09-08).
const results = [
  {
    id: 'series-385374',
    type: 'series',
    name: '転スラ日記 転生したらスライムだった件',
    aliases: [title],
    translations: { eng: 'The Slime Diaries' },
    remote_ids: [{ id: '118541', sourceName: 'TheMovieDB.com' }],
  },
  {
    id: 'series-352408',
    type: 'series',
    name: '転生したらスライムだった件',
    aliases: [title],
    translations: { eng: title },
    remote_ids: [{ id: '82684', sourceName: 'TheMovieDB.com' }],
  },
];
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('selects the parent series rather than the first exact alias on its spinoff', () => {
  expect(selectSeriesMatch(results, 82684, [title])).toEqual(results[1]);
  expect(selectSeriesMatch([...results].reverse(), 82684, [title])).toEqual(results[1]);
});
it('prefers translated titles when remote IDs are absent', () => {
  const withoutIds = results.map(({ remote_ids: _ids, ...entry }) => entry);
  expect(selectSeriesMatch(withoutIds, 82684, [title])).toEqual(withoutIds[1]);
});
it('rejects conflicting provider IDs and ambiguous aliases', () => {
  expect(selectSeriesMatch([results[0]], 82684, [title])).toBeUndefined();
  expect(
    selectSeriesMatch(
      results.map(({ remote_ids: _ids, translations: _names, ...entry }) => entry),
      82684,
      [title],
    ),
  ).toBeUndefined();
});
it('resolves four aired seasons after an old one-season lookup was cached', async () => {
  vi.stubEnv('TVDB_API_KEY', 'test-key');
  const t = convexTest(schema, import.meta.glob('../../convex/**/*.ts'));
  await t.run(async (ctx) => {
    await ctx.db.insert('providerSnapshots', {
      key: 'tvdb:anime:v7:lookup:82684',
      refreshedAt: Date.now(),
      entry: {
        kind: 'tvdbLookup',
        value: { tvdbId: 385374, order: 'official', authoritativeNames: [title.toLowerCase()] },
      },
    });
  });
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const response = (data: unknown) => new Response(JSON.stringify({ data }));
    if (url.endsWith('/login')) return response({ token: 'test-token' });
    if (url.includes('/search/remoteid/')) return response([]);
    if (url.includes('/search?')) return response(results);
    if (url.includes('/series/352408/extended'))
      return response({
        name: results[1].name,
        genres: [{ name: 'Anime' }],
        defaultSeasonType: 1,
        seasons: [0, 1, 2, 3, 4]
          .map((number) => ({ id: 100 + number, number, type: { id: 1, type: 'official' } }))
          .concat([{ id: 200, number: 1, type: { id: 3, type: 'absolute' } }]),
      });
    if (url.includes('/episodes/official/eng'))
      return response({
        episodes: [{ id: 1, seasonNumber: 1, number: 1, name: 'The Storm Dragon, Veldora' }],
      });
    if (url.includes('/translations/eng')) return response({});
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  const guide = await t.action(internal.tvdb.refreshAnime, { tmdbId: 82684, title });
  expect(guide).toMatchObject({ tvdbId: 352408, order: 'official' });
  expect(guide?.seasons.map((season) => season.season)).toEqual([0, 1, 2, 3, 4]);
  expect(guide?.selectedEpisodes?.[0].name).toBe('The Storm Dragon, Veldora');
});
