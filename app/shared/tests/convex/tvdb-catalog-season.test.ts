import { convexTest } from 'convex-test';
import { expect, it } from 'vitest';
import { internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import { SNAPSHOT_TTL_MS } from '../../convex/providerSnapshots';

const modules = import.meta.glob('../../convex/**/*.ts');

async function setup() {
  const t = convexTest({ schema, modules, transactionLimits: true });
  const ids = await t.run(async (ctx) => {
    const manifest = await ctx.db.insert('providerSnapshots', {
      key: 'tvdb:catalog:v1:99:official:eng',
      refreshedAt: Date.now(),
      entry: { kind: 'tvdbCatalog', value: { generation: 'generation', chunks: 2, count: 3 } },
    });
    await ctx.db.insert('providerSnapshots', {
      key: 'tvdb:season:catalog:generation:0',
      refreshedAt: Date.now(),
      entry: {
        kind: 'episodes',
        value: [
          { id: 1, providerEpisodeId: 1, season: 1, episode: 1, name: 'First' },
          { id: 2, providerEpisodeId: 2, season: 2, episode: 1, name: 'Second season' },
        ],
      },
    });
    const last = await ctx.db.insert('providerSnapshots', {
      key: 'tvdb:season:catalog:generation:1',
      refreshedAt: Date.now(),
      entry: {
        kind: 'episodes',
        value: [{ id: 3, providerEpisodeId: 3, season: 1, episode: 2, name: 'Next' }],
      },
    });
    return { manifest, last };
  });
  return { t, ...ids };
}

it('reads one season across catalog chunks and retains provider identities and ordering', async () => {
  const { t } = await setup();
  expect(
    await t.query(internal.tvdbCatalog.readFreshSeason, { id: 99, order: 'official', season: 1 }),
  ).toEqual([
    { id: 1, providerEpisodeId: 1, season: 1, episode: 1, name: 'First' },
    { id: 3, providerEpisodeId: 3, season: 1, episode: 2, name: 'Next' },
  ]);
  expect(
    await t.query(internal.tvdbCatalog.readFreshSeason, { id: 99, order: 'official', season: 0 }),
  ).toEqual([]);
  expect(
    await t.query(internal.tvdbCatalog.readFreshSeason, { id: 99, order: 'dvd', season: 1 }),
  ).toBeNull();
});

it('requires every generation chunk even if the requested season appears in the first chunk', async () => {
  const { t, last } = await setup();
  await t.run((ctx) => ctx.db.delete(last));
  expect(
    await t.query(internal.tvdbCatalog.readFreshSeason, { id: 99, order: 'official', season: 2 }),
  ).toBeNull();
});

it('falls back for stale, inconsistent and oversized manifests', async () => {
  const { t, manifest } = await setup();
  const read = () =>
    t.query(internal.tvdbCatalog.readFreshSeason, { id: 99, order: 'official', season: 1 });
  await t.run((ctx) => ctx.db.patch(manifest, { refreshedAt: Date.now() - SNAPSHOT_TTL_MS - 1 }));
  expect(await read()).toBeNull();
  await t.run((ctx) =>
    ctx.db.patch(manifest, {
      refreshedAt: Date.now(),
      entry: { kind: 'tvdbCatalog', value: { generation: 'generation', chunks: 2, count: 4 } },
    }),
  );
  expect(await read()).toBeNull();
  await t.run((ctx) =>
    ctx.db.patch(manifest, {
      entry: { kind: 'tvdbCatalog', value: { generation: 'generation', chunks: 17, count: 2000 } },
    }),
  );
  expect(await read()).toBeNull();
});
