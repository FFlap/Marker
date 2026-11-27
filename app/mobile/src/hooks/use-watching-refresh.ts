import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useMutation } from 'convex/react';
import { api } from '@marker/shared/api';
import { touchMetadata } from '@marker/shared/clientEffects';
import { useOperation } from '@/hooks/use-operation';

/** How often a session that stays open checks again. */
const ACTIVE_REFRESH_MS = 10 * 60 * 1000;

/**
 * Checks followed shows for newly published episodes now, whenever the app returns to the
 * foreground, and every few minutes while it stays open, so Watching and Up next pick up a
 * release without opening Episodes. The server debounces repeat calls.
 */
export function useWatchingRefresh({
  enabled,
  onFailure,
}: {
  enabled: boolean;
  onFailure?: () => void;
}) {
  const runOperation = useOperation();
  const refreshWatching = useMutation(api.episodeHub.refreshWatching);
  useEffect(() => {
    if (!enabled) return;
    const refresh = () =>
      void runOperation(
        touchMetadata(() => refreshWatching({})),
        { failure: () => onFailure?.() },
      );
    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') refresh();
    }, ACTIVE_REFRESH_MS);
    return () => {
      subscription.remove();
      clearInterval(timer);
    };
  }, [enabled, onFailure, refreshWatching, runOperation]);
}
