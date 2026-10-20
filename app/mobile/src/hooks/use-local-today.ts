import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

export const localDateKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function useLocalToday() {
  const [today, setToday] = useState(localDateKey);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      setToday(localDateKey());
      const now = new Date();
      const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, Math.max(1_000, nextDay.getTime() - now.getTime() + 100));
    };
    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, []);
  return today;
}
