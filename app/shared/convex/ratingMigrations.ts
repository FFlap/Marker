import { Migrations } from '@convex-dev/migrations';
import { components, internal } from './_generated/api';
import schema from './schema';
import { requestProfileStatsRefresh } from './profileStatsRefresh';
import { internalQuery } from './_generated/server';
import { v } from 'convex/values';

const migrations = new Migrations(components.migrations, { schema });

// Mark every processed row, including unrated rows, so retries cannot halve a
// rating twice. Normal rating writes also set this marker before migration runs.
const fiveStarPatch = (doc: { rating?: number; ratingScale?: 5 }) =>
  doc.ratingScale === 5
    ? {}
    : { ratingScale: 5 as const, ...(doc.rating !== undefined && { rating: doc.rating / 2 }) };

export const items = migrations.define({
  table: 'items',
  migrateOne: (_ctx, doc) => fiveStarPatch(doc),
});

export const episodes = migrations.define({
  table: 'episodes',
  migrateOne: (_ctx, doc) => fiveStarPatch(doc),
});

export const activity = migrations.define({
  table: 'activityEvents',
  migrateOne: (_ctx, doc) => fiveStarPatch(doc),
});

// Rebuild totals from migrated items instead of scaling potentially stale totals.
// An already-running refresh is marked to restart after its current pass.
export const profiles = migrations.define({
  table: 'users',
  migrateOne: async (ctx, doc) => {
    await requestProfileStatsRefresh(ctx, doc._id);
  },
});

export const run = migrations.runner([
  internal.ratingMigrations.items,
  internal.ratingMigrations.episodes,
  internal.ratingMigrations.activity,
  internal.ratingMigrations.profiles,
]);

export const audit = internalQuery({
  args: {
    table: v.union(v.literal('items'), v.literal('episodes'), v.literal('activityEvents')),
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    count: v.number(),
    rated: v.number(),
    legacy: v.number(),
    outOfRange: v.number(),
    total: v.number(),
    cursor: v.string(),
    isDone: v.boolean(),
  }),
  handler: async (ctx, { table, cursor }) => {
    const page = await ctx.db
      .query(table)
      .withIndex('by_creation_time')
      .paginate({
        cursor: cursor ?? null,
        numItems: 100,
      });
    return {
      count: page.page.length,
      rated: page.page.filter((doc) => doc.rating !== undefined).length,
      legacy: page.page.filter((doc) => doc.ratingScale !== 5).length,
      outOfRange: page.page.filter(
        (doc) => doc.rating !== undefined && (doc.rating < 0 || doc.rating > 5),
      ).length,
      total: page.page.reduce((sum, doc) => sum + (doc.rating ?? 0), 0),
      cursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});
