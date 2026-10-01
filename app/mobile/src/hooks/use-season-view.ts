import { useMemo } from 'react';
import { usePaginatedQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { currentSeasonPages } from '@/features/title/seasonPages';

// One resolved season page contains at most 120 episodes. Render the complete
// season so users can jump to any episode without waiting for another batch.
export const SEASON_EPISODE_RENDER_BATCH = 120;

/** Subscribes to one bounded season chunk at a time and accumulates loaded pages. */
export function useSeasonView(args: { tmdbId: number; season: number } | undefined) {
  const season = args?.season;
  const paginated = usePaginatedQuery(api.resolvedMetadata.reads.getSeasonView, args ?? 'skip', {
    initialNumItems: 1,
  });
  const { firstPage, episodes, pageCount } = useMemo(() => {
    const pages = currentSeasonPages(paginated.results, season);
    return {
      firstPage: pages[0],
      pageCount: pages.length,
      episodes: pages.flatMap((page) => page.episodes),
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
