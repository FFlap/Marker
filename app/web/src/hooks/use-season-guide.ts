import { useMemo, useState } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../../mobile/convex/_generated/api";
import type { SeasonPage, TitleDetail } from "@/lib/catalog";

type SeasonOption = TitleDetail["seasons"][number] & {
  episodeCountVerified?: boolean;
};

export function useSeasonGuide({ mediaType, tmdbId, title, refreshError = false }: {
  mediaType?: "movie" | "tv";
  tmdbId?: number;
  title?: { seasons: SeasonOption[] } | null;
  refreshError?: boolean;
}) {
  const identity = `${mediaType}:${tmdbId}`;
  const seasons = useMemo(
    () => title?.seasons
      .filter((entry) => entry.season >= 0 &&
        (entry.episodeCount > 0 || entry.episodeCountVerified === false))
      .toSorted((left, right) => left.season - right.season) ?? [],
    [title?.seasons],
  );
  const [selection, setSelection] = useState<{ identity: string; season: number }>();
  const selected = selection?.identity === identity ? selection.season : undefined;
  const season =
    seasons.find((entry) => entry.season === selected)?.season ??
    seasons.find((entry) => entry.season > 0)?.season ?? seasons[0]?.season ?? 1;
  const enabled = mediaType === "tv" && tmdbId !== undefined;
  const args = enabled ? { tmdbId, season } : "skip";
  const pagination = usePaginatedQuery(
    api.resolvedMetadata.reads.getSeasonView, args, { initialNumItems: 1 },
  );
  const request = useQuery(api.resolvedMetadata.reads.getSeasonRequestState, args);
  const pages = useMemo(() => {
    const results: SeasonPage[] = pagination.results;
    const first = results.find((page) => page.season === season && page.chunkIndex === 0);
    if (!first) return [];
    const chunks = new Map<number, SeasonPage>();
    for (const page of results) {
      if (page.season === season &&
          page.metadataProvider === first.metadataProvider &&
          page.orderEpoch === first.orderEpoch &&
          page.seasonVersion === first.seasonVersion &&
          page.totalCount === first.totalCount &&
          !chunks.has(page.chunkIndex))
        chunks.set(page.chunkIndex, page);
    }
    // A refresh can restart an already-loaded cursor at chunk zero. Keep the
    // current generation's contiguous prefix until subsequent pages catch up.
    const contiguous: SeasonPage[] = [];
    for (let index = 0; chunks.has(index); index += 1)
      contiguous.push(chunks.get(index)!);
    return contiguous;
  }, [pagination.results, season]);
  const episodes = useMemo(() => pages.flatMap((page) => page.episodes), [pages]);
  const summary = pages[0];
  const failed = enabled && !summary &&
    (refreshError || request?.state === "failed" || request?.state === "notFound");
  // An empty reactive cache read can arrive before its provider refresh starts.
  // Only a stored empty season or a completed request establishes an empty guide.
  const loading = enabled && !summary && !failed &&
    (pagination.status === "LoadingFirstPage" || request == null || request.state === "inFlight");
  return {
    seasons, season, episodes, summary, failed, loading,
    canLoadMore: pagination.status === "CanLoadMore",
    loadMore: () => pagination.loadMore(1),
    loadedPageCount: pages.length,
    setSeason: (next: number) => setSelection({ identity, season: next }),
  };
}
