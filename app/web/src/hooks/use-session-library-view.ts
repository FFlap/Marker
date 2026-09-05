import { useCallback, useState } from "react";

export type LibraryView = "list" | "posters";

const storageKey = "marker-library-view";

export function useSessionLibraryView(defaultView: LibraryView) {
  const [override, setOverride] = useState<LibraryView | undefined>(() => {
    if (typeof window === "undefined") return undefined;
    try {
      const stored = window.sessionStorage.getItem(storageKey);
      return stored === "list" || stored === "posters" ? stored : undefined;
    } catch {
      return undefined;
    }
  });

  const setView = useCallback((view: LibraryView) => {
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.setItem(storageKey, view);
      } catch {
        // Keep the selected view in memory when browser storage is unavailable.
      }
    }
    setOverride(view);
  }, []);

  return { view: override ?? defaultView, setView };
}
