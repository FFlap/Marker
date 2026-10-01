import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { selectAvailableSeason } from '@/features/title/seasons';

type MetadataRequestState = {
  state?: 'inFlight' | 'succeeded' | 'failed' | 'notFound';
  errorCode?: string;
  expiresAt?: number;
  retryAt?: number;
  delayMs?: number;
};

type TitleTarget =
  | { mediaType: 'movie' | 'tv'; tmdbId: number; title?: string; season?: number }
  | { itemId: Id<'items'>; season?: number };

const EXPIRY_GRACE_MS = 1_000;
const FAILED_REPOLL_MIN_MS = 5_000;
const FAILED_REPOLL_MAX_MS = 5 * 60_000;
const INFLIGHT_REPOLL_MIN_MS = 250;

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
  const onRetouch = useEffectEvent(retouch);
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
      state === 'failed' ? FAILED_REPOLL_MIN_MS : INFLIGHT_REPOLL_MIN_MS,
      relativeDelay + (armReason === 'inFlight' ? EXPIRY_GRACE_MS : 0),
    );
    const timer = setTimeout(
      () =>
        void Promise.resolve(onRetouch())
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
function useMetadataRecoveryTimers(args: {
  titleKey: string | undefined;
  titleState: MetadataRequestState | null | undefined;
  seasonKey: string | undefined;
  seasonState: MetadataRequestState | null | undefined;
  retouch: () => unknown;
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
    args.retouch,
  );
  useMetadataExpiryTimer(
    sharedRetry ? undefined : args.titleKey,
    sharedRetry ? undefined : args.titleState,
    args.retouch,
  );
  useMetadataExpiryTimer(
    sharedRetry ? undefined : args.seasonKey,
    sharedRetry ? undefined : args.seasonState,
    args.retouch,
  );
}

/**
 * Owns title/item metadata, season selection, refresh admission and recovery.
 * Callers provide an identity and render the resulting state.
 */
export function useTitleView(target: TitleTarget | undefined) {
  const itemId = target && 'itemId' in target ? target.itemId : undefined;
  const titleTarget = target && 'mediaType' in target ? target : undefined;
  const titleView = useQuery(
    api.resolvedMetadata.reads.getTitleView,
    titleTarget ? { mediaType: titleTarget.mediaType, tmdbId: titleTarget.tmdbId } : 'skip',
  );
  const itemView = useQuery(api.resolvedMetadata.reads.getItemView, itemId ? { itemId } : 'skip');
  const item = itemId ? itemView?.item : undefined;
  const mediaType = titleTarget?.mediaType ?? item?.mediaType;
  const tmdbId = titleTarget?.tmdbId ?? item?.tmdbId;
  const titleHint = titleTarget?.title;
  const view = itemId ? itemView : titleView;
  const returnedTitle = view?.title;
  const title =
    returnedTitle?.tmdbId === tmdbId && returnedTitle?.mediaType === mediaType
      ? returnedTitle
      : undefined;
  const season = selectAvailableSeason(title?.seasons, target?.season ?? 1);
  const selectedSeason = mediaType === 'tv' ? season : undefined;
  const titleRequestState = useQuery(
    api.resolvedMetadata.reads.getTitleRequestState,
    mediaType && tmdbId !== undefined ? { mediaType, tmdbId } : 'skip',
  );
  const seasonRequestState = useQuery(
    api.resolvedMetadata.reads.getSeasonRequestState,
    mediaType === 'tv' && tmdbId !== undefined ? { tmdbId, season } : 'skip',
  );
  const touchTitle = useMutation(api.resolvedMetadata.touch.touchTitle);
  const touchItem = useMutation(api.resolvedMetadata.touch.touchItemView);
  const routeKey = itemId
    ? `item:${itemId}`
    : mediaType && tmdbId !== undefined
      ? `${mediaType}:${tmdbId}`
      : undefined;
  const generation = useRef(0);
  const [touchFailure, setTouchFailure] = useState<{
    routeKey: string;
    season?: number;
    error: unknown;
  }>();

  const refresh = useCallback(
    async (options?: { force?: boolean }) => {
      if (!routeKey || !mediaType || tmdbId === undefined) return;
      const request = ++generation.current;
      const touchOptions = {
        ...(selectedSeason !== undefined && { season: selectedSeason }),
        ...(options?.force !== undefined && { force: options.force }),
      };
      const pending = itemId
        ? touchItem({ itemId, ...touchOptions })
        : touchTitle({
            mediaType,
            tmdbId,
            ...(titleHint !== undefined && { title: titleHint }),
            ...touchOptions,
          });
      return pending
        .then((result) => {
          if (generation.current === request) setTouchFailure(undefined);
          return result;
        })
        .catch((error: unknown) => {
          if (generation.current === request)
            setTouchFailure({ routeKey, season: selectedSeason, error });
          return { mutationRejected: true as const };
        });
    },
    [itemId, mediaType, routeKey, selectedSeason, titleHint, tmdbId, touchItem, touchTitle],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useMetadataRecoveryTimers({
    titleKey: routeKey,
    titleState: titleRequestState,
    seasonKey: selectedSeason !== undefined ? `season:${routeKey}:${selectedSeason}` : undefined,
    seasonState: seasonRequestState,
    retouch: refresh,
  });

  return {
    title,
    item,
    loading: view === undefined,
    season,
    titleRequestState,
    seasonRequestState,
    touchError:
      touchFailure?.routeKey === routeKey &&
      (touchFailure?.season === undefined || touchFailure.season === selectedSeason)
        ? touchFailure?.error
        : undefined,
    refresh,
  };
}
