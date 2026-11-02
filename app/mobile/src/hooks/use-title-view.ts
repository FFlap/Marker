import { runClientEffect } from '@marker/shared/clientOperations';
import * as Effect from 'effect/Effect';
import { touchMetadata } from '@marker/shared/clientEffects';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@marker/shared/api';
import type { FunctionReturnType } from 'convex/server';
import type { Id } from '@marker/shared/dataModel';
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

type TouchResult = FunctionReturnType<typeof api.resolvedMetadata.touch.touchTitle>;
type RefreshResult = TouchResult | { mutationRejected: true } | undefined;

const decisionForKey = (key: string, result: TouchResult) =>
  'title' in result ? (key.startsWith('season:') ? result.season : result.title) : result;

function useMetadataExpiryTimer(
  key: string | undefined,
  requestState: MetadataRequestState | null | undefined,
  retouch: () => Promise<RefreshResult>,
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
    const controller = new AbortController();
    const rearmFailure = () =>
      setServerArm({
        key,
        delayMs: Math.min(FAILED_REPOLL_MAX_MS, Math.max(FAILED_REPOLL_MIN_MS, timerDelay * 2)),
        reason: 'mutationRejected',
        sourceState: state,
        sourceDelayMs: delayMs,
      });
    void runClientEffect(
      Effect.sleep(timerDelay).pipe(
        Effect.andThen(touchMetadata(() => Promise.resolve(onRetouch()))),
        Effect.match({
          onSuccess: (value) => {
            if (value === undefined || 'mutationRejected' in value) {
              rearmFailure();
              return;
            }
            const decision = decisionForKey(key, value);
            if (
              !('reason' in decision) ||
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
          },
          onFailure: rearmFailure,
        }),
      ),
      { signal: controller.signal },
    );
    return () => controller.abort();
  }, [key, state, delayMs, serverArm]);
}

function useMetadataRecoveryTimers(args: {
  titleKey: string | undefined;
  titleState: MetadataRequestState | null | undefined;
  seasonKey: string | undefined;
  seasonState: MetadataRequestState | null | undefined;
  retouch: () => Promise<RefreshResult>;
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
  const requests = useRef(new Set<AbortController>());
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
      const controller = new AbortController();
      requests.current.add(controller);
      // Interruption prevents obsolete UI callbacks; the admitted server job remains durable.
      const exit = await runClientEffect(
        touchMetadata(() =>
          itemId
            ? touchItem({ itemId, ...touchOptions })
            : touchTitle({
                mediaType,
                tmdbId,
                ...(titleHint !== undefined && { title: titleHint }),
                ...touchOptions,
              }),
        ).pipe(
          Effect.match({
            onSuccess: (result) => {
              if (generation.current === request) setTouchFailure(undefined);
              return result;
            },
            onFailure: (error) => {
              if (generation.current === request)
                setTouchFailure({ routeKey, season: selectedSeason, error: error.cause });
              return { mutationRejected: true as const };
            },
          }),
        ),
        { signal: controller.signal },
      );
      requests.current.delete(controller);
      return exit._tag === 'Success' ? exit.value : undefined;
    },
    [itemId, mediaType, routeKey, selectedSeason, titleHint, tmdbId, touchItem, touchTitle],
  );
  useEffect(() => {
    const pending = requests.current;
    void refresh();
    return () => {
      for (const controller of pending) controller.abort();
      pending.clear();
    };
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
