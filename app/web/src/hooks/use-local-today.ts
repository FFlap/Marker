import { useSyncExternalStore } from "react";

export const localDateKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function subscribe(onStoreChange: () => void) {
  let timer = 0;
  const refresh = () => {
    onStoreChange();
    const now = new Date();
    const nextDay = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    );
    window.clearTimeout(timer);
    timer = window.setTimeout(
      refresh,
      Math.max(1_000, nextDay.getTime() - now.getTime() + 100),
    );
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") refresh();
  };
  refresh();
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.clearTimeout(timer);
    window.removeEventListener("focus", refresh);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

export function useLocalToday() {
  return useSyncExternalStore(subscribe, localDateKey);
}
