import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type MutationCtx,
} from './_generated/server';
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import { rankAtEnd } from './rank';
import { readAssembledSeason } from './seasonStorage';
import type { Doc, Id } from './_generated/dataModel';
import { seasonSummaryIdentityKey, updateSummaryForEpisodeUpsert } from './episodeSummaries';
import { itemActivityBase, writeActivityEvents, type ActivityEventWrite } from './activityEvents';
import { refreshNextEpisode } from './nextEpisode';

const resolvedTvArgs = {
  userId: v.id('users'),
  tmdbId: v.number(),
  title: v.string(),
  posterPath: v.optional(v.string()),
  overview: v.optional(v.string()),
  releaseDate: v.optional(v.string()),
};
type ResolvedTvCandidate = {
  userId: Doc<'items'>['userId'];
  tmdbId: number;
  title: string;
  posterPath?: string;
  overview?: string;
  releaseDate?: string;
};

async function getOrCreateResolvedTv(ctx: MutationCtx, a: ResolvedTvCandidate) {
  const duplicate = await ctx.db
    .query('items')
    .withIndex('by_user_tmdb', (q) =>
      q.eq('userId', a.userId).eq('mediaType', 'tv').eq('tmdbId', a.tmdbId),
    )
    .filter((q) => q.eq(q.field('deletingAt'), undefined))
    .unique();
  if (duplicate) return duplicate;
  const now = Date.now();
  const id = await ctx.db.insert('items', {
    ...a,
    normalizedTitle: a.title.trim().toLocaleLowerCase(),
    mediaType: 'tv',
    isAnime: false,
    status: 'watching',
    timesWatched: 0,
    tags: [],
    rank: await rankAtEnd(ctx, a.userId, 'watching'),
    createdAt: now,
    updatedAt: now,
  });
  const item = (await ctx.db.get(id))!;
  await writeActivityEvents(ctx, [
    { ...itemActivityBase(item), kind: 'status', status: 'watching' },
  ]);
  await refreshNextEpisode(ctx, item);
  return item;
}

export const findTvByTitle = internalQuery({
  args: { userId: v.id('users'), title: v.string() },
  handler: async (ctx, a) => {
    const normalizedTitle = a.title.trim().toLocaleLowerCase();
    const matches = await ctx.db
      .query('items')
      .withIndex('by_user_normalized', (q) =>
        q.eq('userId', a.userId).eq('normalizedTitle', normalizedTitle),
      )
      .filter((q) => q.eq(q.field('deletingAt'), undefined))
      .take(20);
    return matches.find((item) => item.mediaType === 'tv') ?? null;
  },
});
const watchCommitArgs = {
  userId: v.id('users'),
  season: v.number(),
  episode: v.number(),
  name: v.optional(v.string()),
  runtime: v.optional(v.number()),
  unverified: v.optional(v.boolean()),
  matchedOrderEpoch: v.optional(v.number()),
  matchedProvider: v.optional(v.union(v.literal('tmdb'), v.literal('tvdb'))),
  matchedSeasonRefreshedAt: v.optional(v.number()),
};
type WatchCommit = {
  userId: Doc<'items'>['userId'];
  season: number;
  episode: number;
  name?: string;
  runtime?: number;
  unverified?: boolean;
  matchedOrderEpoch?: number;
  matchedProvider?: 'tmdb' | 'tvdb';
  matchedSeasonRefreshedAt?: number;
};

async function recordWatchForItem(ctx: MutationCtx, a: WatchCommit, item: Doc<'items'>) {
  const old = await ctx.db
    .query('episodes')
    .withIndex('by_item', (q) =>
      q.eq('itemId', item._id).eq('season', a.season).eq('episode', a.episode),
    )
    .unique();
  if (!old && a.unverified && a.season === 0) {
    const specials = await ctx.db
      .query('episodes')
      .withIndex('by_item', (q) => q.eq('itemId', item._id).eq('season', 0))
      .filter((q) => q.eq(q.field('unverified'), true))
      .take(50);
    if (specials.length >= 50) return false;
  }
  const [title, mapping, resolvedSeason] = await Promise.all([
    ctx.db
      .query('resolvedTitles')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', item.mediaType).eq('tmdbId', item.tmdbId))
      .unique(),
    ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', item.mediaType).eq('tmdbId', item.tmdbId))
      .unique(),
    readAssembledSeason(ctx, item.tmdbId, a.season),
  ]);
  const activeResolvedSeason =
    resolvedSeason &&
    ((resolvedSeason.metadataProvider === 'tmdb' && !mapping) ||
      (mapping !== null && resolvedSeason.orderEpoch === mapping.orderEpoch))
      ? resolvedSeason
      : undefined;
  const activeTitle =
    title && (mapping?.orderEpoch === undefined || title.orderEpoch === mapping.orderEpoch)
      ? title
      : undefined;
  const activeProvider =
    activeResolvedSeason?.metadataProvider ?? activeTitle?.metadataProvider ?? 'tmdb';
  if (
    (a.matchedOrderEpoch !== undefined || a.matchedProvider !== undefined) &&
    (!mapping || a.matchedOrderEpoch !== mapping.orderEpoch || a.matchedProvider !== activeProvider)
  )
    throw new ConvexError({ code: 'stale_epoch', retryable: true });
  if (
    a.matchedSeasonRefreshedAt !== undefined &&
    a.matchedSeasonRefreshedAt !== activeResolvedSeason?.refreshedAt
  )
    throw new ConvexError({ code: 'stale_season_version', retryable: true });
  const canonicalEpisode = activeResolvedSeason?.episodes.find(
    (episode) => episode.episode === a.episode,
  );
  const seasonOrder = mapping?.seasonOrder ?? activeTitle?.seasonOrder;
  const identityAvailable =
    canonicalEpisode !== undefined &&
    activeResolvedSeason !== undefined &&
    (activeResolvedSeason.metadataProvider === 'tmdb' || seasonOrder !== undefined);
  const stamp = identityAvailable
    ? {
        metadataProvider: activeResolvedSeason.metadataProvider,
        seasonOrder: activeResolvedSeason.metadataProvider === 'tvdb' ? seasonOrder : undefined,
        // A verified tuple replaces every field, including clearing a missing id.
        providerEpisodeId: canonicalEpisode.providerEpisodeId,
      }
    : {
        metadataProvider: activeProvider,
        seasonOrder: activeProvider === 'tvdb' ? seasonOrder : undefined,
        ...(old &&
          (old.metadataProvider !== activeProvider ||
            old.seasonOrder !== (activeProvider === 'tvdb' ? seasonOrder : undefined)) && {
            providerEpisodeId: undefined,
          }),
      };
  const seasonName = activeTitle?.seasons.find((entry) => entry.season === a.season)?.name;
  const display = {
    seasonName,
    name: canonicalEpisode?.name ?? (old && !old.unverified ? old.name : a.name),
    overview: canonicalEpisode?.overview,
    runtime: canonicalEpisode?.runtime ?? a.runtime,
    imageUrl: canonicalEpisode?.imageUrl,
    airDate: canonicalEpisode?.airDate,
  };
  await updateSummaryForEpisodeUpsert(
    ctx,
    a.userId,
    item._id,
    a.season,
    true,
    old,
    identityAvailable
      ? {
          key: seasonSummaryIdentityKey(activeResolvedSeason, seasonOrder),
          seasonVersion: activeResolvedSeason.seasonVersion!,
          total: activeResolvedSeason.episodeCount ?? activeResolvedSeason.episodes.length,
          existingMatches:
            !!old &&
            old.metadataProvider === stamp.metadataProvider &&
            old.seasonOrder === stamp.seasonOrder &&
            old.providerEpisodeId === stamp.providerEpisodeId,
          nextMatches: true,
        }
      : undefined,
    {
      runtime: display.runtime ?? old?.runtime,
      unverified: a.unverified,
      tags: old?.tags ?? [],
    },
  );
  if (old)
    await ctx.db.patch(old._id, {
      watched: true,
      ...(!old.watched && { watchedAt: Date.now() }),
      ...(display.seasonName !== undefined && { seasonName: display.seasonName }),
      ...(display.name !== undefined && { name: display.name }),
      ...(display.overview !== undefined && { overview: display.overview }),
      ...(display.runtime !== undefined && { runtime: display.runtime }),
      ...(display.imageUrl !== undefined && { imageUrl: display.imageUrl }),
      ...(display.airDate !== undefined && { airDate: display.airDate }),
      ...(a.unverified !== undefined
        ? { unverified: a.unverified }
        : old.unverified
          ? { unverified: undefined }
          : {}),
      ...stamp,
    });
  else
    await ctx.db.insert('episodes', {
      userId: a.userId,
      itemId: item._id,
      season: a.season,
      episode: a.episode,
      ...display,
      unverified: a.unverified,
      watched: true,
      tags: [],
      watchedAt: Date.now(),
      ...stamp,
    });
  const movingToWatching = item.status !== 'watched' && item.status !== 'watching';
  await ctx.db.patch(item._id, {
    ...(item.status !== 'watched' && { status: 'watching' }),
    ...(movingToWatching && { rank: await rankAtEnd(ctx, a.userId, 'watching') }),
    updatedAt: Date.now(),
  });
  const events: ActivityEventWrite[] = [];
  if (!old?.watched)
    events.push({
      ...itemActivityBase(item),
      kind: 'episode',
      season: a.season,
      episode: a.episode,
    });
  if (movingToWatching)
    events.push({ ...itemActivityBase(item), kind: 'status', status: 'watching' });
  await writeActivityEvents(ctx, events);
  await refreshNextEpisode(ctx, item._id, { season: a.season, episode: a.episode });
  return true;
}

export const recordWatchInternal = internalMutation({
  args: { ...watchCommitArgs, itemId: v.id('items') },
  handler: async (ctx, { itemId, ...a }) => {
    const item = await ctx.db.get(itemId);
    if (!item || item.userId !== a.userId || item.deletingAt !== undefined)
      throw new Error('Item not found');
    return recordWatchForItem(ctx, a, item);
  },
});

export const finalizeResolvedTvWatch = internalMutation({
  args: {
    candidate: v.object(resolvedTvArgs),
    watch: v.optional(v.object(watchCommitArgs)),
  },
  handler: async (ctx, { candidate, watch }) => {
    const item = await getOrCreateResolvedTv(ctx, candidate);
    if (!watch) return { itemId: item._id, recorded: false };
    if (watch.userId !== candidate.userId) throw new Error('Sync user mismatch');
    return { itemId: item._id, recorded: await recordWatchForItem(ctx, watch, item) };
  },
});

const watchArgs = {
  service: v.union(v.literal('crunchyroll'), v.literal('netflix')),
  seriesTitle: v.string(),
  seasonTitle: v.optional(v.string()),
  seasonNumber: v.optional(v.number()),
  episodeNumber: v.optional(v.number()),
  episodeTitle: v.optional(v.string()),
  url: v.optional(v.string()),
};
type WatchArgs = {
  service: 'crunchyroll' | 'netflix';
  seriesTitle: string;
  seasonTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
  url?: string;
};
type WatchResult =
  | { ok: false; reason: 'unmatched' | 'unmatched-episode' }
  | { ok: true; season: number; episode: number; unverified?: true };
type CanonicalEpisode = {
  season: number;
  episode: number;
  name: string;
  runtime?: number;
  providerEpisodeId?: number;
};
type CanonicalSeasonMatch = {
  episodes: CanonicalEpisode[];
  refreshedAt?: number;
  orderEpoch?: number;
  metadataProvider?: 'tmdb' | 'tvdb';
};

const convexErrorCode = (error: unknown) => {
  const dataCode =
    typeof error === 'object' && error !== null && 'data' in error
      ? (error as { data?: { code?: unknown } }).data?.code
      : undefined;
  return (
    dataCode ??
    (String(error).includes('stale_season_version')
      ? 'stale_season_version'
      : String(error).includes('stale_epoch')
        ? 'stale_epoch'
        : undefined)
  );
};

export async function commitWatchWithOneRematch<T>(
  initial: T,
  commit: (match: T) => Promise<boolean>,
  rematch: () => Promise<T | undefined>,
  refreshEpoch: () => Promise<void>,
) {
  try {
    return { resolved: initial, recorded: await commit(initial) };
  } catch (error) {
    const staleCode = convexErrorCode(error);
    if (staleCode !== 'stale_season_version' && staleCode !== 'stale_epoch') throw error;
    if (staleCode === 'stale_epoch') await refreshEpoch();
    const rematched = await rematch();
    if (!rematched) throw new ConvexError({ code: staleCode, retryable: true });
    return { resolved: rematched, recorded: await commit(rematched) };
  }
}

async function recordWatchForUser(
  ctx: ActionCtx,
  args: WatchArgs,
  userId: Id<'users'>,
): Promise<WatchResult> {
  const title = args.seriesTitle.trim();
  if (!title || args.seriesTitle.length > 300) throw new Error('Invalid series title');
  if (args.seasonTitle !== undefined && args.seasonTitle.length > 300)
    throw new Error('Invalid season title');
  const seasonTitle = args.seasonTitle?.trim();
  if (args.episodeTitle !== undefined && args.episodeTitle.length > 300)
    throw new Error('Invalid episode title');
  if (args.url !== undefined && args.url.length > 1000) throw new Error('Invalid URL');
  const episodeTitle = args.episodeTitle?.trim();
  const hasNumbers = args.seasonNumber !== undefined && args.episodeNumber !== undefined;
  if (!hasNumbers && !episodeTitle) throw new Error('Episode coordinates or title required');
  if (args.seasonNumber !== undefined && args.episodeNumber === undefined && !episodeTitle)
    throw new Error('An episode number or title is required with a season number');
  if (args.episodeNumber !== undefined && args.seasonNumber === undefined && !episodeTitle)
    throw new Error('An episode title is required without a season number');
  for (const [name, value] of [
    ['seasonNumber', args.seasonNumber],
    ['episodeNumber', args.episodeNumber],
  ] as const)
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 10_000))
      throw new Error(`${name} must be a non-negative integer no greater than 10000`);

  let matchedExistingItem = false;
  const resolveTitle = async (
    candidateTitle: string,
  ): Promise<Doc<'items'> | ResolvedTvCandidate | null> => {
    const libraryItem: Doc<'items'> | null = await ctx.runQuery(internal.sync.findTvByTitle, {
      userId,
      title: candidateTitle,
    });
    if (libraryItem) {
      matchedExistingItem = true;
      return libraryItem;
    }
    const allowed = await ctx.runMutation(internal.tmdb.consumeThrottle, {
      key: `tmdb:${userId}`,
    });
    if (!allowed) throw new ConvexError({ code: 'upstream' });
    const matches: {
      id: number;
      title: string;
      originalTitle?: string;
      posterPath?: string;
      overview?: string;
      releaseDate?: string;
    }[] = await ctx.runAction(internal.tmdb.internalSearchTv, {
      query: candidateTitle,
    });
    const normalized = candidateTitle.trim().toLocaleLowerCase();
    const match = matches.find(
      (candidate) =>
        candidate.title.trim().toLocaleLowerCase() === normalized ||
        candidate.originalTitle?.trim().toLocaleLowerCase() === normalized,
    );
    if (!match) return null;
    return {
      userId,
      tmdbId: match.id,
      title: match.title,
      ...(match.posterPath !== undefined && { posterPath: match.posterPath }),
      ...(match.overview !== undefined && { overview: match.overview }),
      ...(match.releaseDate !== undefined && { releaseDate: match.releaseDate }),
    };
  };
  let item: Doc<'items'> | ResolvedTvCandidate | null = await resolveTitle(title);
  if (!item && seasonTitle) item = await resolveTitle(seasonTitle);
  if (!item) return { ok: false as const, reason: 'unmatched' as const };
  type CanonicalTitle = {
    seasons: { season: number }[];
    orderEpoch?: number;
    metadataProvider?: 'tmdb' | 'tvdb';
  };
  let canonicalTitle: CanonicalTitle;
  const resolveTitleForUser = internal.resolvedMetadata.titleResolution.resolveTitleForUser;
  try {
    canonicalTitle = await ctx.runAction(resolveTitleForUser, {
      userId,
      mediaType: 'tv',
      tmdbId: item.tmdbId,
      title: item.title,
    });
  } catch (error) {
    // A known library item with explicit coordinates remains recordable during
    // a provider outage; existing verified stamps remain intact.
    if (!matchedExistingItem || !hasNumbers) throw error;
    canonicalTitle = { seasons: [] };
  }
  const canonicalSeason = async (season: number): Promise<CanonicalSeasonMatch> => {
    try {
      await ctx.runAction(internal.resolvedMetadata.seasonResolution.resolveSeasonForUser, {
        userId,
        tmdbId: item!.tmdbId,
        season,
      });
    } catch (error) {
      if (!matchedExistingItem || !hasNumbers) throw error;
    }
    const matchedSeason = await ctx.runQuery(internal.resolvedMetadata.reads.readSeasonChunk, {
      tmdbId: item!.tmdbId,
      season,
    });
    const episodes: CanonicalEpisode[] = matchedSeason?.episodes ? [...matchedSeason.episodes] : [];
    for (let chunkIndex = 1; chunkIndex < (matchedSeason?.chunkCount ?? 0); chunkIndex += 1) {
      const chunk = await ctx.runQuery(internal.resolvedMetadata.reads.readSeasonChunk, {
        tmdbId: item!.tmdbId,
        season,
        chunkIndex,
      });
      if (!chunk) break;
      episodes.push(...chunk.episodes);
    }
    return {
      episodes,
      refreshedAt: matchedSeason?.refreshedAt,
      orderEpoch: matchedSeason?.orderEpoch,
      metadataProvider: matchedSeason?.metadataProvider,
    };
  };
  const matchEpisode = async () => {
    let resolved:
      | {
          season: number;
          episode: number;
          name?: string;
          runtime?: number;
          unverified?: boolean;
          matchedSeason?: CanonicalSeasonMatch;
        }
      | undefined;
    if (hasNumbers) {
      const matchedSeason = await canonicalSeason(args.seasonNumber!);
      const canonical = matchedSeason.episodes.find(
        (episode) => episode.episode === args.episodeNumber,
      );
      resolved = {
        season: args.seasonNumber!,
        episode: args.episodeNumber!,
        name: canonical?.name ?? episodeTitle,
        runtime: canonical?.runtime,
        matchedSeason,
      };
    }
    if (resolved) return resolved;
    const normalizeName = (name: string) =>
      name
        .normalize('NFKC')
        .trim()
        .toLocaleLowerCase()
        .replace(/[‘’]/gu, "'")
        .replace(/[“”]/gu, '"')
        .replace(/\p{P}/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
    const availableSeasons = new Set(
      canonicalTitle.seasons.map(({ season }: { season: number }) => season),
    );
    const additionalSeason = args.seasonNumber ?? 1;
    const seasonsToScan = [0, ...(additionalSeason !== 0 ? [additionalSeason] : [])].filter(
      (season) => availableSeasons.has(season),
    );
    const matches: {
      season: number;
      episode: number;
      name: string;
      runtime?: number;
      matchedSeason: CanonicalSeasonMatch;
    }[] = [];
    for (const season of seasonsToScan) {
      const matchedSeason = await canonicalSeason(season);
      matches.push(
        ...matchedSeason.episodes
          .filter((episode) => normalizeName(episode.name) === normalizeName(episodeTitle!))
          .map((episode) => ({ ...episode, matchedSeason })),
      );
    }
    if (matches.length > 1) return undefined;
    if (matches.length === 1) resolved = matches[0];
    else if (args.episodeNumber !== undefined)
      resolved = {
        season: 0,
        episode: args.episodeNumber,
        name: episodeTitle,
        unverified: true,
      };
    else return undefined;
    return resolved;
  };
  let resolved = await matchEpisode();
  if (!resolved) {
    if (!('_id' in item))
      await ctx.runMutation(internal.sync.finalizeResolvedTvWatch, { candidate: item });
    return { ok: false as const, reason: 'unmatched-episode' as const };
  }
  const commit = (match: NonNullable<typeof resolved>) => {
    const watch = {
      userId,
      season: match.season,
      episode: match.episode,
      ...(match.name !== undefined && { name: match.name }),
      ...(match.runtime !== undefined && { runtime: match.runtime }),
      ...(match.unverified !== undefined && { unverified: match.unverified }),
      ...((match.matchedSeason?.orderEpoch ?? canonicalTitle.orderEpoch) !== undefined &&
        (match.matchedSeason?.metadataProvider ?? canonicalTitle.metadataProvider) !==
          undefined && {
          matchedOrderEpoch: match.matchedSeason?.orderEpoch ?? canonicalTitle.orderEpoch,
          matchedProvider: match.matchedSeason?.metadataProvider ?? canonicalTitle.metadataProvider,
        }),
      ...(match.matchedSeason?.refreshedAt !== undefined && {
        matchedSeasonRefreshedAt: match.matchedSeason.refreshedAt,
      }),
    };
    return '_id' in item
      ? ctx.runMutation(internal.sync.recordWatchInternal, { ...watch, itemId: item._id })
      : ctx
          .runMutation(internal.sync.finalizeResolvedTvWatch, { candidate: item, watch })
          .then((result) => result.recorded);
  };
  const committed = await commitWatchWithOneRematch(resolved, commit, matchEpisode, async () => {
    try {
      canonicalTitle = await ctx.runAction(resolveTitleForUser, {
        userId,
        mediaType: 'tv',
        tmdbId: item.tmdbId,
        title: item.title,
      });
    } catch {
      throw new ConvexError({ code: 'stale_epoch', retryable: true });
    }
  });
  resolved = committed.resolved;
  if (!committed.recorded) return { ok: false as const, reason: 'unmatched-episode' as const };
  return {
    ok: true as const,
    season: resolved.season,
    episode: resolved.episode,
    ...(resolved.unverified && { unverified: true as const }),
  };
}

export const recordWatchFromExtensionInternal = internalAction({
  args: { ...watchArgs, userId: v.id('users') },
  handler: async (ctx, { userId, ...args }): Promise<WatchResult> => {
    return recordWatchForUser(ctx, args, userId);
  },
});
