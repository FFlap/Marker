import { useRef, useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { useToast } from '@/components/ui/Toast';
import { DEFAULT_DISPLAY_PREFERENCES, type GridColumns } from '@/lib/displayPreferences';

export function useGridColumns(saved: GridColumns | undefined) {
  const setSettings = useMutation(api.settings.setSettings);
  const toast = useToast();
  const [optimistic, setOptimistic] = useState<GridColumns>();
  const version = useRef(0);
  const update = async (next: GridColumns) => {
    const request = ++version.current;
    setOptimistic(next);
    try {
      await setSettings({ gridColumns: next });
    } catch {
      toast.show('Couldn’t save grid scale');
    } finally {
      if (version.current === request) setOptimistic(undefined);
    }
  };
  return {
    gridColumns: optimistic ?? saved ?? DEFAULT_DISPLAY_PREFERENCES.gridColumns,
    updateGridColumns: update,
  };
}
