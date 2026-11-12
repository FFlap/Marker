import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import { hydrateDeclaredWatch } from '../convex/metadata-fixtures';

const modules = import.meta.glob('../../convex/**/*.ts');
const rounds = Number(process.env.BENCH_ROUNDS ?? 3);
const fixtureDirectory = process.env.BENCH_FIXTURE_DIR;
const report: {
  scenario: string;
  milliseconds: number[];
  hydratedMilliseconds: number[];
  episodes: number;
  requests: number[];
}[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

for (const scenario of fixtureDirectory
  ? ['one-piece-tmdb-replay']
  : ['1200-in-one-season', '30-seasons-of-40']) {
  it(`benchmarks cold declaration and hydration: ${scenario}`, async () => {
    const samples: number[] = [];
    const hydratedMilliseconds: number[] = [];
    const requests: number[] = [];
    let episodeCount = 0;
    for (let round = 0; round < rounds; round += 1) {
      const t = convexTest({ schema, modules, transactionLimits: true });
      const title = fixtureDirectory
        ? JSON.parse(readFileSync(join(fixtureDirectory, 'title.json'), 'utf8'))
        : {
            id: 37854,
            name: 'One Piece sized benchmark',
            genres: [{ name: 'Animation' }],
            episode_run_time: [24],
            credits: { cast: [] },
            seasons: Array.from(
              { length: scenario === '1200-in-one-season' ? 1 : 30 },
              (_, index) => ({
                season_number: index + 1,
                name: `Season ${index + 1}`,
                episode_count: scenario === '1200-in-one-season' ? 1200 : 40,
                air_date: '1999-10-20',
              }),
            ),
          };
      let requestCount = 0;
      vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'benchmark-fixture');
      vi.stubEnv('TVDB_API_KEY', '');
      const seasonPayload = (season: number) =>
        fixtureDirectory
          ? JSON.parse(readFileSync(join(fixtureDirectory, `season-${season}.json`), 'utf8'))
          : {
              episodes: Array.from(
                { length: scenario === '1200-in-one-season' ? 1200 : 40 },
                (_, index) => ({
                  id: season * 10_000 + index,
                  season_number: season,
                  episode_number: index + 1,
                  name: `Episode ${index + 1}`,
                  runtime: 24,
                  air_date: '1999-10-20',
                }),
              ),
            };
      vi.stubGlobal('fetch', async (input: string) => {
        requestCount += 1;
        const url = new URL(String(input));
        const seasonMatch = url.pathname.match(/\/season\/(\d+)/);
        const appended = (url.searchParams.get('append_to_response') ?? '')
          .split(',')
          .filter((key) => key.startsWith('season/'));
        const payload = seasonMatch
          ? seasonPayload(Number(seasonMatch[1]))
          : {
              ...title,
              ...Object.fromEntries(
                appended.map((key) => [key, seasonPayload(Number(key.split('/')[1]))]),
              ),
            };
        const latency = Number(process.env.BENCH_LATENCY_MS ?? 0);
        if (latency > 0) await new Promise((resolve) => setTimeout(resolve, latency));
        return new Response(JSON.stringify(payload), {
          headers: { 'content-type': 'application/json' },
        });
      });
      await t.run(async (ctx) => {
        await ctx.db.insert('users', { clerkId: 'benchmark' });
        // Pin the provider so this measures the TMDB path independently of TVDB matching.
        await ctx.db.insert('titleMappings', {
          tmdbId: 37854,
          mediaType: 'tv',
          source: 'manual',
          orderEpoch: 0,
          updatedAt: Date.now(),
        });
      });
      const user = t.withIdentity({ subject: 'benchmark' });
      const itemId = await user.mutation(api.library.items.addItem, {
        tmdbId: 37854,
        title: title.name,
        mediaType: 'tv',
        status: 'watchlist',
      });
      expect(await t.run((ctx) => ctx.db.query('resolvedTitles').first())).toBeNull();
      expect(await t.run((ctx) => ctx.db.query('providerSnapshots').first())).toBeNull();
      expect(await t.run((ctx) => ctx.db.query('episodes').first())).toBeNull();
      const started = performance.now();
      await user.action(api.library.seasonWatched.moveItemToWatched, { itemId });
      samples.push(Number((performance.now() - started).toFixed(2)));
      expect((await t.run((ctx) => ctx.db.get(itemId)))?.seriesWatch?.generation).toBeDefined();
      expect((await hydrateDeclaredWatch(t, itemId))?.hydration).toBe('complete');
      hydratedMilliseconds.push(Number((performance.now() - started).toFixed(2)));
      requests.push(requestCount);
      const saved = await t.run((ctx) => ctx.db.query('episodes').collect());
      episodeCount = saved.length;
      expect(episodeCount).toBeGreaterThan(1000);
      expect(saved.every((episode) => episode.watched)).toBe(true);
      expect((await user.query(api.library.items.listItems, {}))[0].status).toBe('watched');
      const summaries = await t.run((ctx) => ctx.db.query('episodeSummaries').collect());
      expect(summaries.reduce((total, season) => total + season.watchedCount, 0)).toBe(
        episodeCount,
      );
    }
    report.push({
      scenario,
      milliseconds: samples,
      hydratedMilliseconds,
      episodes: episodeCount,
      requests,
    });
    console.log(
      JSON.stringify({
        engine: 'convex-test',
        metadataCache: 'empty',
        provider: `TMDB HTTP fixture replay (${process.env.BENCH_LATENCY_MS ?? 0} ms/request)`,
        results: report,
      }),
    );
    if (process.env.BENCH_REPORT_PATH)
      writeFileSync(process.env.BENCH_REPORT_PATH, JSON.stringify(report, null, 2));
  });
}
