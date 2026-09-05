import { mutation, query, type MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { v } from 'convex/values';
import { EPISODES_PER_CHUNK, MAX_SEASON_EPISODES } from '../seasonStorage';
import { seasonSummaryIdentityKey, updateSummaryForEpisodeUpsert } from '../episodeSummaries';
import { itemActivityBase, writeActivityEvents, type ActivityEventWrite } from '../activityEvents';
import { episodeValidator } from '../publicValidators';
import { refreshNextEpisode } from '../nextEpisode';
import {
  boundedOptional,
  episodeMatchesStamp,
  episodeMetadataStamp,
  type EpisodeMetadataStamp,
  normalizeTags,
  ownedItem,
  rating,
  requireRating,
  requireRuntime,
  requireUser,
} from './shared';

const episodeArgs = {
  itemId: v.id('items'),
  season: v.number(),
  episode: v.number(),
  watched: v.optional(v.boolean()),
  rating,
  clearRating: v.optional(v.boolean()),
  tags: v.optional(v.array(v.string())),
  seasonName: v.optional(v.string()),
  name: v.optional(v.string()),
  overview: v.optional(v.string()),
  runtime: v.optional(v.number()),
  imageUrl: v.optional(v.string()),
  airDate: v.optional(v.string()),
};
export async function setEpisode(
  ctx: MutationCtx,
  userId: Id<'users'>,
  args: {
    itemId: Id<'items'>;
    season: number;
    episode: number;
    watched?: boolean;
    rating?: number;
    clearRating?: boolean;
    tags?: string[];
    seasonName?: string;
    name?: string;
    overview?: string;
    runtime?: number;
    imageUrl?: string;
    airDate?: string;
    stamp?: EpisodeMetadataStamp;
  },
  knownItem?: Doc<'items'>,
  knownExisting?: Doc<'episodes'> | null,
  activityEvents?: ActivityEventWrite[],
  refreshCoordinate = true,
) {
  if (!Number.isInteger(args.season) || args.season < 0 || args.season > 10_000)
    throw new Error('Season must be an integer between 0 and 10000');
  if (!Number.isInteger(args.episode) || args.episode < 0 || args.episode > 10_000)
    throw new Error('Episode must be an integer between 0 and 10000');
  const item = knownItem ?? (await ownedItem(ctx, args.itemId, userId));
  requireRating(args.rating);
  requireRuntime(args.runtime);
  boundedOptional('Season name', args.seasonName, 300);
  boundedOptional('Episode name', args.name, 300);
  boundedOptional('Episode overview', args.overview, 400);
  boundedOptional('Episode image URL', args.imageUrl, 500);
  boundedOptional('Episode air date', args.airDate, 50);
  const tags = args.tags === undefined ? undefined : normalizeTags(args.tags);
  const existing =
    knownExisting === undefined
      ? await ctx.db
          .query('episodes')
          .withIndex('by_item', (q) =>
            q.eq('itemId', args.itemId).eq('season', args.season).eq('episode', args.episode),
          )
          .unique()
      : knownExisting;
  const watched = args.watched ?? existing?.watched ?? false;
  const nextRating = args.clearRating
    ? undefined
    : args.rating !== undefined
      ? args.rating
      : existing?.rating;
  const stamp = args.stamp ?? (await episodeMetadataStamp(ctx, item, args.season, args.episode));
  const materializeDisplay = watched || nextRating !== undefined;
  const display = {
    seasonName: stamp.seasonName ?? args.seasonName,
    name: stamp.name ?? args.name,
    overview: stamp.overview ?? args.overview,
    runtime: stamp.runtime ?? args.runtime,
    imageUrl: stamp.imageUrl ?? args.imageUrl,
    airDate: stamp.airDate ?? args.airDate,
  };
  const values = {
    watched,
    ...(args.clearRating
      ? { rating: undefined }
      : args.rating !== undefined && { rating: args.rating }),
    ...(tags !== undefined && { tags }),
    ...(materializeDisplay &&
      display.seasonName !== undefined && {
        seasonName: display.seasonName,
      }),
    ...(materializeDisplay && display.name !== undefined && { name: display.name }),
    ...(materializeDisplay && display.overview !== undefined && { overview: display.overview }),
    ...(materializeDisplay && display.runtime !== undefined && { runtime: display.runtime }),
    ...(materializeDisplay && display.imageUrl !== undefined && { imageUrl: display.imageUrl }),
    ...(materializeDisplay && display.airDate !== undefined && { airDate: display.airDate }),
    ...(watched && !existing?.watched && { watchedAt: Date.now() }),
    ...(!watched && existing?.watched && { watchedAt: undefined }),
    metadataProvider: stamp.metadataProvider,
    seasonOrder: stamp.seasonOrder,
    providerEpisodeId: stamp.providerEpisodeId,
  };
  await updateSummaryForEpisodeUpsert(
    ctx,
    userId,
    args.itemId,
    args.season,
    watched,
    existing,
    stamp.summaryIdentityKey
      ? {
          key: stamp.summaryIdentityKey,
          seasonVersion: stamp.summarySeasonVersion!,
          total: stamp.summaryTotal!,
          existingMatches: episodeMatchesStamp(existing, stamp),
          nextMatches: true,
        }
      : undefined,
    {
      runtime: display.runtime ?? existing?.runtime,
      unverified: existing?.unverified,
      tags: tags ?? existing?.tags ?? [],
    },
  );
  const semanticEvents: ActivityEventWrite[] = [];
  if (!existing?.watched && watched)
    semanticEvents.push({
      ...itemActivityBase(item),
      kind: 'episode',
      season: args.season,
      episode: args.episode,
    });
  if (nextRating !== existing?.rating)
    semanticEvents.push({
      ...itemActivityBase(item),
      kind: 'rating',
      season: args.season,
      episode: args.episode,
      ...(nextRating !== undefined && { rating: nextRating }),
    });
  if (activityEvents) activityEvents.push(...semanticEvents);
  else await writeActivityEvents(ctx, semanticEvents);
  let episodeId: Id<'episodes'>;
  if (existing) {
    await ctx.db.patch(existing._id, values);
    episodeId = existing._id;
  } else {
    episodeId = await ctx.db.insert('episodes', {
      userId,
      itemId: args.itemId,
      season: args.season,
      episode: args.episode,
      tags: tags ?? [],
      ...values,
    });
  }
  if (refreshCoordinate)
    await refreshNextEpisode(
      ctx,
      item._id,
      watched ? { season: args.season, episode: args.episode } : undefined,
    );
  return episodeId;
}
export const setEpisodeState = mutation({
  args: episodeArgs,
  returns: v.id('episodes'),
  handler: async (ctx, args) => setEpisode(ctx, await requireUser(ctx), args),
});

const matchesCurrentEpisodeIdentity = (
  episode: Doc<'episodes'>,
  provider: 'tmdb' | 'tvdb' | undefined,
  mapping: Doc<'titleMappings'> | null,
  canonicalIdentityKnown: boolean,
  canonicalCoordinateExists: boolean,
  canonicalProviderEpisodeId?: number,
) => {
  if (canonicalIdentityKnown && !canonicalCoordinateExists) return false;
  if (provider === undefined || episode.metadataProvider !== provider) return false;
  const currentOrder = provider === 'tvdb' ? mapping?.seasonOrder : undefined;
  if (episode.seasonOrder !== currentOrder) return false;
  return !canonicalIdentityKnown || episode.providerEpisodeId === canonicalProviderEpisodeId;
};

export const listEpisodes = query({
  args: { itemId: v.id('items'), season: v.number(), pageCount: v.optional(v.number()) },
  returns: v.array(episodeValidator),
  handler: async (ctx, { itemId, season, pageCount = 1 }) => {
    const userId = await requireUser(ctx);
    const item = await ownedItem(ctx, itemId, userId);
    if (!Number.isInteger(season) || season < 0 || season > 10_000)
      throw new Error('Season must be an integer between 0 and 10000');
    const maximumPages = MAX_SEASON_EPISODES / EPISODES_PER_CHUNK;
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > maximumPages)
      throw new Error(`Episode state pages must be between 1 and ${maximumPages}`);
    const [mapping, title, resolvedSeason] = await Promise.all([
      ctx.db
        .query('titleMappings')
        .withIndex('by_tmdb', (query) =>
          query.eq('mediaType', item.mediaType).eq('tmdbId', item.tmdbId),
        )
        .unique(),
      ctx.db
        .query('resolvedTitles')
        .withIndex('by_tmdb', (query) =>
          query.eq('mediaType', item.mediaType).eq('tmdbId', item.tmdbId),
        )
        .unique(),
      ctx.db
        .query('resolvedSeasons')
        .withIndex('by_tmdb_season', (query) =>
          query.eq('tmdbId', item.tmdbId).eq('season', season),
        )
        .unique(),
    ]);
    const activeSeason =
      resolvedSeason &&
      (resolvedSeason.metadataProvider === 'tmdb' ||
        (mapping !== null && resolvedSeason.orderEpoch === mapping.orderEpoch))
        ? resolvedSeason
        : null;
    const canonicalIdentityKnown =
      !!activeSeason &&
      activeSeason.chunkCount !== undefined &&
      activeSeason.seasonVersion !== undefined &&
      activeSeason.chunksComplete === true;
    const activeTitle =
      title && (mapping?.orderEpoch === undefined || title.orderEpoch === mapping.orderEpoch)
        ? title
        : null;
    const provider = activeSeason?.metadataProvider ?? activeTitle?.metadataProvider ?? 'tmdb';
    const canonicalEpisodes = !canonicalIdentityKnown
      ? []
      : (
          await ctx.db
            .query('resolvedSeasonChunks')
            .withIndex('by_tmdb_season_version_chunk', (query) =>
              query
                .eq('tmdbId', item.tmdbId)
                .eq('season', season)
                .eq('seasonVersion', activeSeason.seasonVersion!),
            )
            .take(pageCount)
        ).flatMap((chunk) => chunk.episodes);
    const canonicalIds = new Map(
      canonicalEpisodes.map((episode) => [episode.episode, episode.providerEpisodeId]),
    );
    const episodeLimit = pageCount * EPISODES_PER_CHUNK;
    const episodeCandidates = await ctx.db
      .query('episodes')
      .withIndex('by_item_identity', (query) =>
        query
          .eq('itemId', itemId)
          .eq('season', season)
          .eq('metadataProvider', provider)
          .eq('seasonOrder', provider === 'tvdb' ? mapping?.seasonOrder : undefined),
      )
      // A canonical season is capped at 600 rows. Provider-id validation below
      // preserves history while keeping stale identities from escaping this bound.
      .take(MAX_SEASON_EPISODES);
    return episodeCandidates
      .filter((episode) =>
        matchesCurrentEpisodeIdentity(
          episode,
          provider,
          mapping,
          canonicalIdentityKnown,
          !canonicalIdentityKnown || canonicalIds.has(episode.episode),
          canonicalIds.get(episode.episode),
        ),
      )
      .slice(0, episodeLimit);
  },
});

/** Compact whole-item progress; full episode documents stay season/page scoped. */
export const listEpisodeProgress = query({
  args: { itemId: v.id('items') },
  returns: v.array(
    v.object({
      season: v.number(),
      watchedCount: v.number(),
      total: v.number(),
      currentWatchedCount: v.number(),
      currentTotal: v.number(),
      identityStale: v.boolean(),
    }),
  ),
  handler: async (ctx, { itemId }) => {
    const userId = await requireUser(ctx);
    const item = await ownedItem(ctx, itemId, userId);
    const [summaries, mapping, seasons] = await Promise.all([
      ctx.db
        .query('episodeSummaries')
        .withIndex('by_item', (query) => query.eq('itemId', itemId))
        // Public season coordinates are restricted to 0..10,000.
        .take(10_001),
      ctx.db
        .query('titleMappings')
        .withIndex('by_tmdb', (query) =>
          query.eq('mediaType', item.mediaType).eq('tmdbId', item.tmdbId),
        )
        .unique(),
      ctx.db
        .query('resolvedSeasons')
        .withIndex('by_tmdb_season', (query) => query.eq('tmdbId', item.tmdbId))
        .take(10_001),
    ]);
    const seasonByNumber = new Map(seasons.map((season) => [season.season, season]));
    return summaries.map((summary) => {
      const resolved = seasonByNumber.get(summary.season);
      const active =
        resolved &&
        (resolved.metadataProvider === 'tmdb' ||
          (mapping !== null && resolved.orderEpoch === mapping.orderEpoch)) &&
        resolved.chunkCount !== undefined &&
        resolved.seasonVersion !== undefined &&
        resolved.chunksComplete === true
          ? resolved
          : undefined;
      const currentIdentityKey = active
        ? seasonSummaryIdentityKey(active, mapping?.seasonOrder)
        : undefined;
      const identityStale =
        currentIdentityKey === undefined || summary.currentIdentityKey !== currentIdentityKey;
      return {
        season: summary.season,
        watchedCount: summary.watchedCount,
        total: summary.total,
        currentWatchedCount: identityStale ? 0 : (summary.currentWatchedCount ?? 0),
        currentTotal: identityStale ? 0 : (summary.currentTotal ?? 0),
        identityStale,
      };
    });
  },
});
/** Derives the batch from the server's epoch-checked canonical season. */
