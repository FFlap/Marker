import { useRef, useState } from 'react';
import * as Effect from 'effect/Effect';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@marker/shared/api';
import { saveProfile } from '@marker/shared/clientEffects';
import { useOperation } from '@/hooks/use-operation';
import { usePendingTasks } from '@/hooks/use-pending-tasks';
import { useToast } from '@/components/ui/Toast';
import { DEFAULT_DISPLAY_PREFERENCES } from '@/lib/displayPreferences';

type SettingsPatch = Parameters<ReturnType<typeof useMutation<typeof api.settings.setSettings>>>[0];
type SettingKey = Exclude<keyof NonNullable<SettingsPatch>, 'today'>;

/** Settings with optimistic edits layered over the saved values. */
export function useSettings() {
  const runOperation = useOperation();
  const settings = useQuery(api.settings.getSettings);
  const setSettings = useMutation(api.settings.setSettings);
  const toast = useToast();
  const [pending, setPending] = usePendingTasks();
  const [optimistic, setOptimistic] = useState<Partial<Record<SettingKey, unknown>>>({});
  // A slower, older save must not clear a newer optimistic value for the same setting.
  const versions = useRef<Partial<Record<SettingKey, number>>>({});
  const current = {
    ...DEFAULT_DISPLAY_PREFERENCES,
    defaultView: 'list' as 'list' | 'posters',
    activityRatings: true,
    activityWatching: true,
    activityWatched: true,
    confirmWatchedMove: true,
    airingInWatching: true,
    ...settings,
    ...optimistic,
  } as typeof DEFAULT_DISPLAY_PREFERENCES & {
    defaultView: 'list' | 'posters';
    activityRatings: boolean;
    activityWatching: boolean;
    activityWatched: boolean;
    confirmWatchedMove: boolean;
    airingInWatching: boolean;
  };

  const update = async <K extends SettingKey>(
    key: K,
    value: NonNullable<SettingsPatch>[K],
    context?: Pick<NonNullable<SettingsPatch>, 'today'>,
  ) => {
    const version = (versions.current[key] ?? 0) + 1;
    versions.current[key] = version;
    setPending((existing) => new Set(existing).add(key));
    setOptimistic((existing) => ({ ...existing, [key]: value }));
    await runOperation.write(
      Effect.gen(function* () {
        yield* saveProfile(() => setSettings({ [key]: value, ...context }));
      }),
      {
        failure: () => {
          toast.show('Couldn’t update settings');
        },
        settled: () => {
          if (versions.current[key] !== version) return;
          setOptimistic((existing) => {
            const next = { ...existing };
            delete next[key];
            return next;
          });
          setPending((existing) => {
            const next = new Set(existing);
            next.delete(key);
            return next;
          });
        },
      },
    );
  };

  return { loaded: settings !== undefined, current, pending, update };
}
