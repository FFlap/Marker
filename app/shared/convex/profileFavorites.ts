import { requireUser } from './clerkAuth';
import { mutation, query, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { v } from 'convex/values';
import { activeResolvedTitles, mediaIdentityKey } from './resolvedTitleModel';
import { eligibleFavoriteValidator } from './publicValidators';

export async function profileFavoritesForUser(ctx: QueryCtx, userId: Id<'users'>) {
  const favorites = await ctx.db
    .query('profileFavorites')
    .withIndex('by_user_rank', (q) => q.eq('userId', userId))
    .take(50);
  const itemRows = await Promise.all(favorites.map((favorite) => ctx.db.get(favorite.itemId)));
  const valid = favorites.flatMap((favorite, index) => {
    const item = itemRows[index];
    return item && item.userId === userId && item.deletingAt === undefined
      ? [{ favorite, item }]
      : [];
  });
  const titles = await activeResolvedTitles(
    ctx,
    valid.map(({ item }) => item),
  );
  return valid.map(({ favorite, item }) => {
    const title = titles.get(mediaIdentityKey(item));
    return {
      _id: item._id,
      title: title?.title ?? item.title,
      mediaType: item.mediaType,
      isAnime: title
        ? title.genres.some((genre) => genre.toLocaleLowerCase() === 'anime')
        : item.isAnime,
      posterPath: title?.posterPath ?? item.posterPath,
      rank: favorite.rank,
    };
  });
}

export const eligible = query({
  args: {
    search: v.optional(v.string()),
    /** Only titles for this favorites row, so other rows can't crowd it out. */
    section: v.optional(v.union(v.literal('tv'), v.literal('anime'), v.literal('movie'))),
  },
  returns: v.array(eligibleFavoriteValidator),
  handler: async (ctx, { search, section }) => {
    const userId = await requireUser(ctx);
    const normalizedSearch = search?.trim().toLowerCase().slice(0, 500) ?? '';
    // Watched titles of one stored type (by title), so other types can't crowd a shelf out.
    const watchedOfType = (mediaType: 'tv' | 'movie', limit: number) =>
      ctx.db
        .query('items')
        .withIndex('by_user_status_media_title', (q) => {
          const watched = q.eq('userId', userId).eq('status', 'watched').eq('mediaType', mediaType);
          return normalizedSearch
            ? watched
                .gte('normalizedTitle', normalizedSearch)
                .lt('normalizedTitle', `${normalizedSearch}\uffff`)
            : watched;
        })
        .take(limit);
    const watchedItems = async () => {
      if (section === 'tv' || section === 'movie') return watchedOfType(section, 1000);
      if (section === 'anime') {
        // Anime can be either type; both halves are merged back into title order.
        const [shows, films] = await Promise.all([
          watchedOfType('tv', 800),
          watchedOfType('movie', 800),
        ]);
        return [...shows, ...films].sort((left, right) =>
          left.normalizedTitle < right.normalizedTitle ? -1 : 1,
        );
      }
      return ctx.db
        .query('items')
        .withIndex('by_user_status_title', (q) => {
          const watched = q.eq('userId', userId).eq('status', 'watched');
          return normalizedSearch
            ? watched
                .gte('normalizedTitle', normalizedSearch)
                .lt('normalizedTitle', `${normalizedSearch}\uffff`)
            : watched;
        })
        .take(250);
    };
    const [items, favorites] = await Promise.all([
      watchedItems(),
      ctx.db
        .query('profileFavorites')
        .withIndex('by_user_rank', (q) => q.eq('userId', userId))
        .take(50),
    ]);
    const selected = new Set(favorites.map((favorite) => favorite.itemId));
    const available = items.filter(
      (item) => item.deletingAt === undefined && !selected.has(item._id),
    );
    // Canonical lookups are bounded, so likely members by their stored type go first (a shelf
    // can't be crowded out by another shelf's titles), then the rest in case the stored type is
    // out of date; canonical metadata then confirms the shelf, and the list goes back to A–Z.
    const storedAnime = (item: Doc<'items'>) =>
      !!item.isAnime || !!item.genres?.some((genre) => /anim/i.test(genre));
    const likely = (item: Doc<'items'>) =>
      !section || (section === 'anime' ? storedAnime(item) : !storedAnime(item));
    const candidates = [...available.filter(likely), ...available.filter((item) => !likely(item))]
      .slice(0, 250)
      .sort((left, right) => (left.normalizedTitle < right.normalizedTitle ? -1 : 1));
    // The same canonical title, poster and anime flag the favorites rows show.
    const titles = await activeResolvedTitles(ctx, candidates);
    return candidates
      .map((item) => {
        const title = titles.get(mediaIdentityKey(item));
        return {
          _id: item._id,
          title: title?.title ?? item.title,
          mediaType: item.mediaType,
          isAnime: title
            ? title.genres.some((genre) => genre.toLocaleLowerCase() === 'anime')
            : item.isAnime,
          posterPath: title?.posterPath ?? item.posterPath,
        };
      })
      .filter(
        (item) =>
          !section ||
          (section === 'anime' ? item.isAnime : !item.isAnime && item.mediaType === section),
      )
      .slice(0, 200);
  },
});

export const add = mutation({
  args: { itemId: v.id('items') },
  returns: v.id('profileFavorites'),
  handler: async (ctx, { itemId }) => {
    const userId = await requireUser(ctx);
    const item = await ctx.db.get(itemId);
    if (
      !item ||
      item.userId !== userId ||
      item.deletingAt !== undefined ||
      item.status !== 'watched'
    )
      throw new Error('Only watched titles can be added to profile favorites');
    const existing = await ctx.db
      .query('profileFavorites')
      .withIndex('by_user_item', (q) => q.eq('userId', userId).eq('itemId', itemId))
      .unique();
    if (existing) return existing._id;
    const favorites = await ctx.db
      .query('profileFavorites')
      .withIndex('by_user_rank', (q) => q.eq('userId', userId))
      .order('desc')
      .take(50);
    if (favorites.length >= 50) throw new Error('Profile favorites are limited to 50 titles');
    const last = favorites[0];
    const now = Date.now();
    return ctx.db.insert('profileFavorites', {
      userId,
      itemId,
      rank: (last?.rank ?? 0) + 1,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const remove = mutation({
  args: { itemId: v.id('items') },
  returns: v.null(),
  handler: async (ctx, { itemId }) => {
    const userId = await requireUser(ctx);
    const favorite = await ctx.db
      .query('profileFavorites')
      .withIndex('by_user_item', (q) => q.eq('userId', userId).eq('itemId', itemId))
      .unique();
    if (favorite) await ctx.db.delete(favorite._id);
  },
});

export const reorder = mutation({
  args: {
    itemId: v.id('items'),
    beforeId: v.optional(v.id('items')),
    afterId: v.optional(v.id('items')),
  },
  returns: v.null(),
  handler: async (ctx, { itemId, beforeId, afterId }) => {
    const userId = await requireUser(ctx);
    const rows = await ctx.db
      .query('profileFavorites')
      .withIndex('by_user_rank', (q) => q.eq('userId', userId))
      .take(51);
    if (rows.length > 50) throw new Error('Profile favorites are limited to 50 titles');
    const current = rows.find((row) => row.itemId === itemId);
    if (!current) throw new Error('Favorite not found');
    const remaining = rows.filter((row) => row.itemId !== itemId);
    let index = remaining.length;
    if (afterId !== undefined) {
      const afterIndex = remaining.findIndex((row) => row.itemId === afterId);
      if (afterIndex < 0) throw new Error('Favorite neighbor not found');
      index = afterIndex;
    } else if (beforeId !== undefined) {
      const beforeIndex = remaining.findIndex((row) => row.itemId === beforeId);
      if (beforeIndex < 0) throw new Error('Favorite neighbor not found');
      index = beforeIndex + 1;
    }
    remaining.splice(index, 0, current);
    const now = Date.now();
    await Promise.all(
      remaining.map((row, rank) => ctx.db.patch(row._id, { rank: rank + 1, updatedAt: now })),
    );
  },
});
