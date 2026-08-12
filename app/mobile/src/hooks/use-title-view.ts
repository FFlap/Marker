import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

export type MetadataRequestState = {
  state?: 'inFlight' | 'succeeded' | 'failed' | 'notFound';
  errorCode?: string;
  expiresAt?: number;
  retryAt?: number;
  delayMs?: number;
};

type Args = { mediaType: 'movie' | 'tv'; tmdbId: number; title?: string; season?: number };
type TouchOptions = { season?: number; force?: boolean };

const EXPIRY_GRACE_MS = 1_000;
const FAILED_REPOLL_MIN_MS = 5_000;
const FAILED_REPOLL_MAX_MS = 5 * 60_000;

type TouchDecision = {
  reason?: string;
  mutationRejected?: boolean;
  retryAt?: number;
  expiresAt?: number;
  delayMs?: number;
  title?: TouchDecision;
  season?: TouchDecision;
};

const decisionForKey = (key: string, result: TouchDecision | undefined) =>
  key.startsWith('season:') ? (result?.season ?? result) : (result?.title ?? result);

/** Arms one recovery timer for one observed title or season request. */
function useMetadataExpiryTimer(
  key: string | undefined,
  requestState: MetadataRequestState | null | undefined,
  retouch: () => unknown,
) {
  const retouchRef = useRef(retouch);
  useEffect(() => {
    retouchRef.current = retouch;
  }, [retouch]);
  const state = requestState?.state;
  const delayMs = requestState?.delayMs;
  const [serverArm, setServerArm] = useState<{
    key: string;
    delayMs: number;
    reason: string;
    sourceState: MetadataRequestState['state'];
    sourceDelayMs?: number;
  }>();
  useEffect(() => {
    if (!key) return;
    const authoritativeArm =
      serverArm?.key === key &&
      serverArm.sourceState === state &&
      serverArm.sourceDelayMs === delayMs
        ? serverArm
        : undefined;
    const relativeDelay = authoritativeArm?.delayMs ?? delayMs;
    if ((state !== 'inFlight' && state !== 'failed') || relativeDelay === undefined) return;
    const armReason = authoritativeArm?.reason ?? state;
    const timerDelay = Math.max(
      state === 'failed' ? FAILED_REPOLL_MIN_MS : 0,
      relativeDelay + (armReason === 'inFlight' ? EXPIRY_GRACE_MS : 0),
    );
    const timer = setTimeout(
      () =>
        void Promise.resolve(retouchRef.current())
          .then((value) => {
            const decision = decisionForKey(key, value as TouchDecision | undefined);
            if (decision?.mutationRejected) {
              setServerArm({
                key,
                delayMs: Math.min(
                  FAILED_REPOLL_MAX_MS,
                  Math.max(FAILED_REPOLL_MIN_MS, timerDelay * 2),
                ),
                reason: 'mutationRejected',
                sourceState: state,
                sourceDelayMs: delayMs,
              });
              return;
            }
            if (
              decision?.delayMs === undefined ||
              (decision.reason !== 'backoff' && decision.reason !== 'inFlight')
            )
              return;
            setServerArm({
              key,
              delayMs: Math.max(0, decision.delayMs),
              reason: decision.reason,
              sourceState: state,
              sourceDelayMs: delayMs,
            });
          })
          .catch(() =>
            setServerArm({
              key,
              delayMs: Math.min(
                FAILED_REPOLL_MAX_MS,
                Math.max(FAILED_REPOLL_MIN_MS, timerDelay * 2),
              ),
              reason: 'mutationRejected',
              sourceState: state,
              sourceDelayMs: delayMs,
            }),
          ),
      timerDelay,
    );
    return () => clearTimeout(timer);
  }, [key, state, delayMs, serverArm]);
}

/** Coalesces the matching backoff produced by one combined title/season attempt. */
export function useMetadataRecoveryTimers(args: {
  titleKey: string | undefined;
  titleState: MetadataRequestState | null | undefined;
  seasonKey: string | undefined;
  seasonState: MetadataRequestState | null | undefined;
  retouchTitle: () => unknown;
  retouchSeason: () => unknown;
}) {
  const sharedRetry =
    args.titleState?.state === 'failed' &&
    args.seasonState?.state === 'failed' &&
    args.titleState.retryAt !== undefined &&
    args.titleState.retryAt === args.seasonState.retryAt;
  useMetadataExpiryTimer(
    sharedRetry && args.titleKey && args.seasonKey
      ? `combined:${args.titleKey}:${args.seasonKey}`
      : undefined,
    sharedRetry ? args.titleState : undefined,
    args.retouchSeason,
  );
  useMetadataExpiryTimer(
    sharedRetry ? undefined : args.titleKey,
    sharedRetry ? undefined : args.titleState,
    args.retouchTitle,
  );
  useMetadataExpiryTimer(
    sharedRetry ? undefined : args.seasonKey,
    sharedRetry ? undefined : args.seasonState,
    args.retouchSeason,
  );
}

/** Reactive title metadata plus the server-owned refresh request state. */
export function useTitleView(
  args: Args | undefined,
  itemId?: Id<'items'>,
  itemRequestState?: MetadataRequestState | null,
  autoRecovery = true,
) {
  const view = useQuery(
    api.resolvedMetadata.getTitleView,
    args ? { mediaType: args.mediaType, tmdbId: args.tmdbId } : 'skip',
  );
  const subscribedRequestState = useQuery(
    api.resolvedMetadata.getTitleRequestState,
    args ? { mediaType: args.mediaType, tmdbId: args.tmdbId } : 'skip',
  );
  const touch = useMutation(api.resolvedMetadata.touchTitle);
  const touchItem = useMutation(api.resolvedMetadata.touchItemView);
  const mediaType = args?.mediaType;
  const tmdbId = args?.tmdbId;
  const title = args?.title;
  const selectedSeason = args?.season;
  const key =
    mediaType && tmdbId !== undefined
      ? `${mediaType}:${tmdbId}`
      : itemId
        ? `item:${itemId}`
        : undefined;
  const activeRouteKey = useRef(key);
  const activeRequest = useRef<
    { routeKey: string; requestKey: string; generation: number } | undefined
  >(undefined);
  const requestGeneration = useRef(0);
  useEffect(() => {
    activeRouteKey.current = key;
  }, [key]);
  const [touchErrorState, setTouchErrorState] = useState<{
    routeKey: string;
    requestKey: string;
    generation: number;
    error: unknown;
  }>();
  const displayedRequestKey =
    mediaType && tmdbId !== undefined
      ? selectedSeason === undefined
        ? `title:${key}`
        : `season:${key}:${selectedSeason}`
      : undefined;
  const touchError =
    touchErrorState &&
    touchErrorState.routeKey === key &&
    (displayedRequestKey === undefined || touchErrorState.requestKey === displayedRequestKey)
      ? touchErrorState.error
      : undefined;

  const touchTitle = useCallback(
    async (options?: TouchOptions) => {
      if (!mediaType || tmdbId === undefined) return;
      const routeKey = `${mediaType}:${tmdbId}`;
      const effectiveSeason = options?.season ?? selectedSeason;
      const requestKey =
        effectiveSeason === undefined
          ? `title:${routeKey}`
          : `season:${routeKey}:${effectiveSeason}`;
      const generation = ++requestGeneration.current;
      activeRequest.current = { routeKey, requestKey, generation };
      setTouchErrorState(undefined);
      try {
        return await touch({
          mediaType,
          tmdbId,
          ...(title !== undefined && { title }),
          ...(effectiveSeason !== undefined && { season: effectiveSeason }),
          ...(options?.force !== undefined && { force: options.force }),
        });
      } catch (error) {
        const active = activeRequest.current;
        if (
          activeRouteKey.current === routeKey &&
          active?.routeKey === routeKey &&
          active.requestKey === requestKey &&
          active.generation === generation
        )
          setTouchErrorState({ routeKey, requestKey, generation, error });
        return { mutationRejected: true as const };
      }
    },
    [mediaType, selectedSeason, title, tmdbId, touch],
  );
  const touchItemView = useCallback(
    async (options?: TouchOptions) => {
      if (!itemId) return;
      const routeKey = `item:${itemId}`;
      const requestKey =
        options?.season === undefined
          ? `title:${routeKey}`
          : `season:${routeKey}:${options.season}`;
      const generation = ++requestGeneration.current;
      activeRequest.current = { routeKey, requestKey, generation };
      setTouchErrorState(undefined);
      try {
        return await touchItem({ itemId, ...options });
      } catch (error) {
        const active = activeRequest.current;
        if (
          activeRouteKey.current === routeKey &&
          active?.routeKey === routeKey &&
          active.requestKey === requestKey &&
          active.generation === generation
        )
          setTouchErrorState({ routeKey, requestKey, generation, error });
        return { mutationRejected: true as const };
      }
    },
    [itemId, touchItem],
  );
  useEffect(() => {
    if (!mediaType || tmdbId === undefined) return;
    // Displaying a title synchronizes it with the external metadata cache.
    const routeKey = `${mediaType}:${tmdbId}`;
    const requestKey =
      selectedSeason === undefined ? `title:${routeKey}` : `season:${routeKey}:${selectedSeason}`;
    const generation = ++requestGeneration.current;
    activeRequest.current = { routeKey, requestKey, generation };
    void touch({
      mediaType,
      tmdbId,
      ...(title !== undefined && { title }),
      ...(selectedSeason !== undefined && { season: selectedSeason }),
    })
      .then(() => {
        const active = activeRequest.current;
        if (
          activeRouteKey.current === routeKey &&
          active?.routeKey === routeKey &&
          active.requestKey === requestKey &&
          active.generation === generation
        )
          setTouchErrorState(undefined);
      })
      .catch((error) => {
        const active = activeRequest.current;
        if (
          activeRouteKey.current === routeKey &&
          active?.routeKey === routeKey &&
          active.requestKey === requestKey &&
          active.generation === generation
        )
          setTouchErrorState({ routeKey, requestKey, generation, error });
      });
  }, [mediaType, selectedSeason, title, tmdbId, touch]);
  const requestState = args ? subscribedRequestState : itemRequestState;
  const retouch = args ? touchTitle : touchItemView;
  useMetadataExpiryTimer(autoRecovery ? key : undefined, requestState, retouch);

  return {
    view: view === undefined ? undefined : { ...view, requestState },
    touchError,
    touchTitle,
    touchItemView,
  };
}
