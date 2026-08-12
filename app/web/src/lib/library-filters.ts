import type { WebLibraryItem } from "@/types";
import type { LibraryFilters } from "@/components/filter-dialog";

export function matchesMediaType(
  item: Pick<WebLibraryItem, "mediaType" | "isAnime">,
  filter: LibraryFilters["media"],
) {
  if (filter === "all") return true;
  if (filter === "anime") return item.isAnime === true;
  return item.mediaType === filter && item.isAnime !== true;
}
