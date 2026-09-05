import { ConvexError, v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { internalMutation, type MutationCtx } from '../_generated/server';
import {
  FAILED_TOUCH_BACKOFF_MS,
  GLOBAL_TOUCHES_PER_MINUTE,
  mediaType,
  NEW_TOUCH_KEYS_PER_HOUR,
  refreshOutcomeValidator,
  resolvedEpisodeValidator,
  resolvedTitleValidator,
  TOUCHES_PER_MINUTE,
  type MediaType,
} from './shared';
import { writeChunkedSeason } from '../seasonStorage';

export const putTitle = internalMutation({
  args: { value: resolvedTitleValidator },
  handler: async (ctx, { value }) => {
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
  },
});

export const putSeason = internalMutation({
  args: {
    tmdbId: v.number(),
    season: v.number(),
    metadataProvider: v.union(v.literal('tmdb'), v.literal('tvdb')),
    episodes: v.array(resolvedEpisodeValidator),
    refreshedAt: v.number(),
    refreshAfter: v.number(),
    orderEpoch: v.number(),
  },
  handler: async (ctx, args) => {
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
  },
});

export const claimRefresh = internalMutation({
  args: {
    key: v.string(),
    token: v.string(),
    leaseMs: v.number(),
    requestKeys: v.optional(v.array(v.string())),
    attemptToken: v.optional(v.string()),
  },
  handler: async (ctx, { key, token, leaseMs, requestKeys, attemptToken }) => {
    const now = Date.now();
    const existing = await ctx.db
      .query('metadataRefreshLeases')
      .withIndex('by_key', (query) => query.eq('key', key))
      .unique();
    if (existing && existing.expiresAt > now) return false;
    const value = { key, token, expiresAt: now + Math.min(Math.max(leaseMs, 1_000), 120_000) };
    if (existing) await ctx.db.replace(existing._id, value);
    else await ctx.db.insert('metadataRefreshLeases', value);
    if (attemptToken)
      for (const requestKeyValue of new Set(requestKeys ?? [])) {
        const request = await ctx.db
          .query('metadataRefreshRequests')
          .withIndex('by_key', (query) => query.eq('key', requestKeyValue))
          .unique();
        if (request?.state === 'inFlight' && request.attemptToken === attemptToken)
          await ctx.db.patch(request._id, { expiresAt: value.expiresAt });
      }
    return true;
  },
});

/** Renews one still-owned provider attempt and every request row attached to it. */
export const renewRefreshAttempt = internalMutation({
  args: {
    key: v.string(),
    token: v.string(),
    leaseMs: v.number(),
    requestKeys: v.array(v.string()),
    attemptToken: v.string(),
  },
  handler: async (ctx, args) => {
    const lease = await ctx.db
      .query('metadataRefreshLeases')
      .withIndex('by_key', (query) => query.eq('key', args.key))
      .unique();
    if (!lease || lease.token !== args.token) return false;
    const expiresAt = Date.now() + Math.min(Math.max(args.leaseMs, 1_000), 120_000);
    await ctx.db.patch(lease._id, { expiresAt });
    for (const key of new Set(args.requestKeys)) {
      const request = await ctx.db
        .query('metadataRefreshRequests')
        .withIndex('by_key', (query) => query.eq('key', key))
        .unique();
      if (request?.state === 'inFlight' && request.attemptToken === args.attemptToken)
        await ctx.db.patch(request._id, { expiresAt });
    }
    return expiresAt;
  },
});

/** Keeps a queued season request alive while it waits for the shared title lease. */
export const renewRefreshRequests = internalMutation({
  args: { keys: v.array(v.string()), attemptToken: v.string(), requestMs: v.number() },
  handler: async (ctx, args) => {
    const expiresAt = Date.now() + Math.min(Math.max(args.requestMs, 1_000), 120_000);
    let renewed = 0;
    for (const key of new Set(args.keys)) {
      const request = await ctx.db
        .query('metadataRefreshRequests')
        .withIndex('by_key', (query) => query.eq('key', key))
        .unique();
      if (request?.state !== 'inFlight' || request.attemptToken !== args.attemptToken) continue;
      await ctx.db.patch(request._id, { expiresAt });
      renewed += 1;
    }
    return renewed;
  },
});

export const releaseRefresh = internalMutation({
  args: { key: v.string(), token: v.string() },
  handler: async (ctx, { key, token }) => {
    const existing = await ctx.db
      .query('metadataRefreshLeases')
      .withIndex('by_key', (query) => query.eq('key', key))
      .unique();
    if (existing?.token === token) await ctx.db.delete(existing._id);
  },
});

export const requestKey = (mediaTypeValue: MediaType, tmdbId: number) =>
  `title:${mediaTypeValue}:${tmdbId}`;
export const seasonRequestKey = (tmdbId: number, season: number) => `season:${tmdbId}:${season}`;
export const refreshLeaseKey = (mediaTypeValue: MediaType, tmdbId: number) =>
  `metadata:${mediaTypeValue}:${tmdbId}`;
export function visibleRequestState(row: Doc<'metadataRefreshRequests'> | null) {
  if (!row) return row;
  const now = Date.now();
  const visible = {
    state: row.state,
    lastRequestedAt: row.lastRequestedAt,
    ...(row.completedAt !== undefined && { completedAt: row.completedAt }),
    ...(row.errorCode !== undefined && { errorCode: row.errorCode }),
    ...(row.retryAt !== undefined && { retryAt: row.retryAt }),
    expiresAt: row.expiresAt,
  };
  if (row.state === 'inFlight' && row.expiresAt > now)
    return { ...visible, delayMs: Math.max(0, row.expiresAt - now) };
  if (row.state === 'failed') {
    const retryAt =
      row.retryAt ?? (row.completedAt ?? row.lastRequestedAt) + FAILED_TOUCH_BACKOFF_MS;
    return { ...visible, retryAt, delayMs: Math.max(0, retryAt - now) };
  }
  if (row.state !== 'inFlight') return visible;
  return {
    ...visible,
    state: 'failed' as const,
    errorCode: 'expired',
    completedAt: row.expiresAt,
    retryAt: row.expiresAt + FAILED_TOUCH_BACKOFF_MS,
    delayMs: Math.max(0, row.expiresAt + FAILED_TOUCH_BACKOFF_MS - now),
  };
}

export async function consumeWindowBudget(
  ctx: MutationCtx,
  key: string,
  maximum: number,
  windowMs: number,
  amount = 1,
) {
  const now = Date.now();
  const row = await ctx.db
    .query('requestThrottle')
    .withIndex('by_key', (query) => query.eq('key', key))
    .unique();
  if (!row) {
    if (amount > maximum) return false;
    await ctx.db.insert('requestThrottle', { key, windowStart: now, count: amount });
    return true;
  }
  if (now - row.windowStart >= windowMs) {
    if (amount > maximum) return false;
    await ctx.db.patch(row._id, { windowStart: now, count: amount });
    return true;
  }
  if (row.count + amount > maximum) return false;
  await ctx.db.patch(row._id, { count: row.count + amount });
  return true;
}

export async function consumeRefreshAdmission(
  ctx: MutationCtx,
  userId: Id<'users'>,
  newKeyCount: number,
) {
  if (!(await consumeWindowBudget(ctx, `metadata-touch:${userId}`, TOUCHES_PER_MINUTE, 60_000)))
    throw new ConvexError({ code: 'touch_budget', retryable: true });
  if (
    newKeyCount > 0 &&
    !(await consumeWindowBudget(
      ctx,
      `metadata-touch-new:${userId}`,
      NEW_TOUCH_KEYS_PER_HOUR,
      60 * 60 * 1000,
      newKeyCount,
    ))
  )
    throw new ConvexError({ code: 'new_touch_key_budget', retryable: true });
  if (!(await consumeWindowBudget(ctx, 'metadata-touch:global', GLOBAL_TOUCHES_PER_MINUTE, 60_000)))
    throw new ConvexError({ code: 'global_touch_budget', retryable: true });
}

export const admitSynchronousRefresh = internalMutation({
  args: { userId: v.id('users'), keys: v.array(v.string()) },
  handler: async (ctx, { userId, keys }) => {
    const uniqueKeys = [...new Set(keys)];
    const rows = await Promise.all(
      uniqueKeys.map((key) =>
        ctx.db
          .query('metadataRefreshRequests')
          .withIndex('by_key', (query) => query.eq('key', key))
          .unique(),
      ),
    );
    await consumeRefreshAdmission(ctx, userId, rows.filter((row) => !row).length);
    return true;
  },
});

export const completeRefreshRequest = internalMutation({
  args: {
    key: v.string(),
    attemptToken: v.string(),
    state: v.union(v.literal('succeeded'), v.literal('failed'), v.literal('notFound')),
    errorCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('metadataRefreshRequests')
      .withIndex('by_key', (q) => q.eq('key', args.key))
      .unique();
    if (!row || row.attemptToken !== args.attemptToken) return false;
    const completedAt = Date.now();
    await ctx.db.patch(row._id, {
      state: args.state,
      completedAt,
      expiresAt: completedAt,
      retryAt: args.state === 'failed' ? completedAt + FAILED_TOUCH_BACKOFF_MS : undefined,
      ...(args.errorCode ? { errorCode: args.errorCode } : { errorCode: undefined }),
    });
    return true;
  },
});

export const completeRefreshRequests = internalMutation({
  args: {
    attemptToken: v.string(),
    outcomes: v.array(refreshOutcomeValidator),
  },
  handler: async (ctx, { attemptToken, outcomes }) => {
    const now = Date.now();
    const rows = await Promise.all(
      outcomes.map((outcome) =>
        ctx.db
          .query('metadataRefreshRequests')
          .withIndex('by_key', (query) => query.eq('key', outcome.key))
          .unique(),
      ),
    );
    if (rows.some((row) => !row || row.attemptToken !== attemptToken)) return false;
    for (const [index, row] of rows.entries()) {
      const outcome = outcomes[index]!;
      await ctx.db.patch(row!._id, {
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

/** Transfers pending touch rows to the synchronous lease holder. */
export const adoptRefreshRequests = internalMutation({
  args: {
    keys: v.array(v.string()),
    attemptToken: v.string(),
    leaseKey: v.string(),
    leaseToken: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const lease = await ctx.db
      .query('metadataRefreshLeases')
      .withIndex('by_key', (query) => query.eq('key', args.leaseKey))
      .unique();
    if (!lease || lease.token !== args.leaseToken || lease.expiresAt <= now) return [];
    const adopted: string[] = [];
    for (const key of new Set(args.keys)) {
      const row = await ctx.db
        .query('metadataRefreshRequests')
        .withIndex('by_key', (query) => query.eq('key', key))
        .unique();
      if (!row || row.state !== 'inFlight') continue;
      await ctx.db.patch(row._id, {
        attemptToken: args.attemptToken,
        expiresAt: lease.expiresAt,
        completedAt: undefined,
        errorCode: undefined,
        retryAt: undefined,
      });
      adopted.push(key);
    }
    return adopted;
  },
});

/** Converts a lost scheduled lease into success when another writer already made its keys fresh. */
export const settleScheduledRefresh = internalMutation({
  args: {
    mediaType,
    tmdbId: v.number(),
    season: v.optional(v.number()),
    keys: v.array(v.string()),
    attemptToken: v.string(),
    errorCode: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const rows = await Promise.all(
      args.keys.map((key) =>
        ctx.db
          .query('metadataRefreshRequests')
          .withIndex('by_key', (query) => query.eq('key', key))
          .unique(),
      ),
    );
    const owned = rows.flatMap((row, index) =>
      row?.state === 'inFlight' && row.attemptToken === args.attemptToken
        ? [{ row, key: args.keys[index]! }]
        : [],
    );
    if (owned.length === 0) return 'superseded' as const;
    const leaseKey = refreshLeaseKey(args.mediaType, args.tmdbId);
    const [lease, mapping, title, seasonParent] = await Promise.all([
      ctx.db
        .query('metadataRefreshLeases')
        .withIndex('by_key', (query) => query.eq('key', leaseKey))
        .unique(),
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
    if (lease && lease.expiresAt > now) {
      if (lease.token !== `scheduled:${args.attemptToken}`) return 'superseded' as const;
      // Release our own failed attempt inside the same transaction that decides
      // whether its request rows may fail. A synchronous claimant can therefore
      // never slip between the lease check and the row transition.
      await ctx.db.delete(lease._id);
    }
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
    if (
      owned.some(({ row, key }) =>
        key.startsWith('season:')
          ? !seasonVisible || (seasonParent?.refreshedAt ?? 0) < row.lastRequestedAt
          : !titleVisible || (title?.refreshedAt ?? 0) < row.lastRequestedAt,
      )
    ) {
      for (const { row } of owned)
        await ctx.db.patch(row._id, {
          state: 'failed',
          completedAt: now,
          expiresAt: now,
          retryAt: now + FAILED_TOUCH_BACKOFF_MS,
          errorCode: args.errorCode,
        });
      return 'failed' as const;
    }
    const completedAt = now;
    for (const { row } of owned)
      await ctx.db.patch(row._id, {
        state: 'succeeded',
        completedAt,
        expiresAt: completedAt,
        errorCode: undefined,
        retryAt: undefined,
      });
    return 'fresh' as const;
  },
});
