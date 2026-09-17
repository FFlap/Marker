import { convexTest } from 'convex-test';
import { expect, it } from 'vitest';
import { api } from '../../convex/_generated/api';
import schema from '../../convex/schema';

const modules = import.meta.glob('../../convex/**/*.ts');

it('keeps unknown seasons and hides only complete empty seasons in the current order', async () => {
  const t = convexTest({ schema, modules });
  await t.run(async (ctx) => {
    await ctx.db.insert('users', { clerkId: 'season-view' });
    await ctx.db.insert('resolvedTitles', {
      tmdbId: 209867,
      mediaType: 'tv',
      title: 'Frieren',
      episodeRunTime: [],
      genres: [],
      cast: [],
      seasons: [1, 2, 3, 4, 5].map((season) => ({
        season,
        name: `Season ${season}`,
        episodeCount: season === 1 ? 28 : 0,
      })),
      metadataProvider: 'tvdb',
      orderEpoch: 2,
      refreshedAt: 1,
      refreshAfter: 2,
    });
    for (const season of [3, 4, 5]) {
      await ctx.db.insert('resolvedSeasons', {
        tmdbId: 209867,
        season,
        metadataProvider: 'tvdb',
        episodeCount: 0,
        chunksComplete: season !== 4,
        orderEpoch: season === 5 ? 1 : 2,
        refreshedAt: 1,
        refreshAfter: 2,
      });
    }
  });
  const user = t.withIdentity({ subject: 'season-view' });
  const identity = { tmdbId: 209867, mediaType: 'tv' as const };
  const itemId = await user.mutation(api.library.items.addItem, {
    ...identity,
    title: 'Frieren',
    status: 'watching',
  });
  const views = [
    await user.query(api.resolvedMetadata.reads.getTitle, identity),
    (await user.query(api.resolvedMetadata.reads.getTitleView, identity)).title,
    (await user.query(api.resolvedMetadata.reads.getItemView, { itemId })).title,
  ];
  for (const title of views) {
    expect(title?.seasons.map((season) => season.season)).toEqual([1, 2, 4, 5]);
  }
  // Loading season 2 proves that the provider's zero was an unknown count.
  await t.run((ctx) =>
    ctx.db.insert('resolvedSeasons', {
      tmdbId: identity.tmdbId,
      season: 2,
      metadataProvider: 'tvdb',
      episodeCount: 10,
      chunksComplete: true,
      orderEpoch: 2,
      refreshedAt: 1,
      refreshAfter: 2,
    }),
  );
  expect(
    (await user.query(api.resolvedMetadata.reads.getTitle, identity))?.seasons.map(
      (season) => season.season,
    ),
  ).toContain(2);
});
