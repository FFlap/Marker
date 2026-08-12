import type { Doc } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internalQuery } from './_generated/server';
import { v } from 'convex/values';

export const EPISODES_PER_CHUNK = 120;
const MAX_SEASON_CHUNKS = 50;
export const MAX_SEASON_EPISODES = EPISODES_PER_CHUNK * MAX_SEASON_CHUNKS;
/**
 * Provider-controlled episode strings are bounded before storage or transport.
 * With 120 episodes per chunk these limits keep every metadata mutation far
 * below Convex's 16 MiB argument/return ceiling, even at the 6,000 episode cap.
 */
export const EPISODE_FIELD_LIMITS = {
  name: 300,
  overview: 400,
  imageUrl: 500,
  airDate: 50,
} as const;
export const MAX_METADATA_MUTATION_BYTES = 1024 * 1024;

export type ResolvedEpisode = Doc<'resolvedSeasonChunks'>['episodes'][number];
export type AssembledSeason = Doc<'resolvedSeasons'> & {
  episodes: ResolvedEpisode[];
};
export type PrechunkedSeason = {
  tmdbId: number;
  season: number;
  metadataProvider: 'tmdb' | 'tvdb';
  chunks: ResolvedEpisode[][];
  episodeCount: number;
  chunkCount: number;
  refreshedAt: number;
  refreshAfter: number;
  orderEpoch: number;
};

const truncate = (value: string | undefined, maximum: number) =>
  value === undefined ? undefined : value.slice(0, maximum);

/** Keeps provider-controlled strings small before they enter an atomic season commit. */
export const boundedEpisode = (episode: ResolvedEpisode): ResolvedEpisode => ({
  season: episode.season,
  episode: episode.episode,
  name: episode.name.slice(0, EPISODE_FIELD_LIMITS.name),
  ...(episode.overview !== undefined && {
    overview: truncate(episode.overview, EPISODE_FIELD_LIMITS.overview),
  }),
  ...(episode.runtime !== undefined && { runtime: episode.runtime }),
  ...(episode.imageUrl !== undefined && {
    imageUrl: truncate(episode.imageUrl, EPISODE_FIELD_LIMITS.imageUrl),
  }),
  ...(episode.airDate !== undefined && {
    airDate: truncate(episode.airDate, EPISODE_FIELD_LIMITS.airDate),
  }),
  ...(episode.providerEpisodeId !== undefined && {
    providerEpisodeId: episode.providerEpisodeId,
  }),
});

export const serializedBytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value) ?? 'null').byteLength;

export function assertMetadataMutationSize(value: unknown, label: string) {
  const bytes = serializedBytes(value);
  if (bytes > MAX_METADATA_MUTATION_BYTES)
    throw new Error(
      `${label} is ${bytes} serialized bytes; limit is ${MAX_METADATA_MUTATION_BYTES}`,
    );
  return bytes;
}

export const episodeChunks = (episodes: ResolvedEpisode[]) => {
  const bounded = episodes.map(boundedEpisode).sort((left, right) => left.episode - right.episode);
  const chunks: ResolvedEpisode[][] = [];
  for (let start = 0; start < bounded.length; start += EPISODES_PER_CHUNK)
    chunks.push(bounded.slice(start, start + EPISODES_PER_CHUNK));
  if (chunks.length > MAX_SEASON_CHUNKS)
    throw new Error(`A resolved season is limited to ${MAX_SEASON_EPISODES} episodes`);
  return chunks;
};

const validatePrechunkedSeason = (value: PrechunkedSeason) => {
  if (value.chunkCount < 0 || value.chunkCount > MAX_SEASON_CHUNKS)
    throw new Error(`A resolved season is limited to ${MAX_SEASON_EPISODES} episodes`);
  if (value.episodeCount < 0 || value.episodeCount > MAX_SEASON_EPISODES)
    throw new Error(`A resolved season is limited to ${MAX_SEASON_EPISODES} episodes`);
  if (value.chunks.length > value.chunkCount)
    throw new Error('A season commit contains more chunks than its declared chunk count');
  if (value.chunks.some((chunk) => chunk.length > EPISODES_PER_CHUNK))
    throw new Error(`A season chunk is limited to ${EPISODES_PER_CHUNK} episodes`);
};

async function chunksForVersion(
  ctx: Pick<QueryCtx | MutationCtx, 'db'>,
  args: {
    tmdbId: number;
    season: number;
    seasonVersion: string;
    limit: number;
  },
) {
  return ctx.db
    .query('resolvedSeasonChunks')
    .withIndex('by_tmdb_season_version_chunk', (query) =>
      query
        .eq('tmdbId', args.tmdbId)
        .eq('season', args.season)
        .eq('seasonVersion', args.seasonVersion),
    )
    .take(args.limit);
}

/** Starts a write under an invisible version without disturbing the visible parent version. */
export async function beginPrechunkedSeasonWrite(
  ctx: Pick<MutationCtx, 'db'>,
  value: PrechunkedSeason,
  attemptToken: string,
) {
  validatePrechunkedSeason(value);
  if (value.chunks.length > 1) throw new Error('The atomic core accepts at most one season chunk');
  const existingParent = await ctx.db
    .query('resolvedSeasons')
    .withIndex('by_tmdb_season', (query) =>
      query.eq('tmdbId', value.tmdbId).eq('season', value.season),
    )
    .unique();
  if (existingParent?.stagingVersion !== undefined) {
    const abandoned = await chunksForVersion(ctx, {
      tmdbId: value.tmdbId,
      season: value.season,
      seasonVersion: existingParent.stagingVersion,
      limit: MAX_SEASON_CHUNKS + 1,
    });
    if (abandoned.length > MAX_SEASON_CHUNKS)
      throw new Error('Resolved season has too many abandoned staging chunks');
    for (const chunk of abandoned) await ctx.db.delete(chunk._id);
  }
  for (const [chunkIndex, episodes] of value.chunks.entries())
    await ctx.db.insert('resolvedSeasonChunks', {
      tmdbId: value.tmdbId,
      season: value.season,
      orderEpoch: value.orderEpoch,
      seasonVersion: attemptToken,
      chunkIndex,
      refreshedAt: value.refreshedAt,
      episodes,
    });
  const staging = {
    writeAttemptToken: attemptToken,
    nextChunkIndex: value.chunks.length,
    stagingVersion: attemptToken,
    stagingMetadataProvider: value.metadataProvider,
    stagingEpisodeCount: value.episodeCount,
    stagingChunkCount: value.chunkCount,
    stagingRefreshedAt: value.refreshedAt,
    stagingRefreshAfter: value.refreshAfter,
    stagingOrderEpoch: value.orderEpoch,
  };
  if (existingParent) await ctx.db.patch(existingParent._id, staging);
  else
    await ctx.db.insert('resolvedSeasons', {
      tmdbId: value.tmdbId,
      season: value.season,
      metadataProvider: value.metadataProvider,
      chunksComplete: false,
      refreshedAt: value.refreshedAt,
      refreshAfter: value.refreshAfter,
      orderEpoch: value.orderEpoch,
      ...staging,
    });
}

/** Appends one bounded chunk to the invisible staging version. */
export async function appendPrechunkedSeasonChunk(
  ctx: Pick<MutationCtx, 'db'>,
  args: {
    tmdbId: number;
    season: number;
    orderEpoch: number;
    chunkIndex: number;
    episodes: ResolvedEpisode[];
    attemptToken: string;
  },
) {
  if (args.episodes.length > EPISODES_PER_CHUNK)
    throw new Error(`A season chunk is limited to ${EPISODES_PER_CHUNK} episodes`);
  const parent = await ctx.db
    .query('resolvedSeasons')
    .withIndex('by_tmdb_season', (query) =>
      query.eq('tmdbId', args.tmdbId).eq('season', args.season),
    )
    .unique();
  if (
    !parent ||
    parent.writeAttemptToken !== args.attemptToken ||
    parent.stagingVersion !== args.attemptToken ||
    parent.stagingOrderEpoch !== args.orderEpoch ||
    parent.nextChunkIndex !== args.chunkIndex ||
    parent.stagingChunkCount === undefined ||
    parent.stagingRefreshedAt === undefined ||
    args.chunkIndex >= parent.stagingChunkCount
  )
    return false;
  const existing = await ctx.db
    .query('resolvedSeasonChunks')
    .withIndex('by_tmdb_season_version_chunk', (query) =>
      query
        .eq('tmdbId', args.tmdbId)
        .eq('season', args.season)
        .eq('seasonVersion', args.attemptToken)
        .eq('chunkIndex', args.chunkIndex),
    )
    .unique();
  if (existing) return false;
  await ctx.db.insert('resolvedSeasonChunks', {
    tmdbId: args.tmdbId,
    season: args.season,
    orderEpoch: args.orderEpoch,
    seasonVersion: args.attemptToken,
    chunkIndex: args.chunkIndex,
    refreshedAt: parent.stagingRefreshedAt,
    episodes: args.episodes,
  });
  const nextChunkIndex = args.chunkIndex + 1;
  await ctx.db.patch(parent._id, { nextChunkIndex });
  return true;
}

/** Atomically publishes a complete staged version and removes the previous visible chunks. */
export async function finalizePrechunkedSeasonWrite(
  ctx: Pick<MutationCtx, 'db'>,
  args: { tmdbId: number; season: number; attemptToken: string },
) {
  const parent = await ctx.db
    .query('resolvedSeasons')
    .withIndex('by_tmdb_season', (query) =>
      query.eq('tmdbId', args.tmdbId).eq('season', args.season),
    )
    .unique();
  if (
    !parent ||
    parent.writeAttemptToken !== args.attemptToken ||
    parent.stagingVersion !== args.attemptToken ||
    parent.stagingMetadataProvider === undefined ||
    parent.stagingEpisodeCount === undefined ||
    parent.stagingChunkCount === undefined ||
    parent.stagingRefreshedAt === undefined ||
    parent.stagingOrderEpoch === undefined ||
    parent.nextChunkIndex !== parent.stagingChunkCount
  )
    return false;
  const staged = await chunksForVersion(ctx, {
    tmdbId: args.tmdbId,
    season: args.season,
    seasonVersion: args.attemptToken,
    limit: parent.stagingChunkCount + 1,
  });
  if (staged.length !== parent.stagingChunkCount) return false;
  staged.sort((left, right) => left.chunkIndex - right.chunkIndex);
  if (staged.some((chunk, index) => chunk.chunkIndex !== index)) return false;
  if (
    staged.reduce((total, chunk) => total + chunk.episodes.length, 0) !== parent.stagingEpisodeCount
  )
    return false;

  let oldChunks: Awaited<ReturnType<typeof chunksForVersion>> = [];
  if (
    parent.chunkCount !== undefined &&
    parent.orderEpoch !== undefined &&
    parent.seasonVersion !== undefined
  ) {
    oldChunks = await chunksForVersion(ctx, {
      tmdbId: args.tmdbId,
      season: args.season,
      seasonVersion: parent.seasonVersion,
      limit: MAX_SEASON_CHUNKS + 1,
    });
    if (oldChunks.length > MAX_SEASON_CHUNKS)
      throw new Error('Resolved season has too many visible chunks to replace atomically');
  }
  for (const chunk of oldChunks) await ctx.db.delete(chunk._id);
  await ctx.db.patch(parent._id, {
    metadataProvider: parent.stagingMetadataProvider,
    episodeCount: parent.stagingEpisodeCount,
    chunkCount: parent.stagingChunkCount,
    chunksComplete: true,
    seasonVersion: parent.stagingVersion,
    refreshedAt: parent.stagingRefreshedAt,
    refreshAfter: parent.stagingRefreshAfter,
    orderEpoch: parent.stagingOrderEpoch,
    writeAttemptToken: undefined,
    nextChunkIndex: undefined,
    stagingVersion: undefined,
    stagingMetadataProvider: undefined,
    stagingEpisodeCount: undefined,
    stagingChunkCount: undefined,
    stagingRefreshedAt: undefined,
    stagingRefreshAfter: undefined,
    stagingOrderEpoch: undefined,
    stagingTitle: undefined,
    stagingTitleWrite: undefined,
    stagingMapping: undefined,
    stagingExpectedMapping: undefined,
  });
  return true;
}

export async function readAssembledSeason(
  ctx: Pick<QueryCtx | MutationCtx, 'db'>,
  tmdbId: number,
  season: number,
): Promise<AssembledSeason | null> {
  const parent = await ctx.db
    .query('resolvedSeasons')
    .withIndex('by_tmdb_season', (query) => query.eq('tmdbId', tmdbId).eq('season', season))
    .unique();
  if (!parent) return null;
  if (parent.chunksComplete === false) return null;
  if (
    parent.chunkCount === undefined ||
    parent.orderEpoch === undefined ||
    parent.seasonVersion === undefined
  )
    return null;
  if (parent.chunkCount > MAX_SEASON_CHUNKS) throw new Error('Resolved season has too many chunks');
  const chunks = await chunksForVersion(ctx, {
    tmdbId,
    season,
    seasonVersion: parent.seasonVersion,
    limit: parent.chunkCount + 1,
  });
  if (chunks.length !== parent.chunkCount) return null;
  chunks.sort((left, right) => left.chunkIndex - right.chunkIndex);
  if (chunks.some((chunk, index) => chunk.chunkIndex !== index)) return null;
  const episodes = chunks.flatMap((chunk) => chunk.episodes);
  if (episodes.length !== parent.episodeCount) return null;
  return { ...parent, episodes };
}

export async function writeChunkedSeason(
  ctx: Pick<MutationCtx, 'db'>,
  value: {
    tmdbId: number;
    season: number;
    metadataProvider: 'tmdb' | 'tvdb';
    episodes: ResolvedEpisode[];
    refreshedAt: number;
    refreshAfter: number;
    orderEpoch: number;
  },
) {
  const chunks = episodeChunks(value.episodes);
  const seasonVersion = `direct:${value.orderEpoch}:${value.refreshedAt}`;
  const existingParent = await ctx.db
    .query('resolvedSeasons')
    .withIndex('by_tmdb_season', (query) =>
      query.eq('tmdbId', value.tmdbId).eq('season', value.season),
    )
    .unique();
  const oldChunks = await ctx.db
    .query('resolvedSeasonChunks')
    .withIndex('by_tmdb_season_epoch_chunk', (query) =>
      query.eq('tmdbId', value.tmdbId).eq('season', value.season),
    )
    .take(MAX_SEASON_CHUNKS * 3 + 1);
  if (oldChunks.length > MAX_SEASON_CHUNKS * 3)
    throw new Error('Resolved season has too many old chunks to replace atomically');
  for (const chunk of oldChunks) await ctx.db.delete(chunk._id);
  for (const [chunkIndex, episodes] of chunks.entries())
    await ctx.db.insert('resolvedSeasonChunks', {
      tmdbId: value.tmdbId,
      season: value.season,
      orderEpoch: value.orderEpoch,
      seasonVersion,
      chunkIndex,
      refreshedAt: value.refreshedAt,
      episodes,
    });
  const { episodes: _episodes, ...summary } = value;
  const parent = {
    ...summary,
    episodeCount: value.episodes.length,
    chunkCount: chunks.length,
    chunksComplete: true,
    seasonVersion,
    writeAttemptToken: undefined,
    nextChunkIndex: undefined,
    stagingVersion: undefined,
    stagingMetadataProvider: undefined,
    stagingEpisodeCount: undefined,
    stagingChunkCount: undefined,
    stagingRefreshedAt: undefined,
    stagingRefreshAfter: undefined,
    stagingOrderEpoch: undefined,
    stagingTitle: undefined,
    stagingTitleWrite: undefined,
    stagingMapping: undefined,
    stagingExpectedMapping: undefined,
  };
  if (existingParent) await ctx.db.patch(existingParent._id, parent);
  else await ctx.db.insert('resolvedSeasons', parent);
  return { episodeCount: value.episodes.length, chunkCount: chunks.length };
}

export const readCanonicalSeason = internalQuery({
  args: { tmdbId: v.number(), season: v.number() },
  handler: async (ctx, args) => {
    const [season, mapping] = await Promise.all([
      readAssembledSeason(ctx, args.tmdbId, args.season),
      ctx.db
        .query('titleMappings')
        .withIndex('by_tmdb', (query) => query.eq('mediaType', 'tv').eq('tmdbId', args.tmdbId))
        .unique(),
    ]);
    return season && mapping && season.orderEpoch === mapping.orderEpoch ? season : null;
  },
});

export const readCanonicalSeasonByTvdb = internalQuery({
  args: { tvdbId: v.number(), order: v.string(), season: v.number() },
  handler: async (ctx, args) => {
    const mappings = await ctx.db
      .query('titleMappings')
      .withIndex('by_tvdb', (query) => query.eq('tvdbId', args.tvdbId))
      .take(20);
    const mapping = mappings.find((entry) => entry.seasonOrder === args.order);
    if (!mapping) return null;
    const season = await readAssembledSeason(ctx, mapping.tmdbId, args.season);
    return season?.orderEpoch === mapping.orderEpoch ? season : null;
  },
});
