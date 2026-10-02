import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../mobile/convex/_generated/api";

type SearchResponse = FunctionReturnType<typeof api.tmdb.searchMulti>[number];
export type SearchResult = Pick<SearchResponse, "id" | "title" | "mediaType"> &
  Partial<SearchResponse> & {
    runtime?: number;
    genres?: string[];
  };
export type TitleDetail = NonNullable<
  FunctionReturnType<typeof api.resolvedMetadata.reads.getTitle>
>;
export type SeasonPage = FunctionReturnType<
  typeof api.resolvedMetadata.reads.getSeasonView
>["page"][number];
export const TITLE_SEARCH_MAX_LENGTH = 100;

export function titleRuntime(
  title: Pick<TitleDetail, "runtime" | "episodeRunTime"> | null | undefined,
  fallback?: number,
) {
  return title?.runtime ?? title?.episodeRunTime.find((value) => value > 0) ?? fallback;
}
