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
import { CalendarCache } from '../../../shared/calendarCache';
import { currentCalendarMonth } from '../../../shared/calendar';
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
  const past = month < currentCalendarMonth();
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
    if (valid && !past) void cache.load(month, region, upcoming, true);
  }, [cache, month, region, upcoming, valid, past]);

  useFocusEffect(
    useCallback(() => {
      if (!valid || past) return;
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
        // Warm only the next month after the visible month is complete.
        if (!active || AppState.currentState === 'background') return;
        const neighbor = new Date(year, number, 1);
        const key = `${neighbor.getFullYear()}-${String(neighbor.getMonth() + 1).padStart(2, '0')}`;
        await cache.load(key, region, upcoming);
      };
      void load();
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') void load();
      });
      return () => {
        active = false;
        subscription.remove();
      };
    }, [cache, month, region, upcoming, valid, past, prefetch]),
  );

  return { ...snapshot, valid, past, retry };
}
