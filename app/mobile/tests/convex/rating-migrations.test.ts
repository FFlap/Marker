import { convexTest } from 'convex-test';
import migrationsTest from '@convex-dev/migrations/test';
import { expect, it, vi } from 'vitest';
import schema from '../../convex/schema';
import { api, internal } from '../../convex/_generated/api';

const modules = import.meta.glob('../../convex/**/*.ts');

it('converts historical ratings once, preserves new ratings, and rebuilds profile averages', async () => {
  vi.useFakeTimers();
  try {
    const t = convexTest(schema, modules);
    migrationsTest.register(t);
    const userId = await t.run((ctx) => ctx.db.insert('users', { clerkId: 'rating-migration' }));
    const user = t.withIdentity({ subject: 'rating-migration' });
    const itemId = await user.mutation(api.library.items.addItem, {
      tmdbId: 1,
      mediaType: 'movie',
      title: 'Historical',
      status: 'watched',
      rating: 4.5,
    });
    const newId = await user.mutation(api.library.items.addItem, {
      tmdbId: 2,
      mediaType: 'movie',
      title: 'New',
      status: 'watched',
      rating: 3,
    });
    const episodeId = await t.run(async (ctx) => {
      await ctx.db.patch(itemId, { rating: 9, ratingScale: undefined });
      await ctx.db.insert('activityEvents', {
        userId,
        itemId,
        title: 'Historical',
        kind: 'rating',
        rating: 9,
        createdAt: 1,
      });
      return ctx.db.insert('episodes', {
        userId,
        itemId,
        season: 1,
        episode: 1,
        watched: true,
        tags: [],
        metadataProvider: 'tmdb',
        rating: 4,
      });
    });
    for (let pass = 0; pass < 2; pass += 1) {
      for (const fn of [
        internal.ratingMigrations.items,
        internal.ratingMigrations.episodes,
        internal.ratingMigrations.activity,
      ]) {
        await t.mutation(fn, { cursor: null, dryRun: false });
      }
    }
    await t.mutation(internal.ratingMigrations.profiles, { cursor: null, dryRun: false });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const rows = await t.run(async (ctx) => ({
      item: await ctx.db.get(itemId),
      fresh: await ctx.db.get(newId),
      episode: await ctx.db.get(episodeId),
      events: await ctx.db
        .query('activityEvents')
        .withIndex('by_actor_time', (q) => q.eq('userId', userId))
        .collect(),
    }));
    expect(rows.item).toMatchObject({ rating: 4.5, ratingScale: 5 });
    expect(rows.fresh).toMatchObject({ rating: 3, ratingScale: 5 });
    expect(rows.episode).toMatchObject({ rating: 2, ratingScale: 5 });
    expect(rows.events.find((event) => event.createdAt === 1)).toMatchObject({
      rating: 4.5,
      ratingScale: 5,
    });
    expect((await user.query(api.stats.profile, {})).avgRating).toBe(3.75);
    await expect(
      user.mutation(api.library.items.updateItem, { itemId, rating: 6 }),
    ).rejects.toThrow('between 0 and 5');
    await user.mutation(api.library.items.updateItem, { itemId, rating: 3.5 });
    expect((await t.run((ctx) => ctx.db.get(itemId)))?.rating).toBe(3.5);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    vi.useRealTimers();
  }
});
