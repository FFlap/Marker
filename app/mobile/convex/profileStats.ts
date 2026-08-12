import type { Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { profileFavoritesForUser } from './profileFavorites';

export async function profileStatsForUser(ctx: QueryCtx, userId: Id<'users'>) {
  const favorites = await profileFavoritesForUser(ctx, userId);
  const items = await ctx.db
    .query('items')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .filter((q) => q.eq(q.field('deletingAt'), undefined))
    .take(2000);
  const episodeSummaries = await ctx.db
    .query('episodeSummaries')
    .withIndex('by_user', (query) => query.eq('userId', userId))
    .take(10_000);
  const watchedEpisodeCount = episodeSummaries.reduce(
    (total, summary) => total + summary.watchedCount,
    0,
  );
  const movies = items.filter((item) => item.mediaType === 'movie' && item.status === 'watched');
  const movieMinutes = movies.reduce(
    (minutes, item) => minutes + (item.runtime ?? 0) * item.timesWatched,
    0,
  );
  const itemsById = new Map(items.map((item) => [item._id, item]));
  const tvMinutes = episodeSummaries.reduce((minutes, summary) => {
    const item = itemsById.get(summary.itemId);
    if (!item) return minutes;
    return (
      minutes +
      summary.watchedRuntimeMinutes +
      summary.watchedRuntimeFallbackCount * (item.runtime ?? 30)
    );
  }, 0);
  const rated = items.filter((item) => item.rating !== undefined);
  const counts = new Map<string, { tag: string; count: number }>();
  for (const tag of items.flatMap((item) => item.tags)) {
    const key = tag.toLocaleLowerCase();
    const current = counts.get(key);
    counts.set(key, { tag: current?.tag ?? tag, count: (current?.count ?? 0) + 1 });
  }
  for (const summary of episodeSummaries)
    for (const { tag, count } of summary.tagCounts) {
      const key = tag.toLocaleLowerCase();
      const current = counts.get(key);
      counts.set(key, { tag: current?.tag ?? tag, count: (current?.count ?? 0) + count });
    }
  return {
    favorites,
    totalWatchMinutes: movieMinutes + tvMinutes,
    episodesWatched: watchedEpisodeCount,
    moviesWatched: movies.length,
    showsWatched: items.filter((item) => item.mediaType === 'tv' && item.status === 'watched')
      .length,
    totalItems: items.length,
    avgRating: rated.length
      ? rated.reduce((total, item) => total + item.rating!, 0) / rated.length
      : 0,
    topTags: [...counts.values()]
      .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag))
      .slice(0, 5)
      .map(({ tag, count }) => ({ tag, count })),
  };
}
