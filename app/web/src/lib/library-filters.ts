import type { WebLibraryItem } from "@/types";

export type LibraryFilters = {
  media: "all" | "movie" | "tv" | "anime";
  minimum: number;
  status: "all" | WebLibraryItem["status"];
  tags: string[];
};

export const normalizeTag = (tag: string) => tag.trim().toLowerCase();

export function uniqueTags(tags: string[]) {
  return [...new Map(tags.map((tag) => [normalizeTag(tag), tag])).values()]
    .toSorted((left, right) => left.localeCompare(right));
}

type FilterableItem = Pick<WebLibraryItem, "title" | "mediaType" | "isAnime" | "status" | "rating"> & { tags?: string[] };

export function filterLibraryItems<T extends FilterableItem>(items: T[], filters: LibraryFilters, search: string) {
  const query = search.trim().toLowerCase();
  const tags = filters.tags.map(normalizeTag);
  return items.filter((item) =>
    item.title.toLowerCase().includes(query) &&
    (filters.media === "all" || (item.isAnime ? "anime" : item.mediaType) === filters.media) &&
    (filters.status === "all" || item.status === filters.status) &&
    (!filters.minimum || (item.rating ?? -1) >= filters.minimum) &&
    tags.every((tag) => item.tags?.some((entry) => normalizeTag(entry) === tag)),
  );
}
