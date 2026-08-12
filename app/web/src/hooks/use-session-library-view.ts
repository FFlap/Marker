import { useState } from "react";

export type LibraryView = "list" | "posters";

const storageKey = "marker-library-view";

export function useSessionLibraryView(defaultView: LibraryView) {
  const [override, setOverride] = useState<LibraryView | undefined>(() => {
    if (typeof window === "undefined") return undefined;
    const stored = window.sessionStorage.getItem(storageKey);
    return stored === "list" || stored === "posters" ? stored : undefined;
  });

  return {
    view: override ?? defaultView,
    setView: (view: LibraryView) => {
      window.sessionStorage.setItem(storageKey, view);
      setOverride(view);
    },
  };
}
