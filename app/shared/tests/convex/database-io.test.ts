import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { api, internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import { writeActivityEvents } from '../../convex/activityEvents';
import {
  applyProfileStatsDelta,
  updateProfileStatsForItem,
} from '../../convex/profileStatsRefresh';
import { updateSummaryForEpisodeUpsert } from '../../convex/episodeSummaries';
import type { Doc, Id } from '../../convex/_generated/dataModel';

const modules = import.meta.glob('../../convex/**/*.ts');
afterEach(() => vi.useRealTimers());

async function setup() {
  vi.useFakeTimers();
  const t = convexTest({ schema, modules, transactionLimits: true });
  const userId = await t.run((ctx) => ctx.db.insert('users', { clerkId: 'io-test' }));
  const asUser = t.withIdentity({ subject: 'io-test' });
  const stats = () =>
    t.run((ctx) =>
      ctx.db
        .query('profileStats')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .unique(),
    );
  const drain = () => t.finishAllScheduledFunctions(() => vi.runAllTimers());
  const rebuild = async () => {
    await t.mutation(internal.profileStatsRefresh.start, { userId });
    await drain();
    return stats();
  };
  return { t, userId, asUser, stats, drain, rebuild };
}

const movie = (tmdbId: number) => ({
  tmdbId,
  mediaType: 'movie' as const,
  title: `Movie ${tmdbId}`,
  status: 'watched' as const,
  runtime: 90,
  timesWatched: 1,
});
const values = (stats: Doc<'profileStats'> | null) => {
  if (!stats) throw new Error('Missing stats');
  const { _id, _creationTime, updatedAt: _updatedAt, tagCounts, ...value } = stats;
  return {
    ...value,
    topTags: value.topTags.map((t) => ({ ...t, tag: t.tag.toLocaleLowerCase() })),
    tagCounts: tagCounts
      ?.map((t) => ({ ...t, tag: t.tag.toLocaleLowerCase() }))
      .toSorted((a, b) => a.tag.localeCompare(b.tag)),
  };
};

it('matches a full rebuild after item edits, reordering, tags, and removal', async () => {
  const { asUser, stats, drain, rebuild } = await setup();
  const first = await asUser.mutation(api.library.items.addItem, {
    ...movie(1),
    rating: 4,
    tags: ['alpha', 'beta'],
  });
  const second = await asUser.mutation(api.library.items.addItem, { ...movie(2), tags: ['ALPHA'] });
  await drain();
  await asUser.mutation(api.library.items.updateItem, {
    itemId: first,
    status: 'watchlist',
    clearRating: true,
    tags: ['gamma'],
    timesWatched: 2,
  });
  await asUser.mutation(api.library.ordering.reorderItem, { itemId: second, status: 'dropped' });
  await asUser.mutation(api.library.items.addTagToItems, {
    itemIds: [first, second],
    tag: 'delta',
  });
  expect(values(await stats())).toEqual(values(await rebuild()));
  await asUser.mutation(api.library.items.removeItem, { itemId: second });
  expect(await stats()).toMatchObject({
    totalItems: 1,
    moviesWatched: 0,
    totalWatchMinutes: 0,
    ratingCount: 0,
  });
  await drain();
  expect(values(await stats())).toEqual(values(await rebuild()));
});

it('keeps episode runtime, verification, tags, and deleting-title totals exact', async () => {
  const { t, userId, asUser, stats, drain, rebuild } = await setup();
  const itemId = await asUser.mutation(api.library.items.addItem, {
    tmdbId: 10,
    mediaType: 'tv',
    title: 'Show',
    status: 'watchlist',
    runtime: 40,
  });
  await drain();
  const episode = async (
    number: number,
    next: { watched: boolean; runtime?: number; unverified?: boolean; tags: string[] },
  ) =>
    t.run(async (ctx) => {
      const old = await ctx.db
        .query('episodes')
        .withIndex('by_item', (q) => q.eq('itemId', itemId).eq('season', 1).eq('episode', number))
        .unique();
      await updateSummaryForEpisodeUpsert(
        ctx,
        userId,
        itemId,
        1,
        next.watched,
        old,
        undefined,
        next,
      );
      if (old) await ctx.db.patch(old._id, next);
      else
        await ctx.db.insert('episodes', {
          userId,
          itemId,
          season: 1,
          episode: number,
          metadataProvider: 'tmdb',
          ...next,
        });
    });
  await episode(1, { watched: true, tags: ['favorite'] });
  await episode(2, { watched: true, runtime: 25, tags: [] });
  await episode(3, { watched: true, runtime: 999, unverified: true, tags: [] });
  expect(await stats()).toMatchObject({ episodesWatched: 3, totalWatchMinutes: 65 });
  await episode(3, { watched: true, runtime: 30, unverified: false, tags: ['favorite'] });
  await episode(2, { watched: false, runtime: 25, tags: ['other'] });
  await t.run(async (ctx) => {
    const item = (await ctx.db.get(itemId))!;
    await ctx.db.patch(itemId, { runtime: 45 });
    await updateProfileStatsForItem(ctx, item, { ...item, runtime: 45 });
  });
  expect(await stats()).toMatchObject({ episodesWatched: 2, totalWatchMinutes: 75 });
  expect(values(await stats())).toEqual(values(await rebuild()));
  await asUser.mutation(api.library.items.removeItem, { itemId });
  expect(await stats()).toMatchObject({
    totalItems: 0,
    episodesWatched: 0,
    totalWatchMinutes: 0,
    topTags: [],
  });
  await drain();
  expect(values(await stats())).toEqual(values(await rebuild()));
});

it('coalesces initialization and restarts when a mutation interleaves with a rebuild', async () => {
  const { t, userId, asUser, stats, drain } = await setup();
  const id = await asUser.mutation(api.library.items.addItem, movie(1));
  await asUser.mutation(api.library.items.addItem, movie(2));
  let refresh = await t.run((ctx) => ctx.db.query('profileStatsRefreshes').unique());
  expect(refresh).toMatchObject({ hasStarted: false, restartRequested: false });
  await t.mutation(internal.profileStatsRefresh.processBatch, { refreshId: refresh!._id });
  await asUser.mutation(api.library.items.updateItem, { itemId: id, timesWatched: 3 });
  refresh = await t.run((ctx) => ctx.db.query('profileStatsRefreshes').unique());
  expect(refresh).toMatchObject({ hasStarted: true, restartRequested: true });
  await drain();
  expect(await stats()).toMatchObject({ totalItems: 2, totalWatchMinutes: 360, tagCounts: [] });
  // Pre-upgrade stats are bootstrapped without applying a delta twice.
  await t.run(async (ctx) => {
    const s = await ctx.db.query('profileStats').unique();
    await ctx.db.patch(s!._id, { tagCounts: undefined });
  });
  await asUser.mutation(api.library.items.updateItem, { itemId: id, timesWatched: 2 });
  await drain();
  expect(await stats()).toMatchObject({ userId, totalWatchMinutes: 270, tagCounts: [] });
});

it('updates a 500-title profile in constant reads without scheduling another rebuild', async () => {
  const { t, userId, asUser, rebuild } = await setup();
  const ids = await t.run(async (ctx) => {
    const ids: Id<'items'>[] = [];
    for (let n = 0; n < 500; n++)
      ids.push(
        await ctx.db.insert('items', {
          ...movie(n + 1),
          userId,
          normalizedTitle: `movie ${n + 1}`,
          isAnime: false,
          tags: [],
          rank: n,
          createdAt: 1,
          updatedAt: 1,
        }),
      );
    return ids;
  });
  await rebuild();
  const baseline = await t.run(async (ctx) => {
    await ctx.db
      .query('items')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
    return ctx.meta.getTransactionMetrics();
  });
  const optimized = await asUser.mutation(async (ctx) => {
    await ctx.runMutation(api.library.items.updateItem, { itemId: ids[0], timesWatched: 2 });
    return ctx.meta.getTransactionMetrics();
  });
  expect(optimized.documentsRead.used).toBeLessThan(10);
  expect(optimized.bytesRead.used).toBeLessThan(baseline.bytesRead.used / 20);
  expect(await t.run((ctx) => ctx.db.query('profileStatsRefreshes').collect())).toEqual([]);
  console.info('PROFILE_IO', JSON.stringify({ baseline, optimized }));
});

it('trims only evicted activity events and preserves timestamp ordering, ties, and users', async () => {
  const { t, userId, asUser } = await setup();
  const itemId = await asUser.mutation(api.library.items.addItem, {
    ...movie(1),
    status: 'watchlist',
  });
  const other = await t.run((ctx) => ctx.db.insert('users', { clerkId: 'other' }));
  await t.run(async (ctx) => {
    for (let n = 0; n < 200; n++)
      await ctx.db.insert('activityEvents', {
        userId,
        itemId,
        title: `${n}`,
        kind: 'status',
        status: 'watching',
        createdAt: n,
      });
    await ctx.db.insert('activityEvents', {
      userId: other,
      itemId,
      title: 'Other',
      kind: 'status',
      createdAt: 0,
    });
  });
  const event = { userId, itemId, title: 'New', kind: 'status' as const, createdAt: 300 };
  // First write adopts an existing 200-row history.
  await t.run((ctx) => writeActivityEvents(ctx, [event]));
  const baseline = await t.run(async (ctx) => {
    await ctx.db
      .query('activityEvents')
      .withIndex('by_actor_time', (q) => q.eq('userId', userId))
      .order('desc')
      .take(320);
    return ctx.meta.getTransactionMetrics();
  });
  const optimized = await t.run(async (ctx) => {
    await writeActivityEvents(ctx, [{ ...event, createdAt: -1 }, event]);
    return ctx.meta.getTransactionMetrics();
  });
  expect(optimized.documentsRead.used).toBeLessThanOrEqual(5);
  expect(optimized.bytesRead.used).toBeLessThan(baseline.bytesRead.used / 20);
  const rows = await t.run((ctx) =>
    ctx.db
      .query('activityEvents')
      .withIndex('by_actor_time', (q) => q.eq('userId', userId))
      .order('desc')
      .collect(),
  );
  expect(rows).toHaveLength(200);
  expect(rows[0].createdAt).toBe(300);
  expect(rows.at(-1)?.createdAt).toBe(2);
  expect(
    await t.run((ctx) =>
      ctx.db
        .query('activityEvents')
        .withIndex('by_actor_time', (q) => q.eq('userId', other))
        .collect(),
    ),
  ).toHaveLength(1);
  console.info('ACTIVITY_IO', JSON.stringify({ baseline, optimized }));
});

it('does not accept incomplete tag counters as an incremental baseline', async () => {
  const { t, userId, asUser, drain, stats } = await setup();
  await asUser.mutation(api.library.items.addItem, movie(1));
  await drain();
  await t.run((ctx) =>
    applyProfileStatsDelta(ctx, userId, {
      tagDeltas: Array.from({ length: 1_001 }, (_, n) => ({ tag: `tag ${n}`, count: 1 })),
    }),
  );
  expect(await t.run((ctx) => ctx.db.query('profileStatsRefreshes').collect())).toHaveLength(1);
  expect(await stats()).toMatchObject({ tagCounts: [] });
});

it('keeps independent season repairs scoped through continuations', async () => {
  const { t, userId, asUser, drain } = await setup();
  const itemId = await asUser.mutation(api.library.items.addItem, {
    tmdbId: 90,
    mediaType: 'tv',
    title: 'Long show',
    status: 'watchlist',
  });
  await drain();
  await t.run(async (ctx) => {
    await ctx.db.insert('resolvedTitles', {
      tmdbId: 90,
      mediaType: 'tv',
      title: 'Long show',
      episodeRunTime: [],
      genres: [],
      cast: [],
      seasons: [1, 2, 3].map((season) => ({
        season,
        name: `Season ${season}`,
        episodeCount: 101,
        episodeCountVerified: true,
      })),
      metadataProvider: 'tmdb',
      orderEpoch: 0,
      refreshedAt: 1,
      refreshAfter: Date.now() + 100000,
    });
    for (const season of [1, 2, 3]) {
      await ctx.db.insert('resolvedSeasons', {
        tmdbId: 90,
        season,
        metadataProvider: 'tmdb',
        orderEpoch: 0,
        seasonVersion: 'v1',
        chunksComplete: true,
        chunkCount: 1,
        episodeCount: 101,
        refreshedAt: 1,
        refreshAfter: Date.now() + 100000,
      });
      await ctx.db.insert('resolvedSeasonChunks', {
        tmdbId: 90,
        season,
        orderEpoch: 0,
        seasonVersion: 'v1',
        chunkIndex: 0,
        refreshedAt: 1,
        episodes: Array.from({ length: 101 }, (_, n) => ({
          season,
          episode: n + 1,
          name: 'Updated',
        })),
      });
      if (season === 3) continue;
      for (let episode = 1; episode <= 101; episode++)
        await ctx.db.insert('episodes', {
          userId,
          itemId,
          season,
          episode,
          name: 'Old',
          watched: false,
          tags: [],
          metadataProvider: 'tmdb',
        });
    }
  });
  expect(
    await t.mutation(internal.episodeProjectionRepair.startEpisodeProjectionRepair, {
      itemId,
      season: 1,
    }),
  ).toMatchObject({ state: 'continued', patched: 100, chunkPairsRead: 1 });
  expect(
    await t.mutation(internal.episodeProjectionRepair.startEpisodeProjectionRepair, {
      itemId,
      season: 2,
    }),
  ).toMatchObject({ state: 'continued', patched: 100, chunkPairsRead: 1 });
  expect(
    await t.mutation(internal.episodeProjectionRepair.startEpisodeProjectionRepair, {
      itemId,
      season: 3,
    }),
  ).toMatchObject({ state: 'skipped', chunkPairsRead: 0 });
  expect(await t.run((ctx) => ctx.db.query('episodeProjectionRepairs').collect())).toHaveLength(2);
  await drain();
  expect(await t.run((ctx) => ctx.db.query('episodeProjectionRepairs').collect())).toHaveLength(0);
  const episodes = await t.run((ctx) =>
    ctx.db
      .query('episodes')
      .withIndex('by_item', (q) => q.eq('itemId', itemId))
      .collect(),
  );
  expect(episodes).toHaveLength(202);
  expect(episodes.every((episode) => episode.name === 'Updated')).toBe(true);
});

it('avoids item writes for unchanged metadata and no-op user edits', async () => {
  const { t, asUser, drain } = await setup();
  const itemId = await asUser.mutation(api.library.items.addItem, { ...movie(1), genres: [] });
  await drain();
  await t.run((ctx) =>
    ctx.db.insert('resolvedTitles', {
      tmdbId: 1,
      mediaType: 'movie',
      title: 'Movie 1',
      runtime: 90,
      episodeRunTime: [],
      genres: [],
      cast: [],
      seasons: [],
      metadataProvider: 'tmdb',
      orderEpoch: 0,
      refreshedAt: 1,
      refreshAfter: Date.now() + 100000,
    }),
  );
  const metadata = await t.mutation(async (ctx) => {
    await ctx.runMutation(internal.resolvedMetadata.publication.refreshItemProjections, {
      mediaType: 'movie',
      tmdbId: 1,
    });
    return ctx.meta.getTransactionMetrics();
  });
  expect(metadata.bytesWritten.used).toBe(0);
  vi.advanceTimersByTime(10_000);
  const edit = await asUser.mutation(async (ctx) => {
    await ctx.runMutation(api.library.items.updateItem, {
      itemId,
      status: 'watched',
      timesWatched: 1,
      clearRating: true,
    });
    return ctx.meta.getTransactionMetrics();
  });
  expect(edit.bytesWritten.used).toBe(0);
});

it('deletes a title with multiple pending season repairs', async () => {
  const { t, asUser, drain } = await setup();
  const itemId = await asUser.mutation(api.library.items.addItem, movie(1));
  await drain();
  await t.run(async (ctx) => {
    for (const targetSeason of [undefined, 1, 2])
      await ctx.db.insert('episodeProjectionRepairs', {
        itemId,
        targetSeason,
        token: 'pending',
        season: targetSeason ?? 1,
        chunkIndex: 0,
      });
  });
  await asUser.mutation(api.library.items.removeItem, { itemId });
  await drain();
  expect(await t.run((ctx) => ctx.db.get(itemId))).toBeNull();
  expect(await t.run((ctx) => ctx.db.query('episodeProjectionRepairs').collect())).toEqual([]);
});

it('joins a small library into a large calendar feed without scanning unrelated candidates', async () => {
  const { t, userId } = await setup();
  const tmdbIds = Array.from({ length: 30 }, (_, n) => n + 1);
  await t.run(async (ctx) => {
    for (const tmdbId of tmdbIds)
      await ctx.db.insert('items', {
        ...movie(tmdbId),
        userId,
        normalizedTitle: `movie ${tmdbId}`,
        tags: [],
        isAnime: false,
        rank: tmdbId,
        createdAt: 1,
        updatedAt: 1,
      });
    await ctx.db.insert('calendarMonths', {
      region: 'movie:CA',
      month: '2026-10',
      version: 'v1',
      candidateCount: 1501,
      refreshedAt: 1,
    });
    for (let ordinal = 0; ordinal <= 1500; ordinal++)
      await ctx.db.insert('calendarCandidates', {
        region: 'movie:CA',
        month: '2026-10',
        version: 'v1',
        ordinal,
        mediaType: 'movie',
        tmdbId: ordinal < 1471 ? ordinal + 100 : 1501 - ordinal,
      });
  });
  const args = { month: '2026-10', region: 'CA', mediaType: 'movie' as const, userId, offset: 0 };
  const baseline = await t.run(async (ctx) => {
    await ctx.db
      .query('calendarCandidates')
      .withIndex('by_catalog_ordinal', (q) =>
        q.eq('region', 'movie:CA').eq('month', '2026-10').eq('version', 'v1'),
      )
      .take(1500);
    return ctx.meta.getTransactionMetrics();
  });
  const { page, metrics } = await t.query(async (ctx) => {
    const page = await ctx.runQuery(internal.calendarCatalog.page, args);
    return { page, metrics: await ctx.meta.getTransactionMetrics() };
  });
  expect(page.nextOffset).toBe(1500);
  expect(page.titles.map((row) => row.item.tmdbId)).toEqual(tmdbIds.slice(1).reverse());
  expect(metrics.documentsRead.used).toBeLessThan(100);
  expect(metrics.bytesRead.used).toBeLessThan(baseline.bytesRead.used / 10);
  const tail = await t.query(internal.calendarCatalog.page, {
    ...args,
    offset: page.nextOffset!,
    version: page.version,
  });
  expect(tail.nextOffset).toBeNull();
  expect(tail.titles.map((row) => row.item.tmdbId)).toEqual([1]);
  console.info('CALENDAR_IO', JSON.stringify({ baseline, optimized: metrics }));
});

it('rejects an oversized history without installing an inaccurate counter', async () => {
  const { t, userId, asUser } = await setup();
  const itemId = await asUser.mutation(api.library.items.addItem, {
    ...movie(1),
    status: 'watchlist',
  });
  await t.run(async (ctx) => {
    for (let n = 0; n < 320; n++)
      await ctx.db.insert('activityEvents', {
        userId,
        itemId,
        title: `${n}`,
        kind: 'status',
        createdAt: n,
      });
  });
  await expect(
    t.run((ctx) =>
      writeActivityEvents(ctx, [
        {
          userId,
          itemId,
          title: 'New',
          kind: 'status',
          createdAt: 321,
        },
      ]),
    ),
  ).rejects.toThrow('Activity history exceeds retention limit');
  expect(await t.run((ctx) => ctx.db.query('activityEventCounts').unique())).toBeNull();
  expect(await t.run((ctx) => ctx.db.query('activityEvents').collect())).toHaveLength(320);
});

it('refreshes top-tag spelling after a case-only edit', async () => {
  const { asUser, stats, drain } = await setup();
  const itemId = await asUser.mutation(api.library.items.addItem, { ...movie(1), tags: ['anime'] });
  await drain();
  expect((await stats())?.topTags).toEqual([{ tag: 'anime', count: 1 }]);
  await asUser.mutation(api.library.items.updateItem, { itemId, tags: ['Anime'] });
  await drain();
  expect((await stats())?.topTags).toEqual([{ tag: 'Anime', count: 1 }]);
  expect((await stats())?.tagCounts).toEqual([{ tag: 'Anime', count: 1 }]);
});
