import { convexTest } from 'convex-test';
import { expect, it } from 'vitest';
import { v } from 'convex/values';
import { api } from '../../convex/_generated/api';
import { internalAction } from '../../convex/_generated/server';
import schema from '../../convex/schema';
import { putSeason } from './metadata-fixtures';

const modules = import.meta.glob('../../convex/**/*.ts');

async function setup(change: 'order' | 'grow' | 'missing') {
  const resolved: number[] = [];
  const t = convexTest(schema, {
    ...modules,
    '../../convex/resolvedMetadata/seasonResolution.ts': async () => ({
      resolveSeasonForUser: internalAction({
        args: { userId: v.id('users'), tmdbId: v.number(), season: v.number() },
        returns: v.array(v.object({ season: v.number(), episode: v.number(), name: v.string() })),
        handler: async (_ctx, { tmdbId, season }) => {
          resolved.push(season);
          // Simulate metadata publication between the action's separate transactions.
          await t.run(async (ctx) => {
            const title = (await ctx.db.query('resolvedTitles').first())!;
            if (change === 'missing') {
              await ctx.db.delete(title._id);
            } else if (change === 'grow') {
              await ctx.db.patch(title._id, {
                seasons: [...title.seasons, { season: season + 1, name: 'New', episodeCount: 1 }],
              });
            } else if (season === 2) {
              const mapping = (await ctx.db.query('titleMappings').first())!;
              await ctx.db.patch(mapping._id, { orderEpoch: 1 });
              await ctx.db.patch(title._id, { orderEpoch: 1 });
            }
          });
          const epoch = change === 'order' && resolved.includes(2) ? 1 : 0;
          const episodes = Array.from({ length: epoch + 1 }, (_, index) => ({
            season,
            episode: index + 1,
            name: `Episode ${index + 1}`,
          }));
          await putSeason(t, {
            tmdbId,
            season,
            metadataProvider: 'tmdb',
            episodes,
            orderEpoch: epoch,
            refreshedAt: Date.now(),
            refreshAfter: Date.now() + 60_000,
          });
          return episodes;
        },
      }),
    }),
  });
  await t.run(async (ctx) => {
    await ctx.db.insert('users', { clerkId: 'watch-seasons' });
    await ctx.db.insert('titleMappings', {
      tmdbId: 99,
      mediaType: 'tv',
      source: 'auto',
      orderEpoch: 0,
      updatedAt: Date.now(),
    });
    await ctx.db.insert('resolvedTitles', {
      tmdbId: 99,
      mediaType: 'tv',
      title: 'Changing show',
      episodeRunTime: [],
      genres: [],
      cast: [],
      seasons: (change === 'order' ? [1, 2] : [1]).map((season) => ({
        season,
        name: `Season ${season}`,
        episodeCount: 1,
      })),
      metadataProvider: 'tmdb',
      orderEpoch: 0,
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
    });
  });
  const user = t.withIdentity({ subject: 'watch-seasons' });
  const itemId = await user.mutation(api.library.items.addItem, {
    tmdbId: 99,
    mediaType: 'tv',
    title: 'Changing show',
    status: 'watchlist',
  });
  return { user, itemId, resolved };
}

it('revisits completed seasons when the episode order changes during a whole-show update', async () => {
  const { user, itemId, resolved } = await setup('order');
  await user.action(api.library.seasonWatched.moveItemToWatched, { itemId });
  expect(resolved).toEqual([1, 2, 1]);
  for (const season of [1, 2]) {
    const episodes = await user.query(api.library.episodes.listEpisodes, { itemId, season });
    expect(episodes).toHaveLength(2);
    expect(episodes.every((episode) => episode.watched)).toBe(true);
  }
  expect((await user.query(api.library.items.listItems, {}))[0].status).toBe('watched');
});

it('leaves the show in its original status when new seasons exhaust the follow-up limit', async () => {
  const { user, itemId, resolved } = await setup('grow');
  await expect(
    user.action(api.library.seasonWatched.moveItemToWatched, { itemId }),
  ).rejects.toThrow('stale_epoch');
  expect(resolved).toEqual([1, 2, 3]);
  expect((await user.query(api.library.items.listItems, {}))[0].status).toBe('watchlist');
});

it('does not finish a whole-show update when the title identity disappears', async () => {
  const { user, itemId } = await setup('missing');
  await expect(
    user.action(api.library.seasonWatched.moveItemToWatched, { itemId }),
  ).rejects.toThrow('Season identity is unavailable');
  expect((await user.query(api.library.items.listItems, {}))[0].status).toBe('watchlist');
});
