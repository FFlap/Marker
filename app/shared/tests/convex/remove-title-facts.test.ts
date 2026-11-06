import { convexTest } from 'convex-test';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { expect, it } from 'vitest';
import { internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import { resolvedTitleValidator } from '../../convex/publicValidators';

const modules = import.meta.glob('../../convex/**/*.ts');
const legacySchema = defineSchema({
  ...schema.tables,
  resolvedTitles: defineTable({
    ...resolvedTitleValidator.omit('_id', '_creationTime').fields,
    runtime: v.optional(v.number()),
    voteAverage: v.optional(v.number()),
  })
    .index('by_tmdb', ['mediaType', 'tmdbId'])
    .index('by_refreshed_at', ['refreshedAt']),
});

it('removes legacy title facts without removing title metadata, and is safe to repeat', async () => {
  const t = convexTest(legacySchema, modules);
  const id = await t.run((ctx) =>
    ctx.db.insert('resolvedTitles', {
      tmdbId: 1,
      mediaType: 'movie',
      title: 'Example',
      runtime: 120,
      voteAverage: 8,
      episodeRunTime: [],
      genres: ['Drama'],
      cast: [],
      seasons: [],
      metadataProvider: 'tmdb',
      refreshedAt: 1,
      refreshAfter: 2,
      orderEpoch: 0,
    }),
  );
  expect(
    await t.mutation(internal.resolvedMetadata.cleanup.removeTitleFacts, { phase: 'titles' }),
  ).toMatchObject({ updated: 1, isDone: true });
  const title = await t.run((ctx) => ctx.db.get(id));
  expect(title).not.toHaveProperty('runtime');
  expect(title).not.toHaveProperty('voteAverage');
  expect(title).toMatchObject({ title: 'Example', genres: ['Drama'] });
  expect(
    await t.mutation(internal.resolvedMetadata.cleanup.removeTitleFacts, { phase: 'titles' }),
  ).toMatchObject({ updated: 0, isDone: true });
});
