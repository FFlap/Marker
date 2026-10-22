import type { WebLibraryItem } from "@/types";

export const libraryStatuses = ["watched", "watching", "watchlist", "dropped"] as const;

export const libraryStatusLabels: Record<WebLibraryItem["status"], string> = {
  watched: "Watched",
  watching: "Watching",
  watchlist: "Watchlist",
  dropped: "Dropped",
};

export const libraryStatusOptions = libraryStatuses.map((value) => ({
  value,
  label: libraryStatusLabels[value],
}));
