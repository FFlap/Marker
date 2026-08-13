import { getClerkUserId } from './clerkAuth';
import { mutation, query, type QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { v } from 'convex/values';
import { activeResolvedTitles, mediaIdentityKey } from './resolvedTitleModel';
import { eligibleFavoriteValidator, favoriteValidator } from './publicValidators';

const requireUser = async (ctx: { auth: Parameters<typeof getClerkUserId>[0]['auth'] }) => {
  const userId = await getClerkUserId(ctx);
  if (!userId) throw new Error('Authentication required');
  return userId;
};

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

export const mine = query({
  args: {},
  returns: v.array(favoriteValidator),
  handler: async (ctx) => profileFavoritesForUser(ctx, await requireUser(ctx)),
});

export const eligible = query({
  args: {},
  returns: v.array(eligibleFavoriteValidator),
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const [items, favorites] = await Promise.all([
      ctx.db
        .query('items')
        .withIndex('by_user_status', (q) => q.eq('userId', userId).eq('status', 'watched'))
        .take(2000),
      ctx.db
        .query('profileFavorites')
        .withIndex('by_user_rank', (q) => q.eq('userId', userId))
        .take(50),
    ]);
    const selected = new Set(favorites.map((favorite) => favorite.itemId));
    const eligibleItems = items
      .filter((item) => item.deletingAt === undefined && !selected.has(item._id))
      .slice(0, 200);
    const titles = await activeResolvedTitles(ctx, eligibleItems);
    return eligibleItems.map((item) => {
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
    });
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
