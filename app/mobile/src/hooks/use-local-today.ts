import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';

export const localDateKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const listeners = new Set<() => void>();
let stopListening: (() => void) | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (!active) return;
      const now = new Date();
      const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(refresh, Math.max(1_000, nextDay.getTime() - now.getTime() + 100));
      listeners.forEach((notify) => notify());
    };
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    refresh();
    stopListening = () => {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
      subscription.remove();
    };
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopListening?.();
      stopListening = undefined;
    }
  };
}

export function useLocalToday() {
  return useSyncExternalStore(subscribe, localDateKey, localDateKey);
}
