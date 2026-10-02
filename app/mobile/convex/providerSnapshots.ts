import { type Infer, v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { providerSnapshotEntryValidator } from './providerValidators';

export const SNAPSHOT_TTL_MS = 15 * 60 * 1000;
export const MAX_SNAPSHOT_BYTES = 700 * 1024;

export type TruncatedSnapshot = {
  __truncatedProviderSnapshot: true;
  originalBytes: number;
};

const serializedBytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value) ?? 'null').byteLength;

export const isTruncatedSnapshot = (value: unknown): value is TruncatedSnapshot =>
  typeof value === 'object' &&
  value !== null &&
  (value as { __truncatedProviderSnapshot?: unknown }).__truncatedProviderSnapshot === true;

const boundedSnapshotValue = (value: unknown) => {
  const originalBytes = serializedBytes(value);
  return originalBytes > MAX_SNAPSHOT_BYTES
    ? {
        __truncatedProviderSnapshot: true as const,
        originalBytes,
      }
    : value;
};

type SnapshotKind = Infer<typeof providerSnapshotEntryValidator>['kind'];

const kindForKey = (key: string): Exclude<SnapshotKind, 'truncated'> => {
  if (key.startsWith('tmdb:movie:')) return 'tmdbMovie';
  if (key.startsWith('tmdb:tv:')) return 'tmdbTv';
  if (key.startsWith('tmdb:season:') || key.startsWith('tvdb:season:')) return 'episodes';
  if (/^tvdb:anime:v\d+:lookup:/.test(key)) return 'tvdbLookup';
  if (key.startsWith('tvdb:anime:')) return 'tvdbGuide';
  if (key.startsWith('calendar:movie:')) return 'calendarMovie';
  if (key.startsWith('calendar:tv:')) return 'calendarTv';
  if (key.startsWith('calendar:season:')) return 'calendarSeason';
  return 'tmdbSearch';
};

type SnapshotActionCtx = { runMutation: Function };

/** Cache failures must never turn a successful provider refresh into a failed refresh. */
export async function putNonFatal(
  ctx: SnapshotActionCtx,
  args: { key: string; value: unknown; metricKey: string },
) {
  try {
    const value = boundedSnapshotValue(args.value);
    await ctx.runMutation(internal.providerSnapshots.put, {
      key: args.key,
      entry: {
        kind: isTruncatedSnapshot(value) ? 'truncated' : kindForKey(args.key),
        value,
      },
    });
    return true;
  } catch (error) {
    console.warn('[provider-snapshot-write-skipped]', args.metricKey, error);
    return false;
  }
}

export const get = internalQuery({
  args: { key: v.string() },
  returns: v.union(
    v.null(),
    ...providerSnapshotEntryValidator.members.map((entry) =>
      v.object({
        ...entry.fields,
        refreshedAt: v.number(),
      }),
    ),
  ),
  handler: async (ctx, { key }) => {
    const stored = await ctx.db
      .query('providerSnapshots')
      .withIndex('by_key', (query) => query.eq('key', key))
      .unique();
    return stored ? { ...stored.entry, refreshedAt: stored.refreshedAt } : null;
  },
});

export const put = internalMutation({
  args: { key: v.string(), entry: providerSnapshotEntryValidator },
  returns: v.null(),
  handler: async (ctx, { key, entry }) => {
    if (!key || key.length > 500) throw new Error('Invalid provider snapshot key');
    const existing = await ctx.db
      .query('providerSnapshots')
      .withIndex('by_key', (query) => query.eq('key', key))
      .unique();
    const next = { entry, refreshedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, next);
    else await ctx.db.insert('providerSnapshots', { key, ...next });
    return null;
  },
});

/** Isolated, bounded continuation so snapshot cleanup cannot fail other pruning. */
export const prune = internalMutation({
  args: { cursor: v.optional(v.string()) },
  returns: v.object({ deleted: v.number(), isDone: v.boolean() }),
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query('providerSnapshots')
      .withIndex('by_refreshed_at', (query) =>
        query.lt('refreshedAt', Date.now() - 24 * 60 * 60 * 1000),
      )
      .paginate({ cursor: cursor ?? null, numItems: 200 });
    for (const snapshot of page.page) await ctx.db.delete(snapshot._id);
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.providerSnapshots.prune, {
        cursor: page.continueCursor,
      });
    return { deleted: page.page.length, isDone: page.isDone };
  },
});
