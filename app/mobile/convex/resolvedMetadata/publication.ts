import { v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { internalMutation, type MutationCtx } from '../_generated/server';
import { refreshLeaseKey, requestKey, seasonRequestKey } from './requests';
import {
  FAILED_TOUCH_BACKOFF_MS,
  type MappingIdentity,
  type MappingWrite,
  mediaType,
  type MediaType,
  refreshOutcomeValidator,
  resolvedEpisodeValidator,
  type ResolvedTitle,
  resolvedTitleValidator,
} from './shared';
import {
  appendPrechunkedSeasonChunk,
  assertMetadataMutationSize,
  beginPrechunkedSeasonWrite,
  finalizePrechunkedSeasonWrite,
} from '../seasonStorage';

type CanonicalPublication = {
  title: ResolvedTitle;
  titleWrite: 'replace' | 'seasonPatch';
  season?: { season: number; episodeCount: number };
  mapping?: MappingWrite;
  writeTitle: boolean;
  writeSeason: boolean;
  now: number;
};

export async function publishCanonicalMetadata(
  ctx: MutationCtx,
  args: CanonicalPublication,
  currentMapping: Doc<'titleMappings'> | null,
  existingTitle: Doc<'resolvedTitles'> | null,
) {
  const refreshed = (args.titleWrite === 'replace' && args.writeTitle) || args.writeSeason;
  if (args.titleWrite === 'replace' && args.writeTitle) {
    const title =
      args.writeSeason && args.season
        ? {
            ...args.title,
            seasons: args.title.seasons.flatMap((entry) =>
              entry.season !== args.season!.season
                ? [entry]
                : args.season!.episodeCount > 0
                  ? [{ ...entry, episodeCount: args.season!.episodeCount }]
                  : [],
            ),
          }
        : args.title;
    if (existingTitle) await ctx.db.replace(existingTitle._id, title);
    else await ctx.db.insert('resolvedTitles', title);
    await ctx.scheduler.runAfter(0, internal.resolvedMetadata.publication.refreshItemProjections, {
      mediaType: title.mediaType,
      tmdbId: title.tmdbId,
    });
  } else if (
    args.titleWrite === 'seasonPatch' &&
    args.writeSeason &&
    args.season &&
    existingTitle
  ) {
    await ctx.db.patch(existingTitle._id, {
      seasons: existingTitle.seasons.map((entry) =>
        entry.season === args.season!.season
          ? { ...entry, episodeCount: args.season!.episodeCount }
          : entry,
      ),
    });
  }

  if (!refreshed) return;
  if (!currentMapping) {
    if (args.mapping) await ctx.db.insert('titleMappings', args.mapping);
    return;
  }
  if (args.mapping && currentMapping.source === 'auto') {
    const identityChanged =
      currentMapping.tvdbId !== args.mapping.tvdbId ||
      currentMapping.seasonOrder !== args.mapping.seasonOrder;
    const expectedEpoch = currentMapping.orderEpoch + (identityChanged ? 1 : 0);
    if (args.mapping.orderEpoch !== expectedEpoch)
      throw new Error(
        'An automatic mapping identity change must increment orderEpoch exactly once',
      );
    await ctx.db.replace(currentMapping._id, args.mapping);
    return;
  }
  // Manual mapping identity is authoritative and can only be changed by the
  // explicit mapping controls, never by provider discovery.
  await ctx.db.patch(currentMapping._id, { updatedAt: args.now });
}

/** Keeps the library's display projection current without adding list-time joins. */
export const refreshItemProjections = internalMutation({
  args: { mediaType, tmdbId: v.number(), cursor: v.optional(v.string()) },
  returns: v.object({ updated: v.number(), isDone: v.boolean() }),
  handler: async (ctx, { mediaType: type, tmdbId, cursor }) => {
    const [title, mapping] = await Promise.all([
      ctx.db
        .query('resolvedTitles')
        .withIndex('by_tmdb', (query) => query.eq('mediaType', type).eq('tmdbId', tmdbId))
        .unique(),
      ctx.db
        .query('titleMappings')
        .withIndex('by_tmdb', (query) => query.eq('mediaType', type).eq('tmdbId', tmdbId))
        .unique(),
    ]);
    if (!title || (mapping && title.orderEpoch !== mapping.orderEpoch))
      return { updated: 0, isDone: true };
    const page = await ctx.db
      .query('items')
      .withIndex('by_media_tmdb', (query) => query.eq('mediaType', type).eq('tmdbId', tmdbId))
      .paginate({ cursor: cursor ?? null, numItems: 10 });
    const runtime =
      title.runtime ??
      (title.episodeRunTime.length
        ? title.episodeRunTime.reduce((sum, value) => sum + value, 0) / title.episodeRunTime.length
        : undefined);
    for (const item of page.page) {
      await ctx.db.patch(item._id, {
        title: title.title,
        normalizedTitle: title.title.toLowerCase(),
        posterPath: title.posterPath,
        overview: title.overview,
        releaseDate: title.releaseDate ?? title.firstAirDate,
        runtime,
        genres: title.genres,
        isAnime: title.genres.some((genre) => genre.toLowerCase() === 'anime'),
      });
      if (type === 'tv') {
        await ctx.scheduler.runAfter(0, internal.nextEpisode.startNextEpisodeRefresh, {
          itemId: item._id,
        });
        await ctx.scheduler.runAfter(
          0,
          internal.episodeProjectionRepair.startEpisodeProjectionRepair,
          { itemId: item._id },
        );
      }
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(
        0,
        internal.resolvedMetadata.publication.refreshItemProjections,
        {
          mediaType: type,
          tmdbId,
          cursor: page.continueCursor,
        },
      );
    return { updated: page.page.length, isDone: page.isDone };
  },
});

export type RefreshOutcome = {
  key: string;
  state: 'succeeded' | 'failed' | 'notFound';
  errorCode?: string;
};

/**
 * Resolves the explicit attempt outcome plus late request rows that attached to
 * the same lease token before this publication transaction began.
 */
export async function requestsForPublication(
  ctx: MutationCtx,
  explicitOutcomes: RefreshOutcome[],
  publicationKeys: string[],
  attemptToken: string,
  now: number,
) {
  const explicitByKey = new Map(explicitOutcomes.map((outcome) => [outcome.key, outcome]));
  const keys = [...new Set([...explicitByKey.keys(), ...publicationKeys])];
  const rows = await Promise.all(
    keys.map((key) =>
      ctx.db
        .query('metadataRefreshRequests')
        .withIndex('by_key', (query) => query.eq('key', key))
        .unique(),
    ),
  );
  const attached: { row: Doc<'metadataRefreshRequests'>; outcome: RefreshOutcome }[] = [];
  for (const [index, key] of keys.entries()) {
    const row = rows[index];
    const explicit = explicitByKey.get(key);
    if (explicit) {
      if (
        !row ||
        row.state !== 'inFlight' ||
        row.expiresAt <= now ||
        row.attemptToken !== attemptToken
      )
        return null;
      attached.push({ row, outcome: explicit });
      continue;
    }
    if (!row || row.state !== 'inFlight' || row.attemptToken !== attemptToken) continue;
    if (row.expiresAt <= now) return null;
    attached.push({ row, outcome: { key, state: 'succeeded' } });
  }
  return attached;
}

export async function visiblePublicationOutcomes(
  ctx: MutationCtx,
  attached: { row: Doc<'metadataRefreshRequests'>; outcome: RefreshOutcome }[],
  args: { mediaType: MediaType; tmdbId: number; season?: number },
) {
  const [mapping, title, seasonParent] = await Promise.all([
    ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (query) =>
        query.eq('mediaType', args.mediaType).eq('tmdbId', args.tmdbId),
      )
      .unique(),
    ctx.db
      .query('resolvedTitles')
      .withIndex('by_tmdb', (query) =>
        query.eq('mediaType', args.mediaType).eq('tmdbId', args.tmdbId),
      )
      .unique(),
    args.season === undefined
      ? Promise.resolve(null)
      : ctx.db
          .query('resolvedSeasons')
          .withIndex('by_tmdb_season', (query) =>
            query.eq('tmdbId', args.tmdbId).eq('season', args.season!),
          )
          .unique(),
  ]);
  const titleVisible =
    title !== null &&
    (mapping?.orderEpoch === undefined || title.orderEpoch === mapping.orderEpoch);
  const seasonVisible =
    mapping !== null &&
    seasonParent !== null &&
    seasonParent.orderEpoch === mapping.orderEpoch &&
    seasonParent.chunkCount !== undefined &&
    seasonParent.seasonVersion !== undefined &&
    seasonParent.chunksComplete === true;
  return attached.map(({ row, outcome }) => {
    const visible = outcome.key.startsWith('season:') ? seasonVisible : titleVisible;
    return {
      row,
      outcome:
        outcome.state === 'succeeded' && !visible
          ? {
              ...outcome,
              state: 'failed' as const,
              errorCode: 'publication_invisible',
            }
          : outcome,
    };
  });
}

export const commitRefresh = internalMutation({
  args: {
    title: resolvedTitleValidator,
    titleWrite: v.optional(v.union(v.literal('replace'), v.literal('seasonPatch'))),
    season: v.optional(
      v.object({
        tmdbId: v.number(),
        season: v.number(),
        metadataProvider: v.union(v.literal('tmdb'), v.literal('tvdb')),
        chunks: v.array(v.array(resolvedEpisodeValidator)),
        episodeCount: v.number(),
        chunkCount: v.number(),
        refreshedAt: v.number(),
        refreshAfter: v.number(),
        orderEpoch: v.number(),
      }),
    ),
    mapping: v.optional(
      v.object({
        tmdbId: v.number(),
        mediaType,
        tvdbId: v.optional(v.number()),
        seasonOrder: v.optional(v.string()),
        source: v.union(v.literal('auto'), v.literal('manual')),
        orderEpoch: v.number(),
        updatedAt: v.number(),
      }),
    ),
    expectedMapping: v.optional(
      v.union(
        v.null(),
        v.object({
          tvdbId: v.optional(v.number()),
          seasonOrder: v.optional(v.string()),
          source: v.union(v.literal('auto'), v.literal('manual')),
          orderEpoch: v.number(),
        }),
      ),
    ),
    keys: v.optional(v.array(v.string())),
    outcomes: v.optional(v.array(refreshOutcomeValidator)),
    attemptToken: v.string(),
    leaseKey: v.string(),
    leaseToken: v.string(),
  },
  handler: async (ctx, args) => {
    assertMetadataMutationSize(args, 'commitRefresh');
    const now = Date.now();
    if (args.leaseKey !== refreshLeaseKey(args.title.mediaType, args.title.tmdbId)) return false;
    const lease = await ctx.db
      .query('metadataRefreshLeases')
      .withIndex('by_key', (query) => query.eq('key', args.leaseKey))
      .unique();
    if (!lease || lease.token !== args.leaseToken || lease.expiresAt <= now) return false;
    // This is deliberately checked before the first write. A newer touch may have
    // superseded an outbound attempt while it was waiting on a provider.
    const outcomes: RefreshOutcome[] =
      args.outcomes ?? (args.keys ?? []).map((key) => ({ key, state: 'succeeded' as const }));
    const currentMapping = await ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (q) =>
        q.eq('mediaType', args.title.mediaType).eq('tmdbId', args.title.tmdbId),
      )
      .unique();
    if (
      args.expectedMapping !== undefined &&
      !sameMappingIdentity(args.expectedMapping, currentMapping)
    )
      return 'mappingChanged' as const;
    const existingTitle = await ctx.db
      .query('resolvedTitles')
      .withIndex('by_tmdb', (q) =>
        q.eq('mediaType', args.title.mediaType).eq('tmdbId', args.title.tmdbId),
      )
      .unique();
    const titleOutcome = outcomes.find((outcome) => outcome.key.startsWith('title:'));
    const seasonOutcome = outcomes.find((outcome) => outcome.key.startsWith('season:'));
    const writeTitle = titleOutcome?.state !== 'failed' && titleOutcome?.state !== 'notFound';
    const writeSeason =
      args.season !== undefined &&
      seasonOutcome?.state !== 'failed' &&
      seasonOutcome?.state !== 'notFound';
    const requests = await requestsForPublication(
      ctx,
      outcomes,
      [
        ...(writeTitle ? [requestKey(args.title.mediaType, args.title.tmdbId)] : []),
        ...(writeSeason ? [seasonRequestKey(args.title.tmdbId, args.season!.season)] : []),
      ],
      args.attemptToken,
      now,
    );
    if (!requests) return false;
    if (writeSeason) {
      await beginPrechunkedSeasonWrite(ctx, args.season!, args.attemptToken);
      if (args.season!.chunkCount > 1) {
        const parent = await ctx.db
          .query('resolvedSeasons')
          .withIndex('by_tmdb_season', (query) =>
            query.eq('tmdbId', args.season!.tmdbId).eq('season', args.season!.season),
          )
          .unique();
        if (!parent || parent.stagingVersion !== args.attemptToken)
          throw new Error('A multi-chunk season could not be staged');
        await ctx.db.patch(parent._id, {
          stagingTitle: args.title,
          stagingTitleWrite: args.titleWrite ?? 'replace',
          stagingMapping: args.mapping ?? null,
          stagingExpectedMapping: args.expectedMapping ?? null,
        });
        return 'staged' as const;
      }
      const finalized = await finalizePrechunkedSeasonWrite(ctx, {
        tmdbId: args.season!.tmdbId,
        season: args.season!.season,
        attemptToken: args.attemptToken,
      });
      if (!finalized) throw new Error('A single-chunk season could not be published');
    }
    await publishCanonicalMetadata(
      ctx,
      {
        title: args.title,
        titleWrite: args.titleWrite ?? 'replace',
        ...(args.season && {
          season: { season: args.season.season, episodeCount: args.season.episodeCount },
        }),
        ...(args.mapping && { mapping: args.mapping }),
        writeTitle,
        writeSeason,
        now,
      },
      currentMapping,
      existingTitle,
    );
    if (writeSeason)
      await ctx.scheduler.runAfter(0, internal.episodeSummaries.reconcileSeasonSummaries, {
        tmdbId: args.title.tmdbId,
        season: args.season!.season,
      });
    const publishedRequests = await visiblePublicationOutcomes(ctx, requests, {
      mediaType: args.title.mediaType,
      tmdbId: args.title.tmdbId,
      ...(args.season && { season: args.season.season }),
    });
    for (const { row, outcome } of publishedRequests) {
      await ctx.db.patch(row._id, {
        state: outcome.state,
        completedAt: now,
        expiresAt: now,
        retryAt: outcome.state === 'failed' ? now + FAILED_TOUCH_BACKOFF_MS : undefined,
        ...(outcome.errorCode ? { errorCode: outcome.errorCode } : { errorCode: undefined }),
      });
    }
    return true;
  },
});

export const appendRefreshSeasonChunk = internalMutation({
  args: {
    tmdbId: v.number(),
    season: v.number(),
    orderEpoch: v.number(),
    chunkIndex: v.number(),
    episodes: v.array(resolvedEpisodeValidator),
    attemptToken: v.string(),
  },
  handler: (ctx, args) => {
    assertMetadataMutationSize(args, 'appendRefreshSeasonChunk');
    return appendPrechunkedSeasonChunk(ctx, args);
  },
});

export const finalizeRefreshSeason = internalMutation({
  args: {
    tmdbId: v.number(),
    season: v.number(),
    outcomes: v.array(refreshOutcomeValidator),
    expectedMapping: v.union(
      v.null(),
      v.object({
        tvdbId: v.optional(v.number()),
        seasonOrder: v.optional(v.string()),
        source: v.union(v.literal('auto'), v.literal('manual')),
        orderEpoch: v.number(),
      }),
    ),
    attemptToken: v.string(),
    leaseKey: v.string(),
    leaseToken: v.string(),
  },
  handler: async (ctx, args) => {
    assertMetadataMutationSize(args, 'finalizeRefreshSeason');
    const now = Date.now();
    if (args.leaseKey !== refreshLeaseKey('tv', args.tmdbId)) return false;
    const [lease, mapping, parent, existingTitle] = await Promise.all([
      ctx.db
        .query('metadataRefreshLeases')
        .withIndex('by_key', (query) => query.eq('key', args.leaseKey))
        .unique(),
      ctx.db
        .query('titleMappings')
        .withIndex('by_tmdb', (query) => query.eq('mediaType', 'tv').eq('tmdbId', args.tmdbId))
        .unique(),
      ctx.db
        .query('resolvedSeasons')
        .withIndex('by_tmdb_season', (query) =>
          query.eq('tmdbId', args.tmdbId).eq('season', args.season),
        )
        .unique(),
      ctx.db
        .query('resolvedTitles')
        .withIndex('by_tmdb', (query) => query.eq('mediaType', 'tv').eq('tmdbId', args.tmdbId))
        .unique(),
    ]);
    if (!lease || lease.token !== args.leaseToken || lease.expiresAt <= now) return false;
    if (
      !parent ||
      parent.stagingVersion !== args.attemptToken ||
      parent.stagingTitle === undefined ||
      parent.stagingTitleWrite === undefined ||
      parent.stagingEpisodeCount === undefined ||
      parent.stagingExpectedMapping === undefined
    )
      return false;
    const stagedExpectedMapping = parent.stagingExpectedMapping as MappingIdentity | null;
    if (
      !sameMappingIdentity(args.expectedMapping, mapping) ||
      !sameMappingIdentity(stagedExpectedMapping, mapping)
    )
      return 'mappingChanged' as const;
    const titleOutcome = args.outcomes.find((outcome) => outcome.key.startsWith('title:'));
    const seasonOutcome = args.outcomes.find((outcome) => outcome.key.startsWith('season:'));
    const writeTitle = titleOutcome?.state !== 'failed' && titleOutcome?.state !== 'notFound';
    const writeSeason = seasonOutcome?.state !== 'failed' && seasonOutcome?.state !== 'notFound';
    const publicationKeys: string[] = [];
    if (writeTitle) publicationKeys.push(requestKey('tv', args.tmdbId));
    if (writeSeason) publicationKeys.push(seasonRequestKey(args.tmdbId, args.season));
    const requests = await requestsForPublication(
      ctx,
      args.outcomes,
      publicationKeys,
      args.attemptToken,
      now,
    );
    if (!requests) return false;
    const finalized = await finalizePrechunkedSeasonWrite(ctx, {
      tmdbId: args.tmdbId,
      season: args.season,
      attemptToken: args.attemptToken,
    });
    if (!finalized) return false;
    const publication: CanonicalPublication = {
      title: parent.stagingTitle as ResolvedTitle,
      titleWrite: parent.stagingTitleWrite,
      season: {
        season: args.season,
        episodeCount: parent.stagingEpisodeCount,
      },
      writeTitle,
      writeSeason,
      now,
    };
    if (parent.stagingMapping !== null && parent.stagingMapping !== undefined)
      publication.mapping = parent.stagingMapping as MappingWrite;
    await publishCanonicalMetadata(ctx, publication, mapping, existingTitle);
    if (writeSeason)
      await ctx.scheduler.runAfter(0, internal.episodeSummaries.reconcileSeasonSummaries, {
        tmdbId: args.tmdbId,
        season: args.season,
      });
    const publishedRequests = await visiblePublicationOutcomes(ctx, requests, {
      mediaType: 'tv',
      tmdbId: args.tmdbId,
      season: args.season,
    });
    for (const { row, outcome } of publishedRequests) {
      await ctx.db.patch(row._id, {
        state: outcome.state,
        completedAt: now,
        expiresAt: now,
        retryAt: outcome.state === 'failed' ? now + FAILED_TOUCH_BACKOFF_MS : undefined,
        ...(outcome.errorCode ? { errorCode: outcome.errorCode } : { errorCode: undefined }),
      });
    }
    return true;
  },
});

export function sameMappingIdentity(
  expected: MappingIdentity | null,
  current: Doc<'titleMappings'> | null,
) {
  if (expected === null) return current === null;
  return (
    current !== null &&
    current.tvdbId === expected.tvdbId &&
    current.seasonOrder === expected.seasonOrder &&
    current.source === expected.source &&
    current.orderEpoch === expected.orderEpoch
  );
}

export const mappingIdentity = (mapping: Doc<'titleMappings'> | null): MappingIdentity | null =>
  mapping
    ? {
        ...(mapping.tvdbId !== undefined && { tvdbId: mapping.tvdbId }),
        ...(mapping.seasonOrder !== undefined && { seasonOrder: mapping.seasonOrder }),
        source: mapping.source,
        orderEpoch: mapping.orderEpoch,
      }
    : null;
