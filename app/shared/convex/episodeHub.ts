import { v } from 'convex/values';
import { requireUser } from './clerkAuth';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { internalMutation, mutation, query, type MutationCtx } from './_generated/server';
import { consumeWindowBudget } from './providerRateLimits';
import {
  airingInWatchingFor,
  handPickedAlsoWatching,
  newEpisodeOut,
  showsWithNewEpisode,
} from './settings';

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
  timesWatched: v.optional(v.number()),
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
    const [watchingItems, watchedShows, rated] = await Promise.all([
      showsWithNewEpisode(ctx, userId, 'watching', today, 200),
      // Watched shows join Up next when a new episode is out: automatically, or when set by
      // hand while the automatic setting is off.
      airingInWatchingFor(ctx, userId).then((automatic) =>
        automatic
          ? showsWithNewEpisode(ctx, userId, 'watched', today, 200)
          : // Hand-set flags only exist on shows the person chose, so read them all (bounded)
            // and let the release check below pick the ones with a new episode.
            handPickedAlsoWatching(ctx, userId, 1000),
      ),
      ctx.db
        .query('episodes')
        .withIndex('by_user_watched_rating', (q) =>
          q.eq('userId', userId).eq('watched', true).gt('rating', undefined),
        )
        .order('desc')
        .take(200),
    ]);
    // Same order as the library's Watching section: shows also in Watched first, by their
    // Watched rank, then Watching titles by rank.
    const byRank = (left: { rank: number }, right: { rank: number }) => left.rank - right.rank;
    const watching = [...watchedShows.sort(byRank), ...watchingItems.sort(byRank)];
    const released = watching.filter(
      (item) =>
        item.mediaType === 'tv' && item.deletingAt === undefined && newEpisodeOut(item, today),
    );
    const nextEpisodesPromise = Promise.all(
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
          ...(coordinate.overview !== undefined && { overview: coordinate.overview }),
          ...(coordinate.runtime !== undefined && { runtime: coordinate.runtime }),
          ...(coordinate.imageUrl !== undefined && { imageUrl: coordinate.imageUrl }),
          ...(coordinate.airDate !== undefined && { airDate: coordinate.airDate }),
          ...(coordinate.providerEpisodeId !== undefined && {
            providerEpisodeId: coordinate.providerEpisodeId,
          }),
          ...(savedMatches && saved?.rating !== undefined && { rating: saved.rating }),
          tags: savedMatches ? (saved?.tags ?? []) : [],
          // A count kept from an earlier, unticked watch carries over when it is ticked again.
          ...(savedMatches &&
            saved?.timesWatched !== undefined && { timesWatched: saved.timesWatched }),
        };
      }),
    );

    const itemIds = [...new Set(rated.map((episode) => episode.itemId))];
    const [nextEpisodes, itemRows] = await Promise.all([
      nextEpisodesPromise,
      Promise.all(itemIds.map(async (itemId) => [itemId, await ctx.db.get(itemId)] as const)),
    ]);
    const items = new Map(
      itemRows.filter(
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
            ...(episode.timesWatched !== undefined && { timesWatched: episode.timesWatched }),
          },
        ];
      })
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

async function refreshWatchingPage(
  ctx: MutationCtx,
  userId: Id<'users'>,
  cursor: string | null,
  status: 'watching' | 'watched' = 'watching',
) {
  const page = await ctx.db
    .query('items')
    .withIndex('by_user_status', (query) => query.eq('userId', userId).eq('status', status))
    .paginate({ cursor, numItems: 10 });
  // Watched shows are checked for new episodes when they can join Watching.
  const airingInWatching = status === 'watched' && (await airingInWatchingFor(ctx, userId));
  for (const item of page.page) {
    if (item.mediaType !== 'tv' || item.deletingAt !== undefined) continue;
    if (status === 'watched' && !airingInWatching && !item.alsoWatching) continue;
    await ctx.scheduler.runAfter(0, internal.nextEpisode.startNextEpisodeRefresh, {
      itemId: item._id,
    });
  }
  if (!page.isDone)
    await ctx.scheduler.runAfter(0, internal.episodeHub.continueWatchingRefresh, {
      userId,
      cursor: page.continueCursor,
      status,
    });
  else if (status === 'watching')
    await ctx.scheduler.runAfter(0, internal.episodeHub.continueWatchingRefresh, {
      userId,
      cursor: null,
      status: 'watched',
    });
}

export const refreshWatching = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    if (!(await consumeWindowBudget(ctx, `episode-hub:${userId}`, 1, 30_000))) return;
    await refreshWatchingPage(ctx, userId, null);
  },
});

export const continueWatchingRefresh = internalMutation({
  args: {
    userId: v.id('users'),
    cursor: v.union(v.string(), v.null()),
    status: v.optional(v.union(v.literal('watching'), v.literal('watched'))),
  },
  returns: v.null(),
  handler: async (ctx, { userId, cursor, status }) =>
    refreshWatchingPage(ctx, userId, cursor, status),
});
