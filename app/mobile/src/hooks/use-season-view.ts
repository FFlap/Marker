import { useMemo } from 'react';
import { usePaginatedQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';

// One resolved season page contains at most 120 episodes. Render the complete
// season so users can jump to any episode without waiting for another batch.
export const SEASON_EPISODE_RENDER_BATCH = 120;

export function selectAvailableSeason(
  seasons: { season: number }[] | undefined,
  selectedSeason: number,
) {
  const firstSeason =
    seasons?.find((entry) => entry.season > 0)?.season ?? seasons?.[0]?.season ?? 1;
  return seasons?.some((entry) => entry.season === selectedSeason) === false
    ? firstSeason
    : selectedSeason;
}

type SeasonEpisode = {
  season: number;
  episode: number;
  name: string;
  overview?: string;
  runtime?: number;
  imageUrl?: string;
  airDate?: string;
};

type SeasonPage = {
  season: number;
  metadataProvider: 'tmdb' | 'tvdb';
  orderEpoch: number;
  totalCount: number;
  chunkIndex: number;
  episodes: SeasonEpisode[];
};

/** Subscribes to one bounded season chunk at a time and accumulates loaded pages. */
export function useSeasonView(args: { tmdbId: number; season: number } | undefined) {
  const season = args?.season;
  const paginated = usePaginatedQuery(api.resolvedMetadata.reads.getSeasonView, args ?? 'skip', {
    initialNumItems: 1,
  });
  const { firstPage, episodes, pageCount } = useMemo(() => {
    const pages = (paginated.results as SeasonPage[]).filter(
      (page) => season !== undefined && page.season === season,
    );
    return {
      firstPage: pages[0],
      pageCount: pages.length,
      episodes: [...pages]
        .sort((left, right) => left.chunkIndex - right.chunkIndex)
        .flatMap((page) => page.episodes),
    };
  }, [paginated.results, season]);
  return {
    season: firstPage
      ? {
          season: firstPage.season,
          metadataProvider: firstPage.metadataProvider,
          orderEpoch: firstPage.orderEpoch,
          totalCount: firstPage.totalCount,
        }
      : undefined,
    episodes,
    pageCount,
    status: paginated.status,
    loadMore: paginated.loadMore,
  };
}
