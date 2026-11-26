import { mutation, query, type MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { v } from 'convex/values';
import { EPISODES_PER_CHUNK, MAX_SEASON_EPISODES } from '../seasonStorage';
import {
  seasonSummaryIdentityKey,
  updateSummaryForEpisodeUpsert,
  type EpisodeSummaryUpsert,
} from '../episodeSummaries';
import {
  itemActivityBase,
  retractRecentEpisodeEvent,
  writeActivityEvents,
  type ActivityEventWrite,
} from '../activityEvents';
import { episodeStateValidator } from '../publicValidators';
import { airsAfter } from '../episodeAvailability';
import { refreshNextEpisode } from '../nextEpisode';
import {
  currentSeriesOverride,
  effectiveEpisodeWatched,
  releasedByDeclaration,
} from './seriesWatchState';
import { recordWatchActivity, resolveActivityDate } from '../watchActivity';
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
  timesWatched: v.optional(v.number()),
  rating,
  clearRating: v.optional(v.boolean()),
  tags: v.optional(v.array(v.string())),
  seasonName: v.optional(v.string()),
  name: v.optional(v.string()),
  overview: v.optional(v.string()),
  runtime: v.optional(v.number()),
  imageUrl: v.optional(v.string()),
  airDate: v.optional(v.string()),
  activityDate: v.optional(v.string()),
};
export async function setEpisode(
  ctx: MutationCtx,
  userId: Id<'users'>,
  args: {
    itemId: Id<'items'>;
    season: number;
    episode: number;
    watched?: boolean;
    timesWatched?: number;
    rating?: number;
    clearRating?: boolean;
    tags?: string[];
    seasonName?: string;
    name?: string;
    overview?: string;
    runtime?: number;
    imageUrl?: string;
    airDate?: string;
    activityDate?: string;
    stamp?: EpisodeMetadataStamp;
  },
  batch?: {
    item: Doc<'items'>;
    existing: Doc<'episodes'> | null;
    activityEvents: ActivityEventWrite[];
    watchActivityDeltas: Map<string, number>;
    summaryUpdates?: EpisodeSummaryUpsert[];
    seriesGeneration?: string;
  },
) {
  if (!Number.isInteger(args.season) || args.season < 0 || args.season > 10_000)
    throw new Error('Season must be an integer between 0 and 10000');
  if (!Number.isInteger(args.episode) || args.episode < 0 || args.episode > 10_000)
    throw new Error('Episode must be an integer between 0 and 10000');
  const item = batch?.item ?? (await ownedItem(ctx, args.itemId, userId));
  requireRating(args.rating);
  requireRuntime(args.runtime);
  if (
    args.timesWatched !== undefined &&
    (!Number.isInteger(args.timesWatched) || args.timesWatched < 1 || args.timesWatched > 999)
  )
    throw new Error('timesWatched must be an integer between 1 and 999');
  boundedOptional('Season name', args.seasonName, 300);
  boundedOptional('Episode name', args.name, 300);
  boundedOptional('Episode overview', args.overview, 400);
  boundedOptional('Episode image URL', args.imageUrl, 500);
  boundedOptional('Episode air date', args.airDate, 50);
  const tags = args.tags === undefined ? undefined : normalizeTags(args.tags);
  const [existing, stamp] = await Promise.all([
    batch
      ? Promise.resolve(batch.existing)
      : ctx.db
          .query('episodes')
          .withIndex('by_item', (q) =>
            q.eq('itemId', args.itemId).eq('season', args.season).eq('episode', args.episode),
          )
          .unique(),
    args.stamp
      ? Promise.resolve(args.stamp)
      : episodeMetadataStamp(ctx, item, args.season, args.episode),
  ]);
  const nextRating = args.clearRating
    ? undefined
    : args.rating !== undefined
      ? args.rating
      : existing?.rating;
  const { activityDate } = args;
  const display = {
    seasonName: stamp.seasonName ?? args.seasonName,
    name: stamp.name ?? args.name,
    overview: stamp.overview ?? args.overview,
    runtime: stamp.runtime ?? args.runtime,
    imageUrl: stamp.imageUrl ?? args.imageUrl,
    airDate: stamp.airDate ?? args.airDate,
  };
  const canonical = {
    episode: args.episode,
    name: display.name ?? existing?.name,
    overview: display.overview ?? existing?.overview,
    imageUrl: display.imageUrl ?? existing?.imageUrl,
    airDate: display.airDate ?? existing?.airDate,
    providerEpisodeId: stamp.providerEpisodeId,
  };
  const beforeDeclared = item.seriesWatch
    ? effectiveEpisodeWatched(item.seriesWatch, existing, canonical, stamp)
    : (existing?.watched ?? false);
  const watched = args.watched ?? beforeDeclared;
  const explicitOverride =
    !!item.seriesWatch && !batch?.seriesGeneration && args.watched !== undefined;
  const nextOverride = explicitOverride
    ? item.seriesWatch!.generation
    : existing?.seriesWatchOverride;
  const declaredImplicit = item.seriesWatch && beforeDeclared && !existing?.watched;
  const watchDay = declaredImplicit ? item.seriesWatch!.activityDate : activityDate;
  const watchTime = declaredImplicit ? item.seriesWatch!.watchedAt : Date.now();
  const materializeDisplay = watched || nextRating !== undefined;
  const values = {
    watched,
    ...(watched && args.timesWatched !== undefined && { timesWatched: args.timesWatched }),
    ...(explicitOverride && { seriesWatchOverride: nextOverride }),
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
    ...(watched && !existing?.watched && { watchedAt: watchTime }),
    ...(watched && !existing?.watched && watchDay !== undefined && { activityDate: watchDay }),
    ...(!watched && existing?.watched && { watchedAt: undefined, activityDate: undefined }),
    metadataProvider: stamp.metadataProvider,
    seasonOrder: stamp.seasonOrder,
    providerEpisodeId: stamp.providerEpisodeId,
  };
  const summaryUpdate: EpisodeSummaryUpsert = {
    watched,
    series: item.seriesWatch
      ? {
          generation: item.seriesWatch.generation,
          beforeUnwatched:
            currentSeriesOverride(item.seriesWatch, existing, stamp) && !existing!.watched,
          afterUnwatched: nextOverride === item.seriesWatch.generation && !watched,
        }
      : undefined,
    existing,
    identity: stamp.summaryIdentityKey
      ? {
          key: stamp.summaryIdentityKey,
          seasonVersion: stamp.summarySeasonVersion!,
          total: stamp.summaryTotal!,
          existingMatches: episodeMatchesStamp(existing, stamp),
          nextMatches: true,
        }
      : undefined,
    next: {
      runtime: display.runtime ?? existing?.runtime,
      unverified: existing?.unverified,
      tags: tags ?? existing?.tags ?? [],
    },
  };
  if (batch?.summaryUpdates) batch.summaryUpdates.push(summaryUpdate);
  else
    await updateSummaryForEpisodeUpsert(
      ctx,
      userId,
      args.itemId,
      args.season,
      watched,
      existing,
      summaryUpdate.identity,
      summaryUpdate.next,
      summaryUpdate.series,
    );
  const semanticEvents: ActivityEventWrite[] = [];
  if (!existing?.watched && watched)
    semanticEvents.push({
      ...itemActivityBase(item),
      kind: 'episode',
      ...(declaredImplicit && { createdAt: item.seriesWatch!.watchedAt - 0.001 }),
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
  if (batch) batch.activityEvents.push(...semanticEvents);
  else await writeActivityEvents(ctx, semanticEvents);
  if (!batch && existing?.watched && !watched)
    await retractRecentEpisodeEvent(ctx, userId, {
      itemId: args.itemId,
      season: args.season,
      episode: args.episode,
    });
  if (watched !== (existing?.watched ?? false)) {
    const date = watched ? watchDay : existing?.activityDate;
    if (date !== undefined) {
      const delta = watched ? 1 : -1;
      if (batch)
        batch.watchActivityDeltas.set(date, (batch.watchActivityDeltas.get(date) ?? 0) + delta);
      else await recordWatchActivity(ctx, userId, date, delta);
    }
  }
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
  if (!batch)
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
  handler: async (ctx, { activityDate, ...args }) =>
    setEpisode(ctx, await requireUser(ctx), {
      ...args,
      activityDate: resolveActivityDate(activityDate),
    }),
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
  returns: v.array(episodeStateValidator),
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
      resolvedSeason && mapping !== null && resolvedSeason.orderEpoch === mapping.orderEpoch
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
    const episodeCandidates = item.seriesWatch
      ? await ctx.db
          .query('episodes')
          .withIndex('by_item', (q) => q.eq('itemId', itemId).eq('season', season))
          .take(MAX_SEASON_EPISODES)
      : await ctx.db
          .query('episodes')
          .withIndex('by_item_identity', (q) =>
            q
              .eq('itemId', itemId)
              .eq('season', season)
              .eq('metadataProvider', provider)
              .eq('seasonOrder', provider === 'tvdb' ? mapping?.seasonOrder : undefined),
          )
          .take(MAX_SEASON_EPISODES);
    if (item.seriesWatch && canonicalIdentityKnown) {
      const savedByNumber = new Map(episodeCandidates.map((episode) => [episode.episode, episode]));
      return canonicalEpisodes.slice(0, episodeLimit).map((episode) => {
        const { stillPath: _stillPath, ...displayEpisode } = episode;
        const saved = savedByNumber.get(episode.episode);
        const matches =
          saved &&
          matchesCurrentEpisodeIdentity(
            saved,
            provider,
            mapping,
            true,
            true,
            episode.providerEpisodeId,
          );
        const identity = {
          metadataProvider: provider,
          seasonOrder: provider === 'tvdb' ? mapping?.seasonOrder : undefined,
          providerEpisodeId: episode.providerEpisodeId,
        };
        const watched = effectiveEpisodeWatched(item.seriesWatch, saved, episode, identity);
        return {
          ...(matches ? saved : {}),
          userId,
          itemId,
          ...displayEpisode,
          metadataProvider: provider,
          seasonOrder: identity.seasonOrder,
          tags: matches ? saved.tags : [],
          watched,
          watchedAt: watched
            ? matches && saved.watched
              ? saved.watchedAt
              : item.seriesWatch!.watchedAt
            : undefined,
          activityDate: watched
            ? matches && saved.watched
              ? saved.activityDate
              : item.seriesWatch!.activityDate
            : undefined,
        };
      });
    }
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
      .slice(0, episodeLimit)
      .map((saved) => {
        if (!item.seriesWatch) return saved;
        const released = releasedByDeclaration(item.seriesWatch, saved);
        const watched = effectiveEpisodeWatched(
          released ? item.seriesWatch : undefined,
          saved,
          saved,
          saved,
        );
        return {
          ...saved,
          watched,
          watchedAt: watched
            ? saved.watched
              ? saved.watchedAt
              : item.seriesWatch.watchedAt
            : undefined,
          activityDate: watched
            ? saved.watched
              ? saved.activityDate
              : item.seriesWatch.activityDate
            : undefined,
        };
      });
  },
});

/**
 * The listed episodes of a season that haven't aired by the viewer's `today`, across the whole
 * season rather than the loaded page, so "Mark season watched" knows when the aired part is done.
 */
export const getSeasonUpcoming = query({
  args: { itemId: v.id('items'), season: v.number(), today: v.string() },
  returns: v.union(v.null(), v.object({ upcoming: v.number(), watchedUpcoming: v.number() })),
  handler: async (ctx, { itemId, season, today }) => {
    const userId = await requireUser(ctx);
    const item = await ownedItem(ctx, itemId, userId);
    if (item.mediaType !== 'tv') return null;
    const [mapping, parent] = await Promise.all([
      ctx.db
        .query('titleMappings')
        .withIndex('by_tmdb', (q) => q.eq('mediaType', 'tv').eq('tmdbId', item.tmdbId))
        .unique(),
      ctx.db
        .query('resolvedSeasons')
        .withIndex('by_tmdb_season', (q) => q.eq('tmdbId', item.tmdbId).eq('season', season))
        .unique(),
    ]);
    const seasonVersion = parent?.seasonVersion;
    if (
      !mapping ||
      !parent ||
      parent.orderEpoch !== mapping.orderEpoch ||
      parent.chunksComplete !== true ||
      seasonVersion === undefined
    )
      return null;
    // The catalog lists episodes released by the UTC day it was published, so these are the
    // ones already out in UTC but not yet on the viewer's day. Storage orders chunks by episode
    // number rather than date, so every chunk is read (a season has at most 50).
    const chunks = await ctx.db
      .query('resolvedSeasonChunks')
      .withIndex('by_tmdb_season_version_chunk', (q) =>
        q.eq('tmdbId', item.tmdbId).eq('season', season).eq('seasonVersion', seasonVersion),
      )
      .take(MAX_SEASON_EPISODES / EPISODES_PER_CHUNK);
    const upcoming = chunks.flatMap((chunk) =>
      chunk.episodes.filter((episode) => airsAfter(episode.airDate, today)),
    );
    const seasonOrder = parent.metadataProvider === 'tvdb' ? mapping.seasonOrder : undefined;
    const saved = await Promise.all(
      upcoming.map((episode) =>
        ctx.db
          .query('episodes')
          .withIndex('by_item', (q) =>
            q.eq('itemId', itemId).eq('season', season).eq('episode', episode.episode),
          )
          .unique(),
      ),
    );
    // Watched as the episode list shows it: a row saved under an older identity doesn't count.
    const watchedUpcoming = upcoming.filter((episode, index) =>
      effectiveEpisodeWatched(item.seriesWatch, saved[index], episode, {
        metadataProvider: parent.metadataProvider,
        seasonOrder,
        providerEpisodeId: episode.providerEpisodeId,
      }),
    ).length;
    return { upcoming: upcoming.length, watchedUpcoming };
  },
});

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
    const summaryBySeason = new Map(summaries.map((summary) => [summary.season, summary]));
    const coordinates = item.seriesWatch
      ? [
          ...new Set([
            ...summaries.map((summary) => summary.season),
            ...seasons.map((season) => season.season),
          ]),
        ].sort((a, b) => a - b)
      : summaries.map((summary) => summary.season);
    return coordinates.map((seasonNumber) => {
      const summary = summaryBySeason.get(seasonNumber);
      const resolved = seasonByNumber.get(seasonNumber);
      const active =
        resolved &&
        mapping !== null &&
        resolved.orderEpoch === mapping.orderEpoch &&
        resolved.chunkCount !== undefined &&
        resolved.seasonVersion !== undefined &&
        resolved.chunksComplete === true
          ? resolved
          : undefined;
      const currentIdentityKey = active
        ? seasonSummaryIdentityKey(active, mapping?.seasonOrder)
        : undefined;
      const identityStale =
        currentIdentityKey === undefined ||
        summary?.currentIdentityKey !== currentIdentityKey ||
        (!!item.seriesWatch && summary?.currentSeasonVersion !== active?.seasonVersion);
      // Canonical season publication filters episodes unreleased by that UTC day before setting
      // refreshedAt, and the declaration covers episodes out by the viewer's local day, so a
      // catalog published no later than that day contains only episodes covered by it.
      const declarationCoversAll =
        item.seriesWatch &&
        active &&
        new Date(active.refreshedAt).toISOString().slice(0, 10) <= item.seriesWatch.activityDate;
      const currentGeneration = summary?.seriesWatchGeneration === item.seriesWatch?.generation;
      const canInfer = declarationCoversAll && (!currentGeneration || !identityStale);
      const inferredCount = Math.max(
        0,
        (active?.episodeCount ?? 0) -
          (currentGeneration ? (summary?.seriesUnwatchedCount ?? 0) : 0),
      );
      return {
        season: seasonNumber,
        watchedCount: summary?.watchedCount ?? 0,
        total: summary?.total ?? 0,
        currentWatchedCount: canInfer
          ? inferredCount
          : identityStale
            ? 0
            : (summary?.currentWatchedCount ?? 0),
        currentTotal: canInfer
          ? (active?.episodeCount ?? 0)
          : identityStale
            ? 0
            : (summary?.currentTotal ?? 0),
        identityStale: canInfer ? false : identityStale,
      };
    });
  },
});
