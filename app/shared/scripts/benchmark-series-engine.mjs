import { spawn, execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  cpSync,
  symlinkSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ConvexHttpClient } from 'convex/browser';

// All benchmark mutations run on a NEW anonymous local deployment, never the configured cloud deployment.
const targetMilliseconds = Number(process.env.BENCH_TARGET_MS ?? 1000);
if (!Number.isFinite(targetMilliseconds) || targetMilliseconds <= 0)
  throw new Error('BENCH_TARGET_MS must be positive');
const source = process.cwd();
const cli = resolve('node_modules/convex/bin/main.js');
const providers = ['TMDB_API_READ_ACCESS_TOKEN', 'TVDB_API_KEY'].flatMap((name) => {
  try {
    const value = execFileSync(process.execPath, [cli, 'env', 'get', name], {
      cwd: source,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return value && value !== 'undefined' ? [{ name, value }] : [];
  } catch {
    if (name === 'TMDB_API_READ_ACCESS_TOKEN')
      throw new Error('Cannot read the development deployment TMDB credential');
    return [];
  }
});
const directory = mkdtempSync(join(tmpdir(), 'marker-series-engine-'));
chmodSync(directory, 0o700);
cpSync('convex', join(directory, 'convex'), { recursive: true });
cpSync('lib', join(directory, 'lib'), { recursive: true });
cpSync('package.json', join(directory, 'package.json'));
cpSync('tsconfig.json', join(directory, 'tsconfig.json'));
symlinkSync(resolve('node_modules'), join(directory, 'node_modules'), 'dir');
writeFileSync(join(directory, 'convex/auth.config.ts'), 'export default { providers: [] };\n');
// These admin-only helpers exist only in the disposable backend copy.
writeFileSync(
  join(directory, 'convex/seriesSpeedBenchmark.ts'),
  `
import { internalMutation, internalQuery } from './_generated/server';
import schema from './schema';
import type { TableNames } from './_generated/dataModel';
import { v } from 'convex/values';
export const reset = internalMutation({
  args: { pinTmdb: v.boolean() }, handler: async (ctx, { pinTmdb }) => {
    for await (const job of ctx.db.system.query('_scheduled_functions')) {
      if (job.state.kind === 'pending') await ctx.scheduler.cancel(job._id);
    }
    for (const table of Object.keys(schema.tables) as TableNames[]) {
      for await (const doc of ctx.db.query(table)) await ctx.db.delete(doc._id);
    }
    await ctx.db.insert('users', { clerkId: 'series-speed-benchmark' });
    if (pinTmdb) await ctx.db.insert('titleMappings', {
      tmdbId: 37854, mediaType: 'tv', source: 'manual', orderEpoch: 0, updatedAt: Date.now(),
    });
  },
});
export const inspect = internalQuery({
  args: {}, handler: async ctx => {
    const episodes = await ctx.db.query('episodes').collect();
    const items = await ctx.db.query('items').collect();
    const summaries = await ctx.db.query('episodeSummaries').collect();
    const title = await ctx.db.query('resolvedTitles').first();
    return { episodes: episodes.length, watched: episodes.filter(e => e.watched).length,
      itemStatus: items[0]?.status, summaryWatched: summaries.reduce((n,s) => n+s.watchedCount, 0),
      provider: title?.metadataProvider, seasonCount: title?.seasons.length, declarationSaved: !!items[0]?.seriesWatch, hydration: items[0]?.seriesWatch?.hydration };
  },
});
`,
);
const statusFile = join(directory, 'convex/seriesSpeedBenchmark.ts');
writeFileSync(
  statusFile,
  readFileSync(statusFile, 'utf8') +
    `
export const hydrationStatus = internalQuery({
  args: {}, handler: async ctx => { const item = await ctx.db.query('items').first(); return item?.seriesWatch?.hydration ?? null; },
});
`,
);
if (process.env.BENCH_PROFILE === '1') {
  const benchmarkFile = join(directory, 'convex/seriesSpeedBenchmark.ts');
  writeFileSync(
    benchmarkFile,
    `
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { getFunctionName } from 'convex/server';
` +
      readFileSync(benchmarkFile, 'utf8') +
      `
export const measure = internalAction({
  args: { itemId: v.id('items') },
  handler: async (ctx, { itemId }): Promise<{ timings: { name: string; ms: number }[] }> => {
    const userId = await ctx.runQuery(internal.clerkAuth.userIdForIdentity, { subject: 'series-speed-benchmark' });
    if (!userId) throw new Error('Missing benchmark user');
    const timings: { name: string; ms: number }[] = [];
    const timed = new Proxy(ctx, { get(target, key) {
      if (!['runAction', 'runMutation', 'runQuery'].includes(String(key))) return Reflect.get(target, key);
      return async (...args: any[]) => {
        const start = Date.now();
        try { return await Reflect.apply(Reflect.get(target, key), target, args); }
        finally { timings.push({ name: getFunctionName(args[0]), ms: Date.now() - start }); }
      };
    } });
    await timed.runMutation(internal.library.seasonWatched.declareSeriesWatched, { userId, itemId, activityDate: new Date().toISOString().slice(0, 10) });
    return { timings };
  },
});
`,
  );
}
const localEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith('CONVEX_')),
);
const backend = spawn(process.execPath, [cli, 'dev', '--tail-logs', 'disable'], {
  cwd: directory,
  env: { ...localEnvironment, CONVEX_AGENT_MODE: 'anonymous' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
const closed = new Promise((resolve) => backend.once('close', resolve));
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Local backend startup timed out. ${log.slice(-2000)}`)),
      180_000,
    );
    const append = (chunk) => {
      log += chunk.toString();
      if (log.includes('Convex functions ready!')) {
        clearTimeout(timeout);
        resolve();
      }
    };
    backend.stdout.on('data', append);
    backend.stderr.on('data', append);
    backend.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    backend.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Local backend exited (${code}). ${log.slice(-2000)}`));
    });
  });
  const config = JSON.parse(
    readFileSync(join(directory, '.convex/local/default/config.json'), 'utf8'),
  );
  const url = `http://127.0.0.1:${config.ports.cloud}`;
  const configured = await fetch(`${url}/api/update_environment_variables`, {
    method: 'POST',
    headers: { Authorization: `Convex ${config.adminKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ changes: providers }),
  });
  if (!configured.ok)
    throw new Error(`Local environment configuration failed (${configured.status})`);
  const client = new ConvexHttpClient(url);
  client.setAdminAuth(config.adminKey, {
    subject: 'series-speed-benchmark',
    issuer: 'https://benchmark.invalid',
  });
  client.setDebug(false);
  const results = [];
  for (let round = 0; round < Number(process.env.BENCH_ROUNDS ?? 3); round += 1) {
    await client.mutation('seriesSpeedBenchmark:reset', {
      pinTmdb: process.env.BENCH_PIN_TMDB === '1',
    });
    const itemId = await client.mutation('library/items:addItem', {
      tmdbId: 37854,
      mediaType: 'tv',
      title: 'One Piece',
      status: 'watchlist',
    });
    const start = performance.now();
    const trace =
      process.env.BENCH_PROFILE === '1'
        ? await client.action('seriesSpeedBenchmark:measure', { itemId })
        : await client.action('library/seasonWatched:moveItemToWatched', { itemId });
    const milliseconds = Number((performance.now() - start).toFixed(2));
    const committed = await client.query('seriesSpeedBenchmark:inspect', {});
    if (!committed.declarationSaved || committed.itemStatus !== 'watched')
      throw new Error('Durable watched declaration verification failed');
    console.log(
      JSON.stringify({
        round: round + 1,
        markMilliseconds: milliseconds,
        episodesAtReturn: committed.episodes,
        declarationSaved: true,
      }),
    );
    const deadline = performance.now() + 120_000;
    while ((await client.query('seriesSpeedBenchmark:hydrationStatus', {})) !== 'complete') {
      if (performance.now() >= deadline)
        throw new Error('Background hydration did not complete within the benchmark deadline');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const hydratedMilliseconds = Number((performance.now() - start).toFixed(2));
    const saved = await client.query('seriesSpeedBenchmark:inspect', {});
    if (
      saved.episodes < 1000 ||
      saved.watched !== saved.episodes ||
      saved.summaryWatched !== saved.episodes ||
      saved.itemStatus !== 'watched'
    )
      throw new Error('Series hydration verification failed');
    results.push({
      milliseconds,
      hydratedMilliseconds,
      targetMet: milliseconds < targetMilliseconds,
      episodesAtReturn: committed.episodes,
      ...saved,
      ...(process.env.BENCH_PROFILE === '1' && { timings: trace.timings }),
    });
    console.log(JSON.stringify({ round: round + 1, ...results.at(-1) }));
  }
  if (process.env.BENCH_REPORT_PATH)
    writeFileSync(process.env.BENCH_REPORT_PATH, JSON.stringify(results, null, 2));
  if (results.some((result) => !result.targetMet))
    throw new Error(
      `Marking exceeded the ${targetMilliseconds} ms target; all raw samples are retained in the report`,
    );
} finally {
  backend.kill('SIGINT');
  await closed;
  rmSync(directory, { recursive: true, force: true });
}
