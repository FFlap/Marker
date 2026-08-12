import { v } from 'convex/values';
import { getClerkUserId } from './clerkAuth';
import { query } from './_generated/server';

const episodeCard = {
  itemId: v.id('items'),
  title: v.string(),
  posterPath: v.optional(v.string()),
  isAnime: v.boolean(),
  seasonName: v.string(),
  season: v.number(),
  episode: v.number(),
  name: v.string(),
  overview: v.optional(v.string()),
  runtime: v.optional(v.number()),
  imageUrl: v.optional(v.string()),
  airDate: v.optional(v.string()),
  providerEpisodeId: v.optional(v.number()),
  rating: v.optional(v.number()),
  tags: v.array(v.string()),
};

const requireUser = async (ctx: { auth: Parameters<typeof getClerkUserId>[0]['auth'] }) => {
  const userId = await getClerkUserId(ctx);
  if (!userId) throw new Error('Authentication required');
  return userId;
};

const requireLocalDate = (today: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(today);
  if (!match) throw new Error('today must be a YYYY-MM-DD date');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  )
    throw new Error('today must be a valid YYYY-MM-DD date');
};

export const overview = query({
  args: { today: v.string() },
  returns: v.object({
    watching: v.array(v.object(episodeCard)),
    favorites: v.array(v.object(episodeCard)),
  }),
  handler: async (ctx, { today }) => {
    requireLocalDate(today);
    const userId = await requireUser(ctx);
    const watching = await ctx.db
      .query('items')
      .withIndex('by_user_status', (q) => q.eq('userId', userId).eq('status', 'watching'))
      .take(200);
    const released = watching.filter(
      (item) =>
        item.mediaType === 'tv' &&
        item.deletingAt === undefined &&
        item.nextEpisode !== undefined &&
        (item.nextEpisode.airDate !== undefined
          ? item.nextEpisode.airDate <= today
          : item.nextEpisode.undatedReleased === true),
    );
    const nextEpisodes = await Promise.all(
      released.map(async (item) => {
        const coordinate = item.nextEpisode!;
        const saved = await ctx.db
          .query('episodes')
          .withIndex('by_item', (query) =>
            query
              .eq('itemId', item._id)
              .eq('season', coordinate.season)
              .eq('episode', coordinate.episode),
          )
          .unique();
        const savedMatches =
          coordinate.providerEpisodeId === undefined ||
          saved?.providerEpisodeId === coordinate.providerEpisodeId;
        return {
          itemId: item._id,
          title: item.title,
          ...(item.posterPath !== undefined && { posterPath: item.posterPath }),
          isAnime: item.isAnime,
          seasonName:
            coordinate.seasonName ??
            (coordinate.season === 0 ? 'Specials' : `Season ${coordinate.season}`),
          season: coordinate.season,
          episode: coordinate.episode,
          name: coordinate.name ?? `Episode ${coordinate.episode}`,
          ...(coordinate.runtime !== undefined && { runtime: coordinate.runtime }),
          ...(coordinate.imageUrl !== undefined && { imageUrl: coordinate.imageUrl }),
          ...(coordinate.airDate !== undefined && { airDate: coordinate.airDate }),
          ...(coordinate.providerEpisodeId !== undefined && {
            providerEpisodeId: coordinate.providerEpisodeId,
          }),
          ...(savedMatches && saved?.rating !== undefined && { rating: saved.rating }),
          tags: savedMatches ? (saved?.tags ?? []) : [],
        };
      }),
    );

    const rated = await ctx.db
      .query('episodes')
      .withIndex('by_user_watched_rating', (q) =>
        q.eq('userId', userId).eq('watched', true).gt('rating', undefined),
      )
      .order('desc')
      .take(200);
    const itemIds = [...new Set(rated.map((episode) => episode.itemId))];
    const items = new Map(
      (
        await Promise.all(
          itemIds.map(async (itemId) => [itemId, await ctx.db.get(itemId)] as const),
        )
      ).filter(
        (entry): entry is readonly [(typeof entry)[0], NonNullable<(typeof entry)[1]>] =>
          entry[1] !== null && entry[1].userId === userId && entry[1].deletingAt === undefined,
      ),
    );
    const ratedEpisodes = rated
      .flatMap((episode) => {
        const item = items.get(episode.itemId);
        if (!item) return [];
        return [
          {
            itemId: item._id,
            title: item.title,
            ...(item.posterPath !== undefined && { posterPath: item.posterPath }),
            isAnime: item.isAnime,
            seasonName:
              episode.seasonName ??
              (episode.season === 0 ? 'Specials' : `Season ${episode.season}`),
            season: episode.season,
            episode: episode.episode,
            name: episode.name ?? `Episode ${episode.episode}`,
            ...(episode.overview !== undefined && { overview: episode.overview }),
            ...(episode.runtime !== undefined && { runtime: episode.runtime }),
            ...(episode.imageUrl !== undefined && { imageUrl: episode.imageUrl }),
            ...(episode.airDate !== undefined && { airDate: episode.airDate }),
            rating: episode.rating!,
            tags: episode.tags,
          },
        ];
      })
      .filter((episode) => episode !== null)
      .sort(
        (left, right) =>
          right.rating - left.rating ||
          left.title.localeCompare(right.title) ||
          left.season - right.season ||
          left.episode - right.episode,
      );

    return { watching: nextEpisodes, favorites: ratedEpisodes };
  },
});
