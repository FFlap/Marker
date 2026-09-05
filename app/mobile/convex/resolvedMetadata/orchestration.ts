import { ConvexError, v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from '../_generated/server';
import { refreshLeaseKey, requestKey } from './requests';
import { resolveAndCommitCanonical } from './seasonResolution';
import { FAILED_TOUCH_BACKOFF_MS, mediaType, REFRESH_LEASE_MS, REQUEST_LEASE_MS } from './shared';
import { errorCode, pause } from './titleResolution';

const MAX_CLAIM_RETRIES = 60;

export const readRefreshRequest = internalQuery({
  args: { key: v.string() },
  handler: (ctx, { key }) =>
    ctx.db
      .query('metadataRefreshRequests')
      .withIndex('by_key', (query) => query.eq('key', key))
      .unique(),
});

export const orchestrateRefresh = internalAction({
  args: {
    userId: v.id('users'),
    mediaType,
    tmdbId: v.number(),
    title: v.optional(v.string()),
    season: v.optional(v.number()),
    force: v.optional(v.boolean()),
    keys: v.array(v.string()),
    attemptToken: v.string(),
    mappingRetry: v.optional(v.boolean()),
    claimRetry: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const leaseKey = refreshLeaseKey(args.mediaType, args.tmdbId);
    const leaseToken = `scheduled:${args.attemptToken}`;
    let claimed = false;
    try {
      claimed = await ctx.runMutation(internal.resolvedMetadata.requests.claimRefresh, {
        key: leaseKey,
        token: leaseToken,
        leaseMs: REFRESH_LEASE_MS,
        requestKeys: args.keys,
        attemptToken: args.attemptToken,
      });
      if (!claimed) {
        const pending = await Promise.all(
          args.keys.map(
            (key) =>
              ctx.runQuery(internal.resolvedMetadata.orchestration.readRefreshRequest, {
                key,
              }) as Promise<Doc<'metadataRefreshRequests'> | null>,
          ),
        );
        if (
          pending.every(
            (request) =>
              request?.state === 'inFlight' &&
              request.attemptToken === args.attemptToken &&
              request.expiresAt > Date.now(),
          )
        ) {
          const claimRetry = args.claimRetry ?? 0;
          if (claimRetry >= MAX_CLAIM_RETRIES)
            throw new ConvexError({ code: 'refresh_claim_timeout', retryable: true });
          await ctx.runMutation(internal.resolvedMetadata.requests.renewRefreshRequests, {
            keys: args.keys,
            attemptToken: args.attemptToken,
            requestMs: REQUEST_LEASE_MS,
          });
          await ctx.scheduler.runAfter(
            1_000,
            internal.resolvedMetadata.orchestration.orchestrateRefresh,
            {
              ...args,
              claimRetry: claimRetry + 1,
            },
          );
          return;
        }
        throw new ConvexError({ code: 'refresh_in_progress', retryable: true });
      }
      const allowed = await ctx.runMutation(internal.tmdb.consumeThrottle, {
        key: `resolved:${args.userId}`,
      });
      if (!allowed) throw new ConvexError({ code: 'throttled' });
      const result = await resolveAndCommitCanonical(ctx, {
        mediaType: args.mediaType,
        tmdbId: args.tmdbId,
        title: args.title,
        requestedSeason: args.season,
        force: args.force ?? false,
        keys: args.keys,
        attemptToken: args.attemptToken,
        leaseKey,
        leaseToken,
      });
      if (result.commitStatus === 'mappingChanged' && !args.mappingRetry) {
        await ctx.scheduler.runAfter(
          100,
          internal.resolvedMetadata.orchestration.orchestrateRefresh,
          {
            ...args,
            mappingRetry: true,
          },
        );
        return;
      }
      if (result.commitStatus === 'mappingChanged')
        throw new ConvexError({ code: 'mapping_changed', retryable: true });
      if (!result.committed) return;
    } catch (error) {
      const settled = await ctx
        .runMutation(internal.resolvedMetadata.requests.settleScheduledRefresh, {
          mediaType: args.mediaType,
          tmdbId: args.tmdbId,
          ...(args.season !== undefined && { season: args.season }),
          keys: args.keys,
          attemptToken: args.attemptToken,
          errorCode: errorCode(error),
        })
        .catch(() => 'unsettled' as const);
      void settled;
    } finally {
      if (claimed)
        await ctx
          .runMutation(internal.resolvedMetadata.requests.releaseRefresh, {
            key: leaseKey,
            token: leaseToken,
          })
          .catch(() => undefined);
    }
  },
});

export async function waitForTitleRequest(ctx: ActionCtx, tmdbId: number) {
  const deadline = Date.now() + 10_000;
  let waited = false;
  while (Date.now() < deadline) {
    const row: Doc<'metadataRefreshRequests'> | null = await ctx.runQuery(
      internal.resolvedMetadata.orchestration.readRefreshRequest,
      { key: requestKey('tv', tmdbId) },
    );
    if (!row || row.state !== 'inFlight' || row.expiresAt <= Date.now()) return waited;
    waited = true;
    await pause(200);
  }
  return waited;
}

export const orchestrateSeasonRefresh = internalAction({
  args: {
    userId: v.id('users'),
    tmdbId: v.number(),
    season: v.number(),
    force: v.optional(v.boolean()),
    key: v.string(),
    attemptToken: v.string(),
    mappingRetry: v.optional(v.boolean()),
    claimRetry: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const leaseKey = refreshLeaseKey('tv', args.tmdbId);
    const leaseToken = `scheduled:${args.attemptToken}`;
    let claimed = false;
    try {
      await ctx.runMutation(internal.resolvedMetadata.requests.renewRefreshRequests, {
        keys: [args.key],
        attemptToken: args.attemptToken,
        requestMs: REQUEST_LEASE_MS,
      });
      await waitForTitleRequest(ctx, args.tmdbId);
      claimed = await ctx.runMutation(internal.resolvedMetadata.requests.claimRefresh, {
        key: leaseKey,
        token: leaseToken,
        leaseMs: REFRESH_LEASE_MS,
        requestKeys: [args.key],
        attemptToken: args.attemptToken,
      });
      if (!claimed) {
        const pending: Doc<'metadataRefreshRequests'> | null = await ctx.runQuery(
          internal.resolvedMetadata.orchestration.readRefreshRequest,
          { key: args.key },
        );
        if (
          pending?.state === 'inFlight' &&
          pending.attemptToken === args.attemptToken &&
          pending.expiresAt > Date.now()
        ) {
          const claimRetry = args.claimRetry ?? 0;
          if (claimRetry >= MAX_CLAIM_RETRIES)
            throw new ConvexError({ code: 'refresh_claim_timeout', retryable: true });
          await ctx.scheduler.runAfter(
            1_000,
            internal.resolvedMetadata.orchestration.orchestrateSeasonRefresh,
            {
              ...args,
              claimRetry: claimRetry + 1,
            },
          );
          return;
        }
        throw new ConvexError({ code: 'refresh_in_progress', retryable: true });
      }
      const allowed = await ctx.runMutation(internal.tmdb.consumeThrottle, {
        key: `resolved:${args.userId}`,
      });
      if (!allowed) throw new ConvexError({ code: 'throttled' });
      const [title, mapping, request] = await Promise.all([
        ctx.runQuery(internal.resolvedMetadata.reads.readTitle, {
          mediaType: 'tv',
          tmdbId: args.tmdbId,
        }) as Promise<Doc<'resolvedTitles'> | null>,
        ctx.runQuery(internal.resolvedMetadata.reads.readTitleMapping, {
          mediaType: 'tv',
          tmdbId: args.tmdbId,
        }) as Promise<Doc<'titleMappings'> | null>,
        ctx.runQuery(internal.resolvedMetadata.orchestration.readRefreshRequest, {
          key: args.key,
        }) as Promise<Doc<'metadataRefreshRequests'> | null>,
      ]);
      if (!title || title.orderEpoch !== (mapping?.orderEpoch ?? 0))
        throw new ConvexError({ code: 'title_unavailable', retryable: true });
      const result = await resolveAndCommitCanonical(ctx, {
        mediaType: 'tv',
        tmdbId: args.tmdbId,
        title: title.title,
        requestedSeason: args.season,
        force:
          (args.force ?? false) &&
          !(
            request &&
            title.metadataProvider === 'tvdb' &&
            title.refreshedAt >= request.lastRequestedAt &&
            args.season === title.seasons.find((entry) => entry.season > 0)?.season
          ),
        keys: [args.key],
        attemptToken: args.attemptToken,
        leaseKey,
        leaseToken,
        currentTitle: title,
      });
      if (result.commitStatus === 'mappingChanged' && !args.mappingRetry) {
        await ctx.scheduler.runAfter(
          100,
          internal.resolvedMetadata.orchestration.orchestrateSeasonRefresh,
          {
            ...args,
            mappingRetry: true,
          },
        );
        return;
      }
      if (result.commitStatus === 'mappingChanged')
        throw new ConvexError({ code: 'mapping_changed', retryable: true });
      if (!result.committed) return;
    } catch (error) {
      const settled = await ctx
        .runMutation(internal.resolvedMetadata.requests.settleScheduledRefresh, {
          mediaType: 'tv',
          tmdbId: args.tmdbId,
          season: args.season,
          keys: [args.key],
          attemptToken: args.attemptToken,
          errorCode: errorCode(error),
        })
        .catch(() => 'unsettled' as const);
      void settled;
    } finally {
      if (claimed)
        await ctx
          .runMutation(internal.resolvedMetadata.requests.releaseRefresh, {
            key: leaseKey,
            token: leaseToken,
          })
          .catch(() => undefined);
    }
  },
});

/** Atomically fails every row adopted by a synchronous attempt and releases its lease. */
export const failSynchronousRefresh = internalMutation({
  args: {
    leaseKey: v.string(),
    attemptToken: v.string(),
    errorCode: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const [lease, requests] = await Promise.all([
      ctx.db
        .query('metadataRefreshLeases')
        .withIndex('by_key', (query) => query.eq('key', args.leaseKey))
        .unique(),
      ctx.db
        .query('metadataRefreshRequests')
        .withIndex('by_attempt_token', (query) => query.eq('attemptToken', args.attemptToken))
        .collect(),
    ]);
    let settled = 0;
    for (const request of requests) {
      if (request.state !== 'inFlight') continue;
      await ctx.db.patch(request._id, {
        state: 'failed',
        completedAt: now,
        expiresAt: now,
        retryAt: now + FAILED_TOUCH_BACKOFF_MS,
        errorCode: args.errorCode,
      });
      settled += 1;
    }
    if (lease?.token === args.attemptToken) await ctx.db.delete(lease._id);
    return settled;
  },
});

export const pruneRefreshLeases = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const leases = await ctx.db
      .query('metadataRefreshLeases')
      .withIndex('by_expires', (query) => query.lt('expiresAt', now))
      .take(500);
    await Promise.all(leases.map((document) => ctx.db.delete(document._id)));
    await ctx.scheduler.runAfter(0, internal.resolvedMetadata.cleanup.pruneCanonicalData, {});
    return {
      leases: leases.length,
    };
  },
});
