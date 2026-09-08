import type { TestConvex } from 'convex-test';
import schema from '../../convex/schema';
import { internal } from '../../convex/_generated/api';
import type { Doc } from '../../convex/_generated/dataModel';
import {
  episodeChunks,
  MAX_SEASON_EPISODES,
  EPISODES_PER_CHUNK,
  type ResolvedEpisode,
} from '../../convex/seasonStorage';
import type { MutationCtx } from '../../convex/_generated/server';
import type { ResolvedTitle } from '../../convex/resolvedMetadata/shared';

type Backend = TestConvex<typeof schema>;

export const putTitle = (t: Backend, { value }: { value: ResolvedTitle }) =>
  t.run(async (ctx) => {
    const next = value;
    const existing = await ctx.db
      .query('resolvedTitles')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', next.mediaType).eq('tmdbId', next.tmdbId))
      .unique();
    if (existing) await ctx.db.replace(existing._id, next);
    else await ctx.db.insert('resolvedTitles', next);
    await ctx.scheduler.runAfter(0, internal.resolvedMetadata.publication.refreshItemProjections, {
      mediaType: next.mediaType,
      tmdbId: next.tmdbId,
    });
  });

export const putSeason = (t: Backend, args: Parameters<typeof writeChunkedSeason>[1]) =>
  t.run(async (ctx) => {
    await writeChunkedSeason(ctx, args);
    const mapping = await ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (query) => query.eq('mediaType', 'tv').eq('tmdbId', args.tmdbId))
      .unique();
    if (!mapping)
      await ctx.db.insert('titleMappings', {
        tmdbId: args.tmdbId,
        mediaType: 'tv',
        source: 'auto',
        orderEpoch: args.orderEpoch,
        updatedAt: args.refreshedAt,
      });
    else if (mapping.orderEpoch === args.orderEpoch)
      await ctx.db.patch(mapping._id, { updatedAt: args.refreshedAt });
    await ctx.scheduler.runAfter(0, internal.episodeSummaries.reconcileSeasonSummaries, {
      tmdbId: args.tmdbId,
      season: args.season,
    });
  });

export const setTitleMapping = (
  t: Backend,
  args: Pick<Doc<'titleMappings'>, 'mediaType' | 'tmdbId' | 'tvdbId' | 'seasonOrder' | 'source'>,
) =>
  t.run(async (ctx) => {
    const existing = await ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', args.mediaType).eq('tmdbId', args.tmdbId))
      .unique();
    if (existing?.source === 'manual' && args.source === 'auto') return existing;
    const changed =
      !existing || existing.tvdbId !== args.tvdbId || existing.seasonOrder !== args.seasonOrder;
    const value = {
      ...args,
      orderEpoch: existing ? existing.orderEpoch + (changed ? 1 : 0) : 0,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.replace(existing._id, value);
    else await ctx.db.insert('titleMappings', value);
    if (args.mediaType === 'tv')
      await ctx.scheduler.runAfter(0, internal.nextEpisode.refreshForTitle, {
        tmdbId: args.tmdbId,
      });
    return value;
  });

const MAX_SEASON_CHUNKS = MAX_SEASON_EPISODES / EPISODES_PER_CHUNK;

async function writeChunkedSeason(
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
