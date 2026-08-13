import type { Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { profileFavoritesForUser } from './profileFavorites';

export async function profileStatsForUser(ctx: QueryCtx, userId: Id<'users'>) {
  const [favorites, stats] = await Promise.all([
    profileFavoritesForUser(ctx, userId),
    ctx.db
      .query('profileStats')
      .withIndex('by_user', (query) => query.eq('userId', userId))
      .unique(),
  ]);
  return {
    favorites,
    totalWatchMinutes: stats?.totalWatchMinutes ?? 0,
    episodesWatched: stats?.episodesWatched ?? 0,
    moviesWatched: stats?.moviesWatched ?? 0,
    showsWatched: stats?.showsWatched ?? 0,
    totalItems: stats?.totalItems ?? 0,
    avgRating: stats?.ratingCount ? stats.ratingTotal / stats.ratingCount : 0,
    topTags: stats?.topTags ?? [],
  };
}
