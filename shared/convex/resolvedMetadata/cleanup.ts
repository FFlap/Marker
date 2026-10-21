import { v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { internalMutation } from '../_generated/server';
import { refreshLeaseKey, requestKey, seasonRequestKey } from './requests';
import { REFRESH_LEASE_MS, type MediaType } from './shared';

export const CANONICAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const canonicalGcPhase = v.union(
  v.literal('titles'),
  v.literal('seasons'),
  v.literal('chunks'),
  v.literal('mappings'),
);

/** Bounded storage hygiene only: never resolves or refreshes provider metadata. */
export const pruneCanonicalData = internalMutation({
  args: { phase: v.optional(canonicalGcPhase), cursor: v.optional(v.string()) },
  handler: async (ctx, { phase = 'titles', cursor }) => {
    const now = Date.now();
    const cutoff = now - CANONICAL_RETENTION_MS;
    const stagingCutoff = now - REFRESH_LEASE_MS;
    const isReferenced = (mediaTypeValue: MediaType, tmdbId: number) =>
      ctx.db
        .query('items')
        .withIndex('by_media_tmdb', (query) =>
          query.eq('mediaType', mediaTypeValue).eq('tmdbId', tmdbId),
        )
        .first()
        .then((item) => item !== null);
    const hasActiveCanonicalWork = async (
      mediaTypeValue: MediaType,
      tmdbId: number,
      season?: number,
    ) => {
      const [lease, request] = await Promise.all([
        ctx.db
          .query('metadataRefreshLeases')
          .withIndex('by_key', (query) => query.eq('key', refreshLeaseKey(mediaTypeValue, tmdbId)))
          .unique(),
        ctx.db
          .query('metadataRefreshRequests')
          .withIndex('by_key', (query) =>
            query.eq(
              'key',
              season === undefined
                ? requestKey(mediaTypeValue, tmdbId)
                : seasonRequestKey(tmdbId, season),
            ),
          )
          .unique(),
      ]);
      return (lease !== null && lease.expiresAt > now) || request?.state === 'inFlight';
    };
    const hasLiveStagingLease = async (row: Doc<'resolvedSeasons'>) => {
      const attempt = row.stagingVersion ?? row.writeAttemptToken;
      if (attempt === undefined) return false;
      const lease = await ctx.db
        .query('metadataRefreshLeases')
        .withIndex('by_key', (query) => query.eq('key', refreshLeaseKey('tv', row.tmdbId)))
        .unique();
      return (
        lease !== null &&
        lease.expiresAt > now &&
        (lease.token === attempt || lease.token === `scheduled:${attempt}`)
      );
    };
    const clearOrphanedStaging = async (row: Doc<'resolvedSeasons'>) => {
      const stagingVersion = row.stagingVersion;
      if (stagingVersion === undefined) return { deleted: 0, parentDeleted: false };
      const chunks = await ctx.db
        .query('resolvedSeasonChunks')
        .withIndex('by_tmdb_season_version_chunk', (query) =>
          query
            .eq('tmdbId', row.tmdbId)
            .eq('season', row.season)
            .eq('seasonVersion', stagingVersion),
        )
        .take(51);
      const partial = chunks.length > 50;
      const deletable = partial ? chunks.slice(0, 50) : chunks;
      for (const chunk of deletable) await ctx.db.delete(chunk._id);
      if (partial) return { deleted: deletable.length, parentDeleted: false };
      const hasVisibleSeason = row.chunkCount !== undefined && row.seasonVersion !== undefined;
      if (!hasVisibleSeason) {
        await ctx.db.delete(row._id);
        return { deleted: chunks.length + 1, parentDeleted: true };
      }
      await ctx.db.patch(row._id, {
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
      return { deleted: chunks.length, parentDeleted: false };
    };

    let page;
    let deleted = 0;
    if (phase === 'titles') {
      page = await ctx.db
        .query('resolvedTitles')
        .withIndex('by_refreshed_at', (query) => query.lt('refreshedAt', cutoff))
        .paginate({ cursor: cursor ?? null, numItems: 40 });
      for (const row of page.page)
        if (
          !(await isReferenced(row.mediaType, row.tmdbId)) &&
          !(await hasActiveCanonicalWork(row.mediaType, row.tmdbId))
        ) {
          await ctx.db.delete(row._id);
          deleted += 1;
        }
    } else if (phase === 'seasons') {
      page = await ctx.db
        .query('resolvedSeasons')
        .withIndex('by_refreshed_at', (query) => query.lt('refreshedAt', stagingCutoff))
        .paginate({ cursor: cursor ?? null, numItems: 10 });
      for (const row of page.page) {
        if (await hasActiveCanonicalWork('tv', row.tmdbId, row.season)) continue;
        if (row.stagingVersion !== undefined) {
          const stagingIsRecent = (row.stagingRefreshedAt ?? row.refreshedAt) >= stagingCutoff;
          if (stagingIsRecent || (await hasLiveStagingLease(row))) continue;
          const cleaned = await clearOrphanedStaging(row);
          deleted += cleaned.deleted;
          if (cleaned.parentDeleted) continue;
        }
        if (row.refreshedAt >= cutoff) continue;
        if (row.chunkCount !== 0 && (await isReferenced('tv', row.tmdbId))) continue;
        const chunks = await ctx.db
          .query('resolvedSeasonChunks')
          .withIndex('by_tmdb_season_epoch_chunk', (query) =>
            query.eq('tmdbId', row.tmdbId).eq('season', row.season),
          )
          .take(51);
        if (chunks.length > 50) continue;
        for (const chunk of chunks) await ctx.db.delete(chunk._id);
        await ctx.db.delete(row._id);
        deleted += chunks.length + 1;
      }
    } else if (phase === 'chunks') {
      page = await ctx.db
        .query('resolvedSeasonChunks')
        .withIndex('by_refreshed_at', (query) => query.lt('refreshedAt', stagingCutoff))
        .paginate({ cursor: cursor ?? null, numItems: 40 });
      for (const row of page.page) {
        const parent = await ctx.db
          .query('resolvedSeasons')
          .withIndex('by_tmdb_season', (query) =>
            query.eq('tmdbId', row.tmdbId).eq('season', row.season),
          )
          .unique();
        if (await hasActiveCanonicalWork('tv', row.tmdbId, row.season)) continue;
        const visible =
          parent !== null &&
          parent.chunkCount !== undefined &&
          (parent.seasonVersion !== undefined
            ? row.seasonVersion === parent.seasonVersion
            : row.seasonVersion === undefined && row.orderEpoch === parent.orderEpoch);
        if (visible) {
          if ((row.refreshedAt ?? 0) >= cutoff || (await isReferenced('tv', row.tmdbId))) continue;
        } else {
          const activeStaging =
            parent !== null &&
            parent.stagingVersion !== undefined &&
            parent.stagingVersion === row.seasonVersion &&
            ((parent.stagingRefreshedAt ?? parent.refreshedAt) >= stagingCutoff ||
              (await hasLiveStagingLease(parent)));
          if (activeStaging) continue;
        }
        if (!visible || !(await isReferenced('tv', row.tmdbId))) {
          await ctx.db.delete(row._id);
          deleted += 1;
        }
      }
    } else {
      page = await ctx.db
        .query('titleMappings')
        .withIndex('by_updated_at', (query) => query.lt('updatedAt', cutoff))
        .paginate({ cursor: cursor ?? null, numItems: 40 });
      for (const row of page.page) {
        if (await isReferenced(row.mediaType, row.tmdbId)) continue;
        const [title, latestSeason] = await Promise.all([
          ctx.db
            .query('resolvedTitles')
            .withIndex('by_tmdb', (query) =>
              query.eq('mediaType', row.mediaType).eq('tmdbId', row.tmdbId),
            )
            .unique(),
          ctx.db
            .query('resolvedSeasons')
            .withIndex('by_tmdb_refreshed_at', (query) => query.eq('tmdbId', row.tmdbId))
            .order('desc')
            .first(),
        ]);
        if (
          Math.max(row.updatedAt, title?.refreshedAt ?? 0, latestSeason?.refreshedAt ?? 0) >= cutoff
        )
          continue;
        if (row.source === 'manual' && (title || latestSeason)) continue;
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.resolvedMetadata.cleanup.pruneCanonicalData, {
        phase,
        cursor: page.continueCursor,
      });
    } else {
      const phases = ['titles', 'seasons', 'chunks', 'mappings'] as const;
      const next = phases[phases.indexOf(phase) + 1];
      if (next)
        await ctx.scheduler.runAfter(0, internal.resolvedMetadata.cleanup.pruneCanonicalData, {
          phase: next,
        });
    }
    return { phase, deleted, isDone: page.isDone };
  },
});

export const pruneRefreshRequests = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query('metadataRefreshRequests')
      .withIndex('by_expires', (query) => query.lt('expiresAt', Date.now() - 24 * 60 * 60 * 1000))
      .paginate({ cursor: cursor ?? null, numItems: 200 });
    for (const request of page.page) await ctx.db.delete(request._id);
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.resolvedMetadata.cleanup.pruneRefreshRequests, {
        cursor: page.continueCursor,
      });
    return { deleted: page.page.length, isDone: page.isDone };
  },
});

export const pruneRequestThrottle = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query('requestThrottle')
      .paginate({ cursor: cursor ?? null, numItems: 200 });
    let deleted = 0;
    for (const row of page.page)
      if (row.windowStart < Date.now() - 2 * 60 * 60 * 1000) {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.resolvedMetadata.cleanup.pruneRequestThrottle, {
        cursor: page.continueCursor,
      });
    return { deleted, isDone: page.isDone };
  },
});
