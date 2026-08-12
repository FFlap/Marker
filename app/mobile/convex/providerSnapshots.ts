import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';

export const SNAPSHOT_TTL_MS = 15 * 60 * 1000;
export const MAX_SNAPSHOT_BYTES = 700 * 1024;

export type TruncatedSnapshot = {
  __truncatedProviderSnapshot: true;
  originalBytes: number;
};

const castMember = v.object({
  name: v.string(),
  character: v.string(),
  profilePath: v.optional(v.string()),
});
const season = v.object({ season: v.number(), name: v.string(), episodeCount: v.number() });
const episode = v.object({
  season: v.number(),
  episode: v.number(),
  name: v.string(),
  overview: v.optional(v.string()),
  runtime: v.optional(v.number()),
  imageUrl: v.optional(v.string()),
  airDate: v.optional(v.string()),
  providerEpisodeId: v.optional(v.number()),
});
const animeEpisode = v.object({ id: v.number(), ...episode.fields });
const searchResults = v.array(
  v.object({
    id: v.number(),
    title: v.string(),
    originalTitle: v.optional(v.string()),
    mediaType: v.union(v.literal('movie'), v.literal('tv')),
    posterPath: v.optional(v.string()),
    overview: v.optional(v.string()),
    releaseDate: v.optional(v.string()),
    voteAverage: v.optional(v.number()),
  }),
);
const movie = v.object({
  id: v.number(),
  title: v.string(),
  mediaType: v.literal('movie'),
  posterPath: v.optional(v.string()),
  overview: v.optional(v.string()),
  releaseDate: v.optional(v.string()),
  voteAverage: v.optional(v.number()),
  runtime: v.optional(v.number()),
  genres: v.array(v.string()),
  cast: v.array(castMember),
});
const tv = v.object({
  id: v.number(),
  title: v.string(),
  originalTitle: v.optional(v.string()),
  mediaType: v.literal('tv'),
  posterPath: v.optional(v.string()),
  overview: v.optional(v.string()),
  firstAirDate: v.optional(v.string()),
  voteAverage: v.optional(v.number()),
  episodeRunTime: v.array(v.number()),
  genres: v.array(v.string()),
  seasons: v.array(season),
  cast: v.array(castMember),
});
const animeGuide = v.object({
  tvdbId: v.number(),
  title: v.string(),
  firstAirDate: v.optional(v.string()),
  episodeRunTime: v.array(v.number()),
  genres: v.array(v.string()),
  order: v.string(),
  seasons: v.array(season),
  selectedSeason: v.optional(v.number()),
  selectedEpisodes: v.optional(v.array(animeEpisode)),
});
const lookup = v.object({
  tvdbId: v.number(),
  order: v.string(),
  authoritativeNames: v.array(v.string()),
});
const calendarMovie = v.array(v.object({ date: v.string(), priority: v.number() }));
const calendarTv = v.object({ airDate: v.string(), season: v.number() });
const calendarSeason = v.array(
  v.object({
    date: v.string(),
    season: v.number(),
    episode: v.number(),
    name: v.optional(v.string()),
  }),
);
const truncated = v.object({
  __truncatedProviderSnapshot: v.literal(true),
  originalBytes: v.number(),
});
const snapshotEntry = v.union(
  v.object({ kind: v.literal('tmdbSearch'), value: searchResults }),
  v.object({ kind: v.literal('tmdbMovie'), value: movie }),
  v.object({ kind: v.literal('tmdbTv'), value: tv }),
  v.object({
    kind: v.literal('episodes'),
    value: v.union(v.array(episode), v.array(animeEpisode)),
  }),
  v.object({ kind: v.literal('tvdbGuide'), value: v.union(v.null(), animeGuide) }),
  v.object({ kind: v.literal('tvdbLookup'), value: lookup }),
  v.object({ kind: v.literal('calendarMovie'), value: calendarMovie }),
  v.object({ kind: v.literal('calendarTv'), value: v.union(v.null(), calendarTv) }),
  v.object({ kind: v.literal('calendarSeason'), value: calendarSeason }),
  v.object({ kind: v.literal('truncated'), value: truncated }),
);

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

type SnapshotKind =
  | 'tmdbSearch'
  | 'tmdbMovie'
  | 'tmdbTv'
  | 'episodes'
  | 'tvdbGuide'
  | 'tvdbLookup'
  | 'calendarMovie'
  | 'calendarTv'
  | 'calendarSeason'
  | 'truncated';

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
  handler: async (ctx, { key }) => {
    const stored = await ctx.db
      .query('providerSnapshots')
      .withIndex('by_key', (query) => query.eq('key', key))
      .unique();
    return stored ? { ...stored, ...stored.entry } : null;
  },
});

export const put = internalMutation({
  args: { key: v.string(), entry: snapshotEntry },
  handler: async (ctx, { key, entry }) => {
    if (!key || key.length > 500) throw new Error('Invalid provider snapshot key');
    const existing = await ctx.db
      .query('providerSnapshots')
      .withIndex('by_key', (query) => query.eq('key', key))
      .unique();
    const next = { entry, refreshedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, next);
    else await ctx.db.insert('providerSnapshots', { key, ...next });
  },
});

/** Isolated, bounded continuation so snapshot cleanup cannot fail other pruning. */
export const prune = internalMutation({
  args: { cursor: v.optional(v.string()) },
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
