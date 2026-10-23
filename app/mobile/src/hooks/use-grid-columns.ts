import { Effect } from 'effect';
import { saveProfile } from '@marker/shared/clientEffects';
import { useOperation } from '@/hooks/use-operation';
import { useRef, useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@marker/shared/api';
import { useToast } from '@/components/ui/Toast';
import { DEFAULT_DISPLAY_PREFERENCES, type GridColumns } from '@/lib/displayPreferences';

export function useGridColumns(saved: GridColumns | undefined) {
  const runOperation = useOperation();
  const setSettings = useMutation(api.settings.setSettings);
  const toast = useToast();
  const [optimistic, setOptimistic] = useState<GridColumns>();
  const version = useRef(0);
  const update = async (next: GridColumns) => {
    const request = ++version.current;
    setOptimistic(next);
    await runOperation.write(
      Effect.gen(function* () {
        yield* saveProfile(() => setSettings({ gridColumns: next }));
      }),
      {
        failure: () => {
          toast.show('Couldn’t save grid scale');
        },
        settled: () => {
          if (version.current === request) setOptimistic(undefined);
        },
      },
    );
  };
  return {
    gridColumns: optimistic ?? saved ?? DEFAULT_DISPLAY_PREFERENCES.gridColumns,
    updateGridColumns: update,
  };
}
