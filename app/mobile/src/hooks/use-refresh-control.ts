import { useCallback, useRef, useState } from 'react';

export function useRefreshControl(refresh: () => Promise<unknown>) {
  const pending = useRef(false);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      pending.current = false;
      setRefreshing(false);
    }
  }, [refresh]);

  return { refreshing, onRefresh };
}
