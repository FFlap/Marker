import { ConvexError, v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { internalAction, type ActionCtx } from '../_generated/server';
import { getClerkUserId } from '../clerkAuth';
import { releasedEpisodes } from '../episodeAvailability';
import { mappingIdentity } from './publication';
import { refreshLeaseKey, requestKey, seasonRequestKey } from './requests';
import {
  cleanEpisode,
  mergeEpisodes,
  PARTIAL_RETRY_MS,
  REFRESH_LEASE_MS,
  REFRESH_WAIT_MS,
  requireUser,
  SEASON_FRESH_MS,
  type MediaType,
  type ResolvedTitle,
} from './shared';
import {
  authorizeRefresh,
  errorCode,
  pause,
  resolveFreshTitle,
  seasonIsFresh,
  settle,
  validateId,
  type ProviderOutcome,
} from './titleResolution';
import {
  assertMetadataMutationSize,
  episodeChunks,
  EPISODES_PER_CHUNK,
  type AssembledSeason,
  type PrechunkedSeason,
  type ResolvedEpisode,
} from '../seasonStorage';

export async function resolveFreshSeason(
  ctx: ActionCtx,
  args: { tmdbId: number; season: number },
  title: ResolvedTitle,
  current: AssembledSeason | null,
  force = false,
  preloadedTvdbEpisodes?: ResolvedEpisode[],
) {
  const tmdbPromise = settle(
    ctx.runAction(internal.tmdb.refreshSeasonDetails, { ...args, force }) as Promise<
      ResolvedEpisode[]
    >,
  );
  const tvdbPromise: Promise<ProviderOutcome<ResolvedEpisode[]>> | null =
    title.metadataProvider === 'tvdb' && title.tvdbId && title.seasonOrder
      ? preloadedTvdbEpisodes
        ? Promise.resolve({ ok: true as const, value: preloadedTvdbEpisodes })
        : settle(
            ctx.runAction(internal.tvdb.refreshSeason, {
              tvdbId: title.tvdbId,
              order: title.seasonOrder,
              season: args.season,
              force,
            }) as Promise<ResolvedEpisode[]>,
          )
      : null;
  const [tmdbResult, tvdbResult] = await Promise.all([
    tmdbPromise,
    tvdbPromise ?? Promise.resolve(null),
  ]);

  if (title.metadataProvider === 'tvdb' && tvdbResult && !tvdbResult.ok) {
    if (current)
      return {
        episodes: current.episodes,
        partial: true,
        persisted: false,
        error: tvdbResult.error,
      };
    throw tvdbResult.error;
  }
  if (title.metadataProvider === 'tmdb' && !tmdbResult.ok) {
    if (current)
      return {
        episodes: current.episodes,
        partial: true,
        persisted: false,
        error: tmdbResult.error,
      };
    throw tmdbResult.error;
  }

  const tmdbEpisodes = tmdbResult.ok ? tmdbResult.value : [];
  const tvdbEpisodes = tvdbResult?.ok ? tvdbResult.value : [];
  const episodes = tvdbEpisodes.length
    ? mergeEpisodes(tvdbEpisodes, tmdbEpisodes)
    : releasedEpisodes(tmdbEpisodes).map(cleanEpisode);
  const partial = !tmdbResult.ok;
  return { episodes, partial, persisted: true, error: undefined };
}

export function titleWriteForCapturedTitle(
  capturedTitleWasProvided: boolean,
  capturedTitleIsCurrent: boolean,
) {
  return capturedTitleWasProvided && capturedTitleIsCurrent
    ? ('seasonPatch' as const)
    : ('replace' as const);
}

/** Builds the epoch-stamped title/season pair and commits it through one mutation. */
export async function resolveAndCommitCanonical(
  ctx: ActionCtx,
  args: {
    mediaType: MediaType;
    tmdbId: number;
    title?: string;
    requestedSeason?: number;
    includeSelectedSeason?: boolean;
    force: boolean;
    keys: string[];
    attemptToken: string;
    leaseKey: string;
    leaseToken: string;
    currentTitle?: Doc<'resolvedTitles'>;
  },
) {
  const [queriedTitle, mapping] = await Promise.all([
    args.currentTitle
      ? Promise.resolve(args.currentTitle)
      : (ctx.runQuery(internal.resolvedMetadata.reads.readTitle, {
          mediaType: args.mediaType,
          tmdbId: args.tmdbId,
        }) as Promise<Doc<'resolvedTitles'> | null>),
    ctx.runQuery(internal.resolvedMetadata.reads.readTitleMapping, {
      mediaType: args.mediaType,
      tmdbId: args.tmdbId,
    }) as Promise<Doc<'titleMappings'> | null>,
  ]);
  const currentTitle =
    queriedTitle && queriedTitle.orderEpoch === (mapping?.orderEpoch ?? 0) ? queriedTitle : null;
  const titleResult =
    args.currentTitle && currentTitle
      ? {
          value: currentTitle,
          partial: false,
          partialError: undefined,
          selectedSeason: args.requestedSeason,
          selectedEpisodes: undefined,
        }
      : await resolveFreshTitle(
          ctx,
          { mediaType: args.mediaType, tmdbId: args.tmdbId, title: args.title },
          currentTitle,
          mapping,
          false,
          args.force,
          args.requestedSeason,
        );
  const reusedCapturedTitle = args.currentTitle !== undefined && currentTitle !== null;
  const discoveredIdentity: { tvdbId?: number; seasonOrder?: string } =
    titleResult.value.metadataProvider === 'tvdb'
      ? {
          ...(titleResult.value.tvdbId !== undefined && { tvdbId: titleResult.value.tvdbId }),
          ...(titleResult.value.seasonOrder !== undefined && {
            seasonOrder: titleResult.value.seasonOrder,
          }),
        }
      : {};
  const autoIdentityChanged =
    mapping?.source === 'auto' &&
    (mapping.tvdbId !== discoveredIdentity.tvdbId ||
      mapping.seasonOrder !== discoveredIdentity.seasonOrder);
  const autoMapping =
    args.mediaType === 'tv' && (!mapping || autoIdentityChanged)
      ? {
          tmdbId: args.tmdbId,
          mediaType: args.mediaType,
          ...discoveredIdentity,
          source: 'auto' as const,
          orderEpoch: mapping ? mapping.orderEpoch + 1 : 0,
          updatedAt: Date.now(),
        }
      : undefined;
  const effectiveMapping = autoMapping ?? mapping;
  const orderEpoch = effectiveMapping?.orderEpoch ?? 0;
  const {
    _id: _documentId,
    _creationTime: _creationTime,
    ...titleWithoutDocumentFields
  } = titleResult.value as ResolvedTitle & Partial<Doc<'resolvedTitles'>>;
  let title: ResolvedTitle = { ...titleWithoutDocumentFields, orderEpoch };
  const requestedSeason =
    args.requestedSeason ?? (args.includeSelectedSeason ? titleResult.selectedSeason : undefined);
  let season:
    | {
        tmdbId: number;
        season: number;
        metadataProvider: 'tmdb' | 'tvdb';
        episodes: ResolvedEpisode[];
        episodeCount: number;
        chunkCount: number;
        refreshedAt: number;
        refreshAfter?: number;
        orderEpoch: number;
      }
    | undefined;
  let seasonPayload:
    | {
        tmdbId: number;
        season: number;
        metadataProvider: 'tmdb' | 'tvdb';
        episodes: ResolvedEpisode[];
        refreshedAt: number;
        refreshAfter: number;
        orderEpoch: number;
      }
    | undefined;
  let seasonPartial = false;
  let seasonError: unknown;
  let seasonPersisted: boolean | undefined;
  const seasonNotFound =
    args.mediaType === 'tv' &&
    requestedSeason !== undefined &&
    !title.seasons.some((entry) => entry.season === requestedSeason);
  if (args.mediaType === 'tv' && requestedSeason !== undefined && !seasonNotFound) {
    const storedSeason: AssembledSeason | null = await ctx.runQuery(
      internal.resolvedMetadata.reads.readSeason,
      { tmdbId: args.tmdbId, season: requestedSeason },
    );
    const currentSeason = storedSeason;
    const seasonResult = await resolveFreshSeason(
      ctx,
      { tmdbId: args.tmdbId, season: requestedSeason },
      title,
      currentSeason,
      args.force,
      titleResult.selectedSeason === requestedSeason && titleResult.selectedEpisodes?.length
        ? titleResult.selectedEpisodes
        : undefined,
    );
    seasonPartial = seasonResult.partial;
    seasonError = seasonResult.error;
    seasonPersisted = seasonResult.persisted;
    const refreshedAt = Date.now();
    season = {
      tmdbId: args.tmdbId,
      season: requestedSeason,
      metadataProvider: title.metadataProvider,
      episodes: seasonResult.episodes,
      episodeCount: seasonResult.episodes.length,
      chunkCount: Math.ceil(seasonResult.episodes.length / EPISODES_PER_CHUNK),
      refreshedAt: seasonResult.persisted
        ? refreshedAt
        : (currentSeason?.refreshedAt ?? refreshedAt),
      refreshAfter: seasonResult.persisted
        ? refreshedAt + (seasonResult.partial ? PARTIAL_RETRY_MS : SEASON_FRESH_MS)
        : currentSeason?.refreshAfter,
      orderEpoch,
    };
    if (seasonResult.persisted) {
      seasonPayload = {
        tmdbId: args.tmdbId,
        season: requestedSeason,
        metadataProvider: title.metadataProvider,
        episodes: seasonResult.episodes,
        refreshedAt,
        refreshAfter: refreshedAt + (seasonResult.partial ? PARTIAL_RETRY_MS : SEASON_FRESH_MS),
        orderEpoch,
      };
      title = {
        ...title,
        seasons: title.seasons.map((entry) =>
          entry.season === requestedSeason
            ? { ...entry, episodeCount: seasonResult.episodes.length }
            : entry,
        ),
      };
    }
  }
  const mappingPayload = effectiveMapping
    ? {
        tmdbId: effectiveMapping.tmdbId,
        mediaType: effectiveMapping.mediaType,
        ...(effectiveMapping.tvdbId !== undefined && { tvdbId: effectiveMapping.tvdbId }),
        ...(effectiveMapping.seasonOrder !== undefined && {
          seasonOrder: effectiveMapping.seasonOrder,
        }),
        source: effectiveMapping.source,
        orderEpoch: effectiveMapping.orderEpoch,
        updatedAt: Date.now(),
      }
    : undefined;
  const candidateKeys = [
    requestKey(args.mediaType, args.tmdbId),
    ...(requestedSeason !== undefined ? [seasonRequestKey(args.tmdbId, requestedSeason)] : []),
  ];
  // A synchronous season read may reuse a captured title. In that case it can
  // still adopt a season touch that arrived during provider work,
  // but it must leave a late title touch with its scheduled title orchestrator.
  // If it adopted the title before provider work, currentTitle is deliberately
  // omitted by the caller and the title was actually refreshed above.
  const adoptableCandidateKeys =
    args.attemptToken.startsWith('synchronous:') && args.currentTitle !== undefined
      ? candidateKeys.filter((key) => key.startsWith('season:'))
      : candidateKeys;
  const synchronousKeys = args.attemptToken.startsWith('synchronous:')
    ? await ctx.runMutation(internal.resolvedMetadata.requests.adoptRefreshRequests, {
        keys: adoptableCandidateKeys,
        attemptToken: args.attemptToken,
        leaseKey: args.leaseKey,
        leaseToken: args.leaseToken,
      })
    : [];
  const claimedKeys = [...new Set([...args.keys, ...synchronousKeys])];
  const outcomes = claimedKeys.map((key) => {
    if (key.startsWith('season:') && seasonNotFound)
      return {
        key,
        state: 'notFound' as const,
        errorCode: 'season_not_found',
      };
    if (key.startsWith('season:') && seasonPersisted === false)
      return {
        key,
        state: 'failed' as const,
        errorCode: errorCode(seasonError ?? new Error('Season refresh was not persisted')),
      };
    return { key, state: 'succeeded' as const };
  });
  // Provider calls can outlive the ingress deadline. Renew both the ownership
  // lease and every currently attached row immediately before the first commit.
  // Adoptable candidate keys are used instead of the earlier adoption snapshot
  // so eligible touches that arrived during provider work receive the same
  // healthy deadline.
  await ctx.runMutation(internal.resolvedMetadata.requests.renewRefreshAttempt, {
    key: args.leaseKey,
    token: args.leaseToken,
    leaseMs: REFRESH_LEASE_MS,
    requestKeys: adoptableCandidateKeys,
    attemptToken: args.attemptToken,
  });
  const chunks = seasonPayload ? episodeChunks(seasonPayload.episodes) : undefined;
  const commitSeason: PrechunkedSeason | undefined = seasonPayload
    ? {
        tmdbId: seasonPayload.tmdbId,
        season: seasonPayload.season,
        metadataProvider: seasonPayload.metadataProvider,
        chunks: chunks!.slice(0, 1),
        episodeCount: seasonPayload.episodes.length,
        chunkCount: chunks!.length,
        refreshedAt: seasonPayload.refreshedAt,
        refreshAfter: seasonPayload.refreshAfter,
        orderEpoch: seasonPayload.orderEpoch,
      }
    : undefined;
  const coreArgs = {
    title,
    // A season orchestrator can discover that its captured title was invalidated
    // by a mapping change. In that case resolveFreshTitle produced a replacement
    // title and publication must replace the old-epoch document with it.
    titleWrite: titleWriteForCapturedTitle(args.currentTitle !== undefined, reusedCapturedTitle),
    season: commitSeason,
    mapping: mappingPayload,
    expectedMapping: mappingIdentity(mapping),
    outcomes,
    attemptToken: args.attemptToken,
    leaseKey: args.leaseKey,
    leaseToken: args.leaseToken,
  };
  assertMetadataMutationSize(coreArgs, 'commitRefresh');
  let commitStatus = await ctx.runMutation(
    internal.resolvedMetadata.publication.commitRefresh,
    coreArgs,
  );
  const seasonFailed = outcomes.some(
    (outcome) => outcome.key.startsWith('season:') && outcome.state === 'failed',
  );
  if (commitStatus === 'staged' && commitSeason && chunks && !seasonFailed) {
    for (let chunkIndex = 1; chunkIndex < chunks.length; chunkIndex += 1) {
      const appendArgs = {
        tmdbId: commitSeason.tmdbId,
        season: commitSeason.season,
        orderEpoch: commitSeason.orderEpoch,
        chunkIndex,
        episodes: chunks[chunkIndex]!,
        attemptToken: args.attemptToken,
      };
      assertMetadataMutationSize(appendArgs, 'appendRefreshSeasonChunk');
      const appended = await ctx.runMutation(
        internal.resolvedMetadata.publication.appendRefreshSeasonChunk,
        appendArgs,
      );
      if (!appended) throw new ConvexError({ code: 'refresh_superseded', retryable: true });
    }
    const expectedMapping = mappingIdentity(mapping);
    const finalizeArgs = {
      tmdbId: commitSeason.tmdbId,
      season: commitSeason.season,
      outcomes,
      expectedMapping,
      attemptToken: args.attemptToken,
      leaseKey: args.leaseKey,
      leaseToken: args.leaseToken,
    };
    await ctx.runMutation(internal.resolvedMetadata.requests.renewRefreshAttempt, {
      key: args.leaseKey,
      token: args.leaseToken,
      leaseMs: REFRESH_LEASE_MS,
      requestKeys: adoptableCandidateKeys,
      attemptToken: args.attemptToken,
    });
    assertMetadataMutationSize(finalizeArgs, 'finalizeRefreshSeason');
    commitStatus = await ctx.runMutation(
      internal.resolvedMetadata.publication.finalizeRefreshSeason,
      finalizeArgs,
    );
  }
  return {
    committed: commitStatus === true,
    commitStatus,
    title,
    season,
    partial: titleResult.partial || seasonPartial,
    error: titleResult.partialError ?? seasonError,
    seasonPersisted,
  };
}

export async function waitForSeason(
  ctx: ActionCtx,
  args: { tmdbId: number; season: number },
  previous: AssembledSeason | null,
) {
  const deadline = Date.now() + REFRESH_WAIT_MS;
  while (Date.now() < deadline) {
    await pause(150);
    const next: AssembledSeason | null = await ctx.runQuery(
      internal.resolvedMetadata.reads.readSeason,
      args,
    );
    if (
      next &&
      (!previous ||
        next.refreshedAt > previous.refreshedAt ||
        next.refreshAfter !== previous.refreshAfter)
    )
      return next;
  }
  return null;
}

export async function getOrRefreshSeason(
  ctx: ActionCtx & Parameters<typeof getClerkUserId>[0],
  args: { tmdbId: number; season: number },
  userIdOverride?: Id<'users'>,
) {
  validateId('tmdbId', args.tmdbId);
  validateId('season', args.season, 10_000);
  const userId = userIdOverride ?? (await requireUser(ctx));
  const current: AssembledSeason | null = await ctx.runQuery(
    internal.resolvedMetadata.reads.readSeason,
    args,
  );
  if (seasonIsFresh(current)) return current!.episodes.slice(0, EPISODES_PER_CHUNK);
  const titleBeforeLease: Doc<'resolvedTitles'> | null = await ctx.runQuery(
    internal.resolvedMetadata.reads.readTitle,
    { mediaType: 'tv', tmdbId: args.tmdbId },
  );
  if (!titleBeforeLease) throw new Error('Resolved title metadata is unavailable');
  const key = refreshLeaseKey('tv', args.tmdbId);
  const token = `synchronous:season:${Date.now()}:${crypto.randomUUID()}`;
  const claimed = await ctx.runMutation(internal.resolvedMetadata.requests.claimRefresh, {
    key,
    token,
    leaseMs: REFRESH_LEASE_MS,
  });
  if (!claimed) {
    if (current) return current.episodes.slice(0, EPISODES_PER_CHUNK);
    const next = await waitForSeason(ctx, args, current);
    if (next) return next.episodes.slice(0, EPISODES_PER_CHUNK);
    throw new ConvexError({ code: 'refresh_in_progress', retryable: true });
  }
  try {
    await ctx.runMutation(internal.resolvedMetadata.requests.admitSynchronousRefresh, {
      userId,
      keys: [requestKey('tv', args.tmdbId), seasonRequestKey(args.tmdbId, args.season)],
    });
  } catch (error) {
    await ctx
      .runMutation(internal.resolvedMetadata.requests.releaseRefresh, { key, token })
      .catch(() => undefined);
    throw error;
  }
  const adoptedKeys = await ctx.runMutation(
    internal.resolvedMetadata.requests.adoptRefreshRequests,
    {
      keys: [requestKey('tv', args.tmdbId), seasonRequestKey(args.tmdbId, args.season)],
      attemptToken: token,
      leaseKey: key,
      leaseToken: token,
    },
  );
  const adoptedTitle = adoptedKeys.includes(requestKey('tv', args.tmdbId));
  let failureFinalized = false;
  const finalizeFailure = async (error: unknown) => {
    failureFinalized = true;
    await ctx.runMutation(internal.resolvedMetadata.orchestration.failSynchronousRefresh, {
      leaseKey: key,
      attemptToken: token,
      errorCode: errorCode(error),
    });
  };
  try {
    await authorizeRefresh(ctx, String(userId));
    const title: Doc<'resolvedTitles'> | null = await ctx.runQuery(
      internal.resolvedMetadata.reads.readTitle,
      { mediaType: 'tv', tmdbId: args.tmdbId },
    );
    if (!title) throw new Error('Resolved title metadata is unavailable');
    const result = await resolveAndCommitCanonical(ctx, {
      mediaType: 'tv',
      tmdbId: args.tmdbId,
      title: title.title,
      requestedSeason: args.season,
      force: false,
      keys: adoptedKeys,
      attemptToken: token,
      leaseKey: key,
      leaseToken: token,
      // An already-pending title touch is safe to adopt only if this season
      // action performs the requested title refresh as well.
      ...(!adoptedTitle && { currentTitle: title }),
    });
    if (!result.committed) {
      const next = await waitForSeason(ctx, args, current);
      const superseded = new ConvexError({ code: 'refresh_superseded', retryable: true });
      await finalizeFailure(superseded);
      if (next) return next.episodes.slice(0, EPISODES_PER_CHUNK);
      throw superseded;
    }
    return (result.season?.episodes ?? current?.episodes ?? []).slice(0, EPISODES_PER_CHUNK);
  } catch (error) {
    if (!failureFinalized) await finalizeFailure(error);
    if (current) return current.episodes.slice(0, EPISODES_PER_CHUNK);
    throw error;
  } finally {
    if (!failureFinalized)
      await ctx
        .runMutation(internal.resolvedMetadata.requests.releaseRefresh, { key, token })
        .catch(() => undefined);
  }
}

export const resolveSeasonForUser = internalAction({
  args: { userId: v.id('users'), tmdbId: v.number(), season: v.number() },
  handler: (ctx, { userId, ...args }): Promise<ResolvedEpisode[]> =>
    getOrRefreshSeason(ctx, args, userId),
});
