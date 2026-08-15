import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalAction, type ActionCtx } from './_generated/server';
import { getClerkUserId } from './clerkAuth';
import { releasedEpisodes } from './episodeAvailability';
import { refreshLeaseKey, requestKey } from './resolvedMetadataRequests.impl';
import { resolveAndCommitCanonical } from './resolvedMetadataSeasonResolution.impl';
import {
  cleanEpisode,
  mediaType,
  mergeEpisodes,
  mergeTitle,
  PARTIAL_RETRY_MS,
  REFRESH_LEASE_MS,
  REFRESH_WAIT_MS,
  requireUser,
  TITLE_FRESH_MS,
  type MediaType,
  type ProviderAnime,
  type ProviderTitle,
  type ResolvedTitle,
} from './resolvedMetadataShared.impl';
import { hideResolvedEmptySeasons } from './seasonNames';
import { type AssembledSeason, type ResolvedEpisode } from './seasonStorage';

export async function authorizeRefresh(ctx: { runMutation: Function }, userId: string) {
  const allowed = await ctx.runMutation(internal.tmdb.consumeThrottle, {
    key: `resolved:${userId}`,
  });
  if (!allowed) throw new Error('Too many metadata refreshes — try again shortly');
}

export type ProviderOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

export const settle = async <T>(promise: Promise<T>): Promise<ProviderOutcome<T>> => {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
};

export const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export const errorCode = (error: unknown) => {
  if (error instanceof ConvexError && typeof error.data === 'object' && error.data !== null) {
    const code = Reflect.get(error.data, 'code');
    if (typeof code === 'string') return code;
  }
  return error instanceof Error ? error.name || 'error' : 'unknown';
};

export const titleIsFresh = (title: Doc<'resolvedTitles'> | null) =>
  !!title && Date.now() < title.refreshAfter;

export const seasonIsFresh = (season: AssembledSeason | null) =>
  !!season && Date.now() < season.refreshAfter;

export const validateId = (name: string, value: number, max = 2 ** 31) => {
  if (!Number.isInteger(value) || value < 0 || value > max)
    throw new Error(`${name} must be a non-negative integer no greater than ${max}`);
};

export const animeFromCurrent = (current: Doc<'resolvedTitles'> | null): ProviderAnime | null =>
  current?.metadataProvider === 'tvdb' && current.tvdbId && current.seasonOrder
    ? {
        tvdbId: current.tvdbId,
        firstAirDate: current.firstAirDate,
        episodeRunTime: current.episodeRunTime,
        genres: current.genres,
        order: current.seasonOrder,
        seasons: current.seasons,
      }
    : null;

export async function resolveFreshTitle(
  ctx: ActionCtx,
  args: { mediaType: MediaType; tmdbId: number; title?: string },
  current: Doc<'resolvedTitles'> | null,
  mapping: Doc<'titleMappings'> | null,
  loadSelectedSeason = true,
  force = false,
  requestedSeason?: number,
) {
  const manuallyPinnedMapping =
    mapping?.source === 'manual' &&
    mapping.tvdbId !== undefined &&
    mapping.seasonOrder !== undefined
      ? mapping
      : null;
  const knownTvdbId = mapping?.tvdbId;
  const manualWithoutTvdbIdentity = mapping?.source === 'manual' && !manuallyPinnedMapping;
  const tmdbPromise = ctx.runAction(
    args.mediaType === 'movie' ? internal.tmdb.refreshMovieDetails : internal.tmdb.refreshTvDetails,
    { tmdbId: args.tmdbId, force },
  ) as Promise<ProviderTitle>;
  const animePromise: Promise<ProviderOutcome<ProviderAnime | null>> =
    args.mediaType === 'tv'
      ? manualWithoutTvdbIdentity
        ? Promise.resolve({ ok: true, value: null })
        : tmdbPromise.then((tmdb) =>
            settle(
              ctx.runAction(
                knownTvdbId ? internal.tvdb.refreshAnimeWithMapping : internal.tvdb.refreshAnime,
                {
                  tmdbId: args.tmdbId,
                  title: tmdb.title,
                  ...(tmdb.originalTitle && { originalTitle: tmdb.originalTitle }),
                  force,
                  ...(requestedSeason !== undefined && { requestedSeason }),
                  ...(knownTvdbId && {
                    tvdbId: knownTvdbId,
                    ...(manuallyPinnedMapping && {
                      order: manuallyPinnedMapping.seasonOrder,
                    }),
                  }),
                },
              ) as Promise<ProviderAnime | null>,
            ),
          )
      : Promise.resolve({ ok: true, value: null });
  const [tmdb, animeResult] = await Promise.all([tmdbPromise, animePromise]);
  let partial = !animeResult.ok;
  let partialError = animeResult.ok ? undefined : animeResult.error;
  let anime = animeResult.ok ? animeResult.value : animeFromCurrent(current);
  if (animeResult.ok && animeResult.value === null && current?.metadataProvider === 'tvdb') {
    anime = animeFromCurrent(current);
    partial = true;
    partialError = new Error('TVDB mapping disappeared during refresh');
  }
  const seasons = anime?.seasons.length ? anime.seasons : (tmdb.seasons ?? []);
  const selectedSeason = anime?.selectedSeason ?? seasons.find((entry) => entry.season > 0)?.season;
  const tmdbSeasonResult: ProviderOutcome<ResolvedEpisode[]> =
    loadSelectedSeason && args.mediaType === 'tv' && selectedSeason !== undefined
      ? await settle(
          ctx.runAction(internal.tmdb.refreshSeasonDetails, {
            tmdbId: args.tmdbId,
            season: selectedSeason,
            force,
          }) as Promise<ResolvedEpisode[]>,
        )
      : { ok: true, value: [] };
  if (!tmdbSeasonResult.ok) {
    partial = true;
    partialError ??= tmdbSeasonResult.error;
  }
  const tmdbEpisodes = tmdbSeasonResult.ok ? tmdbSeasonResult.value : [];
  const refreshedAt = Date.now();
  const value = mergeTitle(
    args.tmdbId,
    args.mediaType,
    tmdb,
    anime,
    refreshedAt,
    refreshedAt + (partial ? PARTIAL_RETRY_MS : TITLE_FRESH_MS),
  );
  if (args.mediaType === 'tv') {
    const resolvedSeasonCounts = (await ctx.runQuery(
      internal.resolvedMetadata.readResolvedSeasonCounts,
      { tmdbId: args.tmdbId },
    )) as { season: number; episodeCount: number }[];
    value.seasons = hideResolvedEmptySeasons(value.seasons, resolvedSeasonCounts);
  }
  return {
    value,
    partial,
    partialError,
    selectedSeason,
    selectedEpisodes: anime
      ? mergeEpisodes(anime.selectedEpisodes ?? [], tmdbEpisodes)
      : releasedEpisodes(tmdbEpisodes).map(cleanEpisode),
  };
}

export async function waitForTitle(
  ctx: ActionCtx,
  args: { mediaType: MediaType; tmdbId: number },
  previous: Doc<'resolvedTitles'> | null,
) {
  const deadline = Date.now() + REFRESH_WAIT_MS;
  while (Date.now() < deadline) {
    await pause(150);
    const next: Doc<'resolvedTitles'> | null = await ctx.runQuery(
      internal.resolvedMetadata.readTitle,
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

export async function getOrRefreshTitle(
  ctx: ActionCtx & Parameters<typeof getClerkUserId>[0],
  args: { mediaType: MediaType; tmdbId: number; title: string },
  userIdOverride?: Id<'users'>,
) {
  validateId('tmdbId', args.tmdbId);
  if (args.title.length > 500) throw new Error('Title must be no longer than 500 characters');
  const userId = userIdOverride ?? (await requireUser(ctx));
  const current: Doc<'resolvedTitles'> | null = await ctx.runQuery(
    internal.resolvedMetadata.readTitle,
    { mediaType: args.mediaType, tmdbId: args.tmdbId },
  );
  if (titleIsFresh(current)) return current!;
  const key = refreshLeaseKey(args.mediaType, args.tmdbId);
  const token = `synchronous:title:${Date.now()}:${crypto.randomUUID()}`;
  const claimed = await ctx.runMutation(internal.resolvedMetadata.claimRefresh, {
    key,
    token,
    leaseMs: REFRESH_LEASE_MS,
  });
  if (!claimed) {
    if (current) return current;
    const next = await waitForTitle(ctx, args, current);
    if (next) return next;
    throw new ConvexError({ code: 'refresh_in_progress', retryable: true });
  }
  try {
    await ctx.runMutation(internal.resolvedMetadata.admitSynchronousRefresh, {
      userId,
      keys: [requestKey(args.mediaType, args.tmdbId)],
    });
  } catch (error) {
    await ctx
      .runMutation(internal.resolvedMetadata.releaseRefresh, { key, token })
      .catch(() => undefined);
    throw error;
  }
  const adoptedKeys = await ctx.runMutation(internal.resolvedMetadata.adoptRefreshRequests, {
    keys: [requestKey(args.mediaType, args.tmdbId)],
    attemptToken: token,
    leaseKey: key,
    leaseToken: token,
  });
  let failureFinalized = false;
  const finalizeFailure = async (error: unknown) => {
    failureFinalized = true;
    await ctx.runMutation(internal.resolvedMetadata.failSynchronousRefresh, {
      leaseKey: key,
      attemptToken: token,
      errorCode: errorCode(error),
    });
  };
  try {
    await authorizeRefresh(ctx, String(userId));
    const result = await resolveAndCommitCanonical(ctx, {
      ...args,
      force: false,
      includeSelectedSeason: true,
      keys: adoptedKeys,
      attemptToken: token,
      leaseKey: key,
      leaseToken: token,
    });
    if (!result.committed) {
      const next = await waitForTitle(ctx, args, current);
      const superseded = new ConvexError({ code: 'refresh_superseded', retryable: true });
      await finalizeFailure(superseded);
      if (next) return next;
      throw superseded;
    }
    return result.title;
  } catch (error) {
    if (!failureFinalized) await finalizeFailure(error);
    if (current) return current;
    throw error;
  } finally {
    if (!failureFinalized)
      await ctx
        .runMutation(internal.resolvedMetadata.releaseRefresh, { key, token })
        .catch(() => undefined);
  }
}

export const resolveTitleForUser = internalAction({
  args: { userId: v.id('users'), mediaType, tmdbId: v.number(), title: v.string() },
  handler: (ctx, { userId, ...args }): Promise<ResolvedTitle> =>
    getOrRefreshTitle(ctx, args, userId),
});
