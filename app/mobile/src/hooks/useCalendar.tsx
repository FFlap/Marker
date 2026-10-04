import {
  createContext,
  useCallback,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAction } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { CalendarCache } from '@/lib/calendarCache';
import { deviceRegion } from '@/lib/calendar';

const CalendarContext = createContext<CalendarCache | null>(null);

export function CalendarProvider({ children }: { children: ReactNode }) {
  const [cache] = useState(() => new CalendarCache());
  return <CalendarContext.Provider value={cache}>{children}</CalendarContext.Provider>;
}

export function useCalendar(date: string, prefetch = false) {
  const cache = useContext(CalendarContext);
  if (!cache) throw new Error('CalendarProvider is required');
  const upcoming = useAction(api.calendar.upcoming);
  const month = date.slice(0, 7);
  const region = deviceRegion();
  const parsed = new Date(`${date}T00:00:00Z`);
  const valid =
    Number.isFinite(parsed.getTime()) &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    parsed.toISOString().slice(0, 10) === date;
  const getSnapshot = useCallback(() => cache.get(month, region), [cache, month, region]);
  const subscribe = useCallback(
    (listener: () => void) => cache.subscribe(month, region, listener),
    [cache, month, region],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const retry = useCallback(() => {
    if (valid) void cache.load(month, region, upcoming, true);
  }, [cache, month, region, upcoming, valid]);

  useFocusEffect(
    useCallback(() => {
      if (!valid) return;
      let active = true;
      const load = async () => {
        await cache.load(month, region, upcoming);
        if (
          !prefetch ||
          !active ||
          cache.get(month, region).error ||
          cache.get(month, region).result?.failedTitles.count
        )
          return;
        const [year, number] = month.split('-').map(Number);
        // Warm neighbors only after the visible month; navigation shares in-flight requests.
        for (const offset of [1, -1]) {
          if (!active || AppState.currentState === 'background') break;
          const neighbor = new Date(year, number - 1 + offset, 1);
          const key = `${neighbor.getFullYear()}-${String(neighbor.getMonth() + 1).padStart(2, '0')}`;
          await cache.load(key, region, upcoming);
        }
      };
      void load();
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') void load();
      });
      return () => {
        active = false;
        subscription.remove();
      };
    }, [cache, month, region, upcoming, valid, prefetch]),
  );

  return { ...snapshot, valid, retry };
}
