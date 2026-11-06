import * as Effect from 'effect/Effect';
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
  const [edit, setEdit] = useState<
    { state: 'saved' } | { state: 'saving'; value: GridColumns; version: number }
  >({ state: 'saved' });
  const optimistic = edit.state === 'saving' ? edit.value : undefined;
  const version = useRef(0);
  const update = async (next: GridColumns) => {
    const request = ++version.current;
    setEdit({ state: 'saving', value: next, version: request });
    await runOperation.write(
      Effect.gen(function* () {
        yield* saveProfile(() => setSettings({ gridColumns: next }));
      }),
      {
        failure: () => {
          toast.show('Couldn’t save grid scale');
        },
        settled: () => {
          setEdit((current) =>
            current.state === 'saving' && current.version === request
              ? { state: 'saved' }
              : current,
          );
        },
      },
    );
  };
  return {
    gridColumns: optimistic ?? saved ?? DEFAULT_DISPLAY_PREFERENCES.gridColumns,
    updateGridColumns: update,
  };
}
