import { v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { mutation, type MutationCtx } from '../_generated/server';
import { refreshResultValidator } from '../publicValidators';
import { consumeRefreshAdmission, refreshLeaseKey, requestKey, seasonRequestKey } from './requests';
import {
  DEBOUNCE_MS,
  FAILED_TOUCH_BACKOFF_MS,
  FORCE_DEBOUNCE_MS,
  mediaType,
  REQUEST_LEASE_MS,
  requireUser,
  type MediaType,
} from './shared';
import { validateId } from './titleResolution';

export async function requestRefresh(
  ctx: MutationCtx,
  args: {
    userId: Id<'users'>;
    mediaType: MediaType;
    tmdbId: number;
    title?: string;
    season?: number;
    force?: boolean;
  },
) {
  const now = Date.now();
  const keys = [
    requestKey(args.mediaType, args.tmdbId),
    ...(args.season !== undefined ? [seasonRequestKey(args.tmdbId, args.season)] : []),
  ];
  const rows = await Promise.all(
    keys.map((key) =>
      ctx.db
        .query('metadataRefreshRequests')
        .withIndex('by_key', (q) => q.eq('key', key))
        .unique(),
    ),
  );

  const decideFromRequestRow = (row: Doc<'metadataRefreshRequests'> | null) => {
    if (row?.state === 'notFound')
      return {
        scheduled: false as const,
        reason: 'notFound' as const,
        expiresAt: row.expiresAt,
        delayMs: 0,
      };
    if (row?.state === 'inFlight' && row.expiresAt > now)
      return {
        scheduled: false as const,
        reason: 'inFlight' as const,
        expiresAt: row.expiresAt,
        delayMs: row.expiresAt - now,
      };
    const failedUntil =
      row?.state === 'failed'
        ? (row.retryAt ?? (row.completedAt ?? row.lastRequestedAt) + FAILED_TOUCH_BACKOFF_MS)
        : 0;
    if (!args.force && failedUntil > now)
      return {
        scheduled: false as const,
        reason: 'backoff' as const,
        expiresAt: failedUntil,
        retryAt: failedUntil,
        delayMs: failedUntil - now,
      };
    if (args.force && (row?.lastRequestedAt ?? 0) > now - FORCE_DEBOUNCE_MS)
      return {
        scheduled: false as const,
        reason: 'debounced' as const,
        expiresAt: (row?.lastRequestedAt ?? now) + FORCE_DEBOUNCE_MS,
        delayMs: (row?.lastRequestedAt ?? now) + FORCE_DEBOUNCE_MS - now,
      };
    return undefined;
  };
  const titleRowDecision = decideFromRequestRow(rows[0]);
  const seasonRowDecision = args.season === undefined ? undefined : decideFromRequestRow(rows[1]);
  const combineRejectedDecisions = (
    titleDecision: NonNullable<typeof titleRowDecision>,
    seasonDecision?: NonNullable<typeof seasonRowDecision>,
  ) => {
    if (args.season === undefined) return titleDecision;
    return {
      scheduled: false as const,
      title: titleDecision,
      season: seasonDecision!,
      expiresAt: Math.max(titleDecision.expiresAt, seasonDecision!.expiresAt),
      delayMs: Math.max(titleDecision.delayMs, seasonDecision!.delayMs),
    };
  };
  if (titleRowDecision && (args.season === undefined || seasonRowDecision))
    return combineRejectedDecisions(titleRowDecision, seasonRowDecision);

  const writeRequest = async (
    key: string,
    row: Doc<'metadataRefreshRequests'> | null,
    attemptToken: string,
    expiresAt: number,
  ) => {
    const next = {
      key,
      state: 'inFlight' as const,
      lastRequestedAt: now,
      attemptToken,
      expiresAt,
      retryAt: undefined,
    };
    if (row) await ctx.db.replace(row._id, next);
    else await ctx.db.insert('metadataRefreshRequests', next);
  };

  const activeLease = await ctx.db
    .query('metadataRefreshLeases')
    .withIndex('by_key', (query) => query.eq('key', refreshLeaseKey(args.mediaType, args.tmdbId)))
    .unique();
  if (activeLease && activeLease.expiresAt > now) {
    const scheduledAttemptToken = activeLease.token.startsWith('scheduled:')
      ? activeLease.token.slice('scheduled:'.length)
      : undefined;
    const scheduledRequests = scheduledAttemptToken
      ? await ctx.db
          .query('metadataRefreshRequests')
          .withIndex('by_attempt_token', (query) => query.eq('attemptToken', scheduledAttemptToken))
          .take(2)
      : [];
    const scheduledSeasonOnlyLease =
      scheduledRequests.some((request) => request.key.startsWith('season:')) &&
      scheduledRequests.every((request) => !request.key.startsWith('title:'));
    const leaseDecision = {
      scheduled: false as const,
      reason: 'inFlight' as const,
      expiresAt: activeLease.expiresAt,
      delayMs: activeLease.expiresAt - now,
    };
    const titleDecision = titleRowDecision ?? leaseDecision;
    const seasonDecision =
      args.season === undefined ? undefined : (seasonRowDecision ?? leaseDecision);
    if (activeLease.token.startsWith('synchronous:')) {
      // A synchronous title action can adopt its title and whichever selected
      // season provider discovery chooses. A season-only action
      // gives a newly arriving title touch its own orchestrator instead.
      // Admission happens before any row is written, so a rejected touch leaves
      // no request row behind.
      const admittedRows = [
        ...(!titleRowDecision ? [{ index: 0, key: keys[0] }] : []),
        ...(args.season !== undefined && !seasonRowDecision ? [{ index: 1, key: keys[1] }] : []),
      ];
      await consumeRefreshAdmission(
        ctx,
        args.userId,
        admittedRows.filter(({ index }) => !rows[index]).length,
      );
      let independentlyScheduledTitle:
        { scheduled: true; attemptToken: string; expiresAt: number; delayMs: number } | undefined;
      if (!titleRowDecision) {
        if (activeLease.token.startsWith('synchronous:season:')) {
          const attemptToken = `${now}:title:${crypto.randomUUID()}`;
          const expiresAt = now + REQUEST_LEASE_MS;
          await writeRequest(keys[0], rows[0], attemptToken, expiresAt);
          await ctx.scheduler.runAfter(
            0,
            internal.resolvedMetadata.orchestration.orchestrateRefresh,
            {
              userId: args.userId,
              mediaType: args.mediaType,
              tmdbId: args.tmdbId,
              ...(args.title !== undefined && { title: args.title }),
              ...(args.force !== undefined && { force: args.force }),
              keys: [keys[0]],
              attemptToken,
            },
          );
          independentlyScheduledTitle = {
            scheduled: true,
            attemptToken,
            expiresAt,
            delayMs: expiresAt - now,
          };
        } else await writeRequest(keys[0], rows[0], activeLease.token, activeLease.expiresAt);
      }
      if (args.season !== undefined && !seasonRowDecision) {
        const attemptToken = `${now}:season:${crypto.randomUUID()}`;
        const expiresAt = now + REQUEST_LEASE_MS;
        await writeRequest(keys[1], rows[1], attemptToken, expiresAt);
        await ctx.scheduler.runAfter(
          0,
          internal.resolvedMetadata.orchestration.orchestrateSeasonRefresh,
          {
            userId: args.userId,
            tmdbId: args.tmdbId,
            season: args.season,
            ...(args.force !== undefined && { force: args.force }),
            key: keys[1],
            attemptToken,
          },
        );
        const scheduledSeason = {
          scheduled: true as const,
          attemptToken,
          expiresAt,
          delayMs: expiresAt - now,
        };
        const scheduledTitle = independentlyScheduledTitle ?? titleDecision;
        return {
          scheduled: true,
          title: scheduledTitle,
          season: scheduledSeason,
          expiresAt: Math.max(scheduledTitle.expiresAt, scheduledSeason.expiresAt),
          delayMs: Math.max(scheduledTitle.delayMs, scheduledSeason.delayMs),
        };
      }
      if (independentlyScheduledTitle) {
        if (args.season === undefined) return independentlyScheduledTitle;
        return {
          scheduled: true,
          title: independentlyScheduledTitle,
          season: seasonDecision!,
          expiresAt: Math.max(independentlyScheduledTitle.expiresAt, seasonDecision!.expiresAt),
          delayMs: Math.max(independentlyScheduledTitle.delayMs, seasonDecision!.delayMs),
        };
      }
    } else if (!titleRowDecision && scheduledSeasonOnlyLease) {
      // A season-only scheduled holder can only season-patch. Give a colliding
      // title touch its own durable request and orchestrator so it waits for the
      // shared lease and eventually performs the title refresh.
      await consumeRefreshAdmission(
        ctx,
        args.userId,
        Number(!rows[0]) + Number(args.season !== undefined && !seasonRowDecision && !rows[1]),
      );
      const titleAttemptToken = `${now}:title:${crypto.randomUUID()}`;
      const titleExpiresAt = now + REQUEST_LEASE_MS;
      await writeRequest(keys[0], rows[0], titleAttemptToken, titleExpiresAt);
      await ctx.scheduler.runAfter(0, internal.resolvedMetadata.orchestration.orchestrateRefresh, {
        userId: args.userId,
        mediaType: args.mediaType,
        tmdbId: args.tmdbId,
        ...(args.title !== undefined && { title: args.title }),
        ...(args.force !== undefined && { force: args.force }),
        keys: [keys[0]],
        attemptToken: titleAttemptToken,
      });
      const scheduledTitle = {
        scheduled: true as const,
        attemptToken: titleAttemptToken,
        expiresAt: titleExpiresAt,
        delayMs: titleExpiresAt - now,
      };
      if (args.season === undefined) return scheduledTitle;

      if (!seasonRowDecision) {
        const seasonAttemptToken = `${now}:season:${crypto.randomUUID()}`;
        const seasonExpiresAt = now + REQUEST_LEASE_MS;
        await writeRequest(keys[1], rows[1], seasonAttemptToken, seasonExpiresAt);
        await ctx.scheduler.runAfter(
          0,
          internal.resolvedMetadata.orchestration.orchestrateSeasonRefresh,
          {
            userId: args.userId,
            tmdbId: args.tmdbId,
            season: args.season,
            ...(args.force !== undefined && { force: args.force }),
            key: keys[1],
            attemptToken: seasonAttemptToken,
          },
        );
        const scheduledSeason = {
          scheduled: true,
          attemptToken: seasonAttemptToken,
          expiresAt: seasonExpiresAt,
          delayMs: seasonExpiresAt - now,
        };
        return {
          scheduled: true,
          title: scheduledTitle,
          season: scheduledSeason,
          expiresAt: Math.max(scheduledTitle.expiresAt, scheduledSeason.expiresAt),
          delayMs: Math.max(scheduledTitle.delayMs, scheduledSeason.delayMs),
        };
      }
      return {
        scheduled: true,
        title: scheduledTitle,
        season: seasonDecision!,
        expiresAt: Math.max(scheduledTitle.expiresAt, seasonDecision!.expiresAt),
        delayMs: Math.max(scheduledTitle.delayMs, seasonDecision!.delayMs),
      };
    } else if (args.season !== undefined && !seasonRowDecision) {
      // A scheduled title/season holder cannot adopt a newly requested sibling
      // season. Persist and orchestrate it independently so it survives this
      // mutation and waits for the shared title lease instead of being stranded.
      await consumeRefreshAdmission(ctx, args.userId, rows[1] ? 0 : 1);
      const attemptToken = `${now}:season:${crypto.randomUUID()}`;
      const expiresAt = now + REQUEST_LEASE_MS;
      await writeRequest(keys[1], rows[1], attemptToken, expiresAt);
      await ctx.scheduler.runAfter(
        0,
        internal.resolvedMetadata.orchestration.orchestrateSeasonRefresh,
        {
          userId: args.userId,
          tmdbId: args.tmdbId,
          season: args.season,
          ...(args.force !== undefined && { force: args.force }),
          key: keys[1],
          attemptToken,
        },
      );
      const scheduledSeason = {
        scheduled: true as const,
        attemptToken,
        expiresAt,
        delayMs: expiresAt - now,
      };
      return {
        scheduled: true,
        title: titleDecision,
        season: scheduledSeason,
        expiresAt: Math.max(titleDecision.expiresAt, scheduledSeason.expiresAt),
        delayMs: Math.max(titleDecision.delayMs, scheduledSeason.delayMs),
      };
    }
    return combineRejectedDecisions(titleDecision, seasonDecision);
  }

  // Successful debounce visibility only needs canonical parent rows. In
  // particular, touch admission never assembles or reads season chunks.
  const [mapping, storedTitle, storedSeasonParent] = await Promise.all([
    ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', args.mediaType).eq('tmdbId', args.tmdbId))
      .unique(),
    ctx.db
      .query('resolvedTitles')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', args.mediaType).eq('tmdbId', args.tmdbId))
      .unique(),
    args.season === undefined
      ? Promise.resolve(null)
      : ctx.db
          .query('resolvedSeasons')
          .withIndex('by_tmdb_season', (q) =>
            q.eq('tmdbId', args.tmdbId).eq('season', args.season!),
          )
          .unique(),
  ]);
  const titleVisible =
    !!storedTitle &&
    (mapping?.orderEpoch === undefined || storedTitle.orderEpoch === mapping.orderEpoch);
  const seasonVisible =
    !!mapping &&
    !!storedSeasonParent &&
    storedSeasonParent.orderEpoch === mapping.orderEpoch &&
    storedSeasonParent.chunkCount !== undefined &&
    storedSeasonParent.seasonVersion !== undefined &&
    storedSeasonParent.chunksComplete === true;
  const decideVisibleKey = (
    row: Doc<'metadataRefreshRequests'> | null,
    rowDecision: ReturnType<typeof decideFromRequestRow>,
    dataVisible: boolean,
  ) => {
    if (rowDecision) return rowDecision;
    const cooldown = args.force ? FORCE_DEBOUNCE_MS : DEBOUNCE_MS;
    if (dataVisible && row?.state === 'succeeded' && (row.completedAt ?? 0) > now - cooldown)
      return {
        scheduled: false as const,
        reason: 'debounced' as const,
        expiresAt: (row.completedAt ?? now) + cooldown,
        delayMs: (row.completedAt ?? now) + cooldown - now,
      };
    return { scheduled: true as const };
  };

  const titleDecision = decideVisibleKey(rows[0], titleRowDecision, titleVisible);
  const seasonDecision =
    args.season === undefined
      ? undefined
      : decideVisibleKey(rows[1], seasonRowDecision, seasonVisible);
  if (!titleDecision.scheduled && !seasonDecision?.scheduled) {
    if (args.season === undefined) return titleDecision;
    return {
      scheduled: false,
      title: titleDecision,
      season: seasonDecision!,
      expiresAt: Math.max(titleDecision.expiresAt, seasonDecision!.expiresAt),
      delayMs: Math.max(titleDecision.delayMs, seasonDecision!.delayMs),
    };
  }

  // The state/debounce ingress guard above is intentionally read-only. Only work
  // that can schedule an orchestrator consumes the shared throttle budgets.
  const newKeyCount =
    Number(!rows[0] && !titleVisible) +
    Number(args.season !== undefined && !rows[1] && !seasonVisible);
  await consumeRefreshAdmission(ctx, args.userId, newKeyCount);

  const expiresAt = now + REQUEST_LEASE_MS;

  // A title refresh owns the selected season as part of the same attempt, even
  // when that season was otherwise fresh. Both request rows and all canonical
  // documents are completed by the one commitRefresh transaction.
  if (titleDecision.scheduled) {
    const attemptToken = `${now}:title:${crypto.randomUUID()}`;
    const combinedSeason =
      args.season !== undefined &&
      seasonRowDecision?.reason !== 'inFlight' &&
      seasonRowDecision?.reason !== 'backoff';
    await writeRequest(keys[0], rows[0], attemptToken, expiresAt);
    if (combinedSeason) await writeRequest(keys[1], rows[1], attemptToken, expiresAt);
    const claimedKeys = [keys[0], ...(combinedSeason ? [keys[1]] : [])];
    await ctx.scheduler.runAfter(0, internal.resolvedMetadata.orchestration.orchestrateRefresh, {
      userId: args.userId,
      mediaType: args.mediaType,
      tmdbId: args.tmdbId,
      ...(args.title !== undefined && { title: args.title }),
      ...(combinedSeason && { season: args.season }),
      ...(args.force !== undefined && { force: args.force }),
      keys: claimedKeys,
      attemptToken,
    });
    const titleResult = {
      scheduled: true as const,
      attemptToken,
      expiresAt,
      delayMs: expiresAt - now,
    };
    if (args.season === undefined) return titleResult;
    const seasonResult = combinedSeason
      ? { scheduled: true as const, attemptToken, expiresAt, delayMs: expiresAt - now }
      : seasonRowDecision!;
    return {
      scheduled: true,
      title: titleResult,
      season: seasonResult,
      expiresAt: Math.max(titleResult.expiresAt, seasonResult.expiresAt),
      delayMs: Math.max(titleResult.delayMs, seasonResult.delayMs),
    };
  }

  // Round 2's title-in-flight collision path remains season-scoped, but its
  // orchestrator now commits through the same atomic mutation as combined work.
  const attemptToken = `${now}:season:${crypto.randomUUID()}`;
  await writeRequest(keys[1], rows[1], attemptToken, expiresAt);
  await ctx.scheduler.runAfter(
    0,
    internal.resolvedMetadata.orchestration.orchestrateSeasonRefresh,
    {
      userId: args.userId,
      tmdbId: args.tmdbId,
      season: args.season!,
      ...(args.force !== undefined && { force: args.force }),
      key: keys[1],
      attemptToken,
    },
  );
  const titleResult = titleDecision;
  const seasonResult = {
    scheduled: true as const,
    attemptToken,
    expiresAt,
    delayMs: expiresAt - now,
  };
  if (args.season === undefined) return titleResult;
  return {
    scheduled: true,
    title: titleResult,
    season: seasonResult,
    expiresAt: Math.max(titleResult.expiresAt, seasonResult.expiresAt),
    delayMs: Math.max(titleResult.delayMs, seasonResult.delayMs),
  };
}

export const touchItemView = mutation({
  args: { itemId: v.id('items'), season: v.optional(v.number()), force: v.optional(v.boolean()) },
  returns: refreshResultValidator,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const item = await ctx.db.get(args.itemId);
    if (!item || item.userId !== userId || item.deletingAt !== undefined)
      throw new Error('Item not found');
    if (args.season !== undefined) validateId('season', args.season, 10_000);
    return requestRefresh(ctx, {
      userId,
      mediaType: item.mediaType,
      tmdbId: item.tmdbId,
      title: item.title,
      season: args.season,
      force: args.force,
    });
  },
});

export const touchTitle = mutation({
  args: {
    mediaType,
    tmdbId: v.number(),
    title: v.optional(v.string()),
    season: v.optional(v.number()),
    force: v.optional(v.boolean()),
  },
  returns: refreshResultValidator,
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    validateId('tmdbId', args.tmdbId);
    const title = args.title?.trim();
    if (title !== undefined && (!title || title.length > 500))
      throw new Error('Title must be between 1 and 500 characters');
    if (args.season !== undefined) validateId('season', args.season, 10_000);
    if (args.mediaType === 'movie' && args.season !== undefined)
      throw new Error('Movies do not have seasons');
    return requestRefresh(ctx, { userId, ...args, ...(title !== undefined && { title }) });
  },
});
