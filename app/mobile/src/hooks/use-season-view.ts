import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { usePaginatedQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';

// One resolved season page contains at most 120 episodes. Render the complete
// season so users can jump to any episode without waiting for another batch.
export const SEASON_EPISODE_RENDER_BATCH = 120;

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

/** Makes a route identity change observe season 1 during that same render. */
export function useRouteSeason(routeKey: string): [number, Dispatch<SetStateAction<number>>] {
  const [selection, setSelection] = useState(() => ({ routeKey, season: 1 }));
  const season = selection.routeKey === routeKey ? selection.season : 1;
  const setSeason = useCallback<Dispatch<SetStateAction<number>>>(
    (value) =>
      setSelection((current) => {
        const currentSeason = current.routeKey === routeKey ? current.season : 1;
        const nextSeason = typeof value === 'function' ? value(currentSeason) : value;
        return { routeKey, season: nextSeason };
      }),
    [routeKey],
  );
  return [season, setSeason];
}

/** Subscribes to one bounded season chunk at a time and accumulates loaded pages. */
export function useSeasonView(args: { tmdbId: number; season: number } | undefined) {
  const season = args?.season;
  const paginated = usePaginatedQuery(api.resolvedMetadata.getSeasonView, args ?? 'skip', {
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
