import { internalMutation, mutation, query, type MutationCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { v } from 'convex/values';
import { rankAtEnd } from '../rank';
import { syncItemTagMemberships } from '../tagCollectionsModel';
import { itemActivityBase, writeActivityEvents, type ActivityEventWrite } from '../activityEvents';
import { itemValidator } from '../publicValidators';
import { refreshNextEpisode } from '../nextEpisode';
import { requestProfileStatsRefresh } from '../profileStatsRefresh';
import { validateTmdbId } from '../providerValidation';
import {
  addItemFields,
  type AddItemArgs,
  boundedOptional,
  hasTag,
  normalizedTagKey,
  normalizeGenres,
  normalizeTags,
  ownedItem,
  requireRating,
  requireReleaseDate,
  requireRuntime,
  requireUser,
  mediaType,
  rating,
  status,
} from './shared';

export const listItems = query({
  args: {},
  returns: v.array(itemValidator),
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const items = await ctx.db
      .query('items')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) => q.eq(q.field('deletingAt'), undefined))
      // Bounded for Convex read limits; Marker targets personal-library scale.
      .take(2000);
    return items;
  },
});

export const getOwnedItemByTmdb = query({
  args: { mediaType, tmdbId: v.number() },
  returns: v.union(v.null(), itemValidator),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    return ctx.db
      .query('items')
      .withIndex('by_user_tmdb', (query) =>
        query.eq('userId', userId).eq('mediaType', args.mediaType).eq('tmdbId', args.tmdbId),
      )
      .filter((query) => query.eq(query.field('deletingAt'), undefined))
      .unique();
  },
});

export const listTagSuggestions = query({
  args: { prefix: v.optional(v.string()) },
  returns: v.array(v.string()),
  handler: async (ctx, { prefix: rawPrefix }) => {
    const userId = await requireUser(ctx);
    const prefix = normalizedTagKey(rawPrefix ?? '').slice(0, 40);
    const collections = await ctx.db
      .query('tagCollections')
      .withIndex('by_user_tag', (query) => {
        const owned = query.eq('userId', userId);
        return prefix ? owned.gte('tagKey', prefix).lt('tagKey', `${prefix}\uffff`) : owned;
      })
      .take(prefix ? 50 : 200);
    return collections
      .map((collection) => collection.label)
      .sort((left, right) => left.localeCompare(right));
  },
});

export const listTagRanks = query({
  args: { tag: v.string() },
  returns: v.array(v.object({ itemId: v.id('items'), rank: v.number() })),
  handler: async (ctx, { tag }) => {
    const userId = await requireUser(ctx);
    const tagKey = normalizedTagKey(tag);
    if (!tagKey || tagKey.length > 40) return [];
    const collection = await ctx.db
      .query('tagCollections')
      .withIndex('by_user_tag', (query) => query.eq('userId', userId).eq('tagKey', tagKey))
      .unique();
    if (!collection) return [];
    const memberships = await ctx.db
      .query('tagMemberships')
      .withIndex('by_collection_rank', (query) => query.eq('collectionId', collection._id))
      .take(2_000);
    return memberships.map((membership) => ({
      itemId: membership.itemId,
      rank: membership.rank,
    }));
  },
});

export async function insertItem(ctx: MutationCtx, userId: Id<'users'>, args: AddItemArgs) {
  validateTmdbId(args.tmdbId);
  requireRating(args.rating);
  requireRuntime(args.runtime);
  requireReleaseDate(args.releaseDate);
  const genres = normalizeGenres(args.genres);
  const title = args.title.trim();
  if (!title || title.length > 500) throw new Error('Title must be between 1 and 500 characters');
  boundedOptional('Overview', args.overview, 2000);
  boundedOptional('Poster path', args.posterPath, 200);
  const normalizedTags = normalizeTags(args.tags ?? []);
  if (
    args.timesWatched !== undefined &&
    (!Number.isInteger(args.timesWatched) || args.timesWatched < 0)
  )
    throw new Error('timesWatched must be a non-negative integer');
  const duplicate = await ctx.db
    .query('items')
    .withIndex('by_user_tmdb', (q) =>
      q.eq('userId', userId).eq('mediaType', args.mediaType).eq('tmdbId', args.tmdbId),
    )
    .filter((q) => q.eq(q.field('deletingAt'), undefined))
    .unique();
  if (duplicate) throw new Error('Item already exists in library');
  const now = Date.now();
  const { timesWatched = 0, tags: _tags = [], genres: _genres, ...rest } = args;
  const itemId = await ctx.db.insert('items', {
    ...rest,
    userId,
    title,
    normalizedTitle: title.toLocaleLowerCase(),
    timesWatched,
    tags: normalizedTags,
    ...(genres !== undefined && { genres }),
    isAnime: genres?.some((genre) => genre.toLocaleLowerCase() === 'anime') ?? false,
    rank: await rankAtEnd(ctx, userId, args.status),
    createdAt: now,
    updatedAt: now,
  });
  const item = await ctx.db.get(itemId);
  if (item) {
    await requestProfileStatsRefresh(ctx, userId);
    await syncItemTagMemberships(ctx, item, normalizedTags);
    const events: ActivityEventWrite[] = [];
    if (item.rating !== undefined)
      events.push({ ...itemActivityBase(item), kind: 'rating', rating: item.rating });
    if (item.status === 'watched')
      events.push({ ...itemActivityBase(item), kind: 'finished', status: item.status });
    else if (item.status === 'watching')
      events.push({ ...itemActivityBase(item), kind: 'status', status: item.status });
    await writeActivityEvents(ctx, events);
    if (item.mediaType === 'tv') await refreshNextEpisode(ctx, item);
  }
  return itemId;
}

export const addItem = mutation({
  args: addItemFields,
  returns: v.id('items'),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    return insertItem(ctx, userId, args);
  },
});

export const addItemInternal = internalMutation({
  args: { userId: v.id('users'), ...addItemFields },
  handler: (ctx, { userId, ...args }) => insertItem(ctx, userId, args),
});

export const updateItem = mutation({
  args: {
    itemId: v.id('items'),
    status: v.optional(status),
    rating,
    clearRating: v.optional(v.boolean()),
    tags: v.optional(v.array(v.string())),
    timesWatched: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const item = await ownedItem(ctx, args.itemId, userId);
    requireRating(args.rating);
    if (
      args.timesWatched !== undefined &&
      (!Number.isInteger(args.timesWatched) || args.timesWatched < 0)
    )
      throw new Error('timesWatched must be a non-negative integer');
    const patch: Partial<Doc<'items'>> = { updatedAt: Date.now() };
    if (args.status !== undefined) patch.status = args.status;
    if (args.clearRating) patch.rating = undefined;
    else if (args.rating !== undefined) patch.rating = args.rating;
    const nextTags = args.tags === undefined ? undefined : normalizeTags(args.tags);
    if (nextTags !== undefined) patch.tags = nextTags;
    if (args.timesWatched !== undefined) patch.timesWatched = args.timesWatched;
    if (args.status !== undefined && args.status !== item.status) {
      patch.rank = await rankAtEnd(ctx, userId, args.status);
    }
    await ctx.db.patch(args.itemId, patch);
    await requestProfileStatsRefresh(ctx, userId);
    if (nextTags !== undefined) await syncItemTagMemberships(ctx, item, nextTags);
    const nextRating = args.clearRating
      ? undefined
      : args.rating !== undefined
        ? args.rating
        : item.rating;
    const events: ActivityEventWrite[] = [];
    if (nextRating !== item.rating)
      events.push({
        ...itemActivityBase(item),
        kind: 'rating',
        ...(nextRating !== undefined && { rating: nextRating }),
      });
    if (args.status !== undefined && args.status !== item.status)
      events.push({
        ...itemActivityBase(item),
        kind: args.status === 'watched' ? 'finished' : 'status',
        status: args.status,
      });
    await writeActivityEvents(ctx, events);
  },
});

export const addTagToItems = mutation({
  args: {
    itemIds: v.array(v.id('items')),
    tag: v.string(),
  },
  returns: v.object({ updated: v.number() }),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    if (args.itemIds.length > 100) throw new Error('Add tags to at most 100 titles at a time');
    const [tag] = normalizeTags([args.tag]);
    const uniqueIds = [...new Map(args.itemIds.map((itemId) => [String(itemId), itemId])).values()];
    const items = await Promise.all(uniqueIds.map((itemId) => ownedItem(ctx, itemId, userId)));
    const updates = items.flatMap((item) => {
      if (hasTag(item, normalizedTagKey(tag))) return [];
      return [{ item, tags: normalizeTags([...item.tags, tag]) }];
    });
    if (!updates.length) return { updated: 0 };

    const updatedAt = Date.now();
    for (const update of updates) {
      await ctx.db.patch(update.item._id, { tags: update.tags, updatedAt });
      await syncItemTagMemberships(ctx, update.item, update.tags);
    }
    await requestProfileStatsRefresh(ctx, userId);
    return { updated: updates.length };
  },
});

export const removeItem = mutation({
  args: { itemId: v.id('items') },
  returns: v.null(),
  handler: async (ctx, { itemId }) => {
    const userId = await requireUser(ctx);
    const item = await ctx.db.get(itemId);
    // A completed continuation is also a successful idempotent rerun.
    if (!item) return;
    if (item.userId !== userId) throw new Error('Item not found');
    if (item.deletingAt === undefined) {
      await ctx.db.patch(itemId, { deletingAt: Date.now() });
      await requestProfileStatsRefresh(ctx, userId);
    }
    await ctx.scheduler.runAfter(0, internal.library.items.continueRemoveItem, { itemId });
  },
});

const REMOVE_BATCH_SIZE = 500;

export const continueRemoveItem = internalMutation({
  args: { itemId: v.id('items') },
  handler: async (ctx, { itemId }) => {
    const item = await ctx.db.get(itemId);
    if (!item || item.deletingAt === undefined) return { deleted: 0, done: true };
    const episodes = await ctx.db
      .query('episodes')
      .withIndex('by_item', (query) => query.eq('itemId', itemId))
      .take(REMOVE_BATCH_SIZE);
    if (episodes.length > 0) {
      for (const episode of episodes) await ctx.db.delete(episode._id);
      await ctx.scheduler.runAfter(0, internal.library.items.continueRemoveItem, { itemId });
      return { deleted: episodes.length, done: false };
    }
    const summaries = await ctx.db
      .query('episodeSummaries')
      .withIndex('by_item', (query) => query.eq('itemId', itemId))
      .take(REMOVE_BATCH_SIZE);
    if (summaries.length > 0) {
      for (const summary of summaries) await ctx.db.delete(summary._id);
      await ctx.scheduler.runAfter(0, internal.library.items.continueRemoveItem, { itemId });
      return { deleted: summaries.length, done: false };
    }
    const tagMemberships = await ctx.db
      .query('tagMemberships')
      .withIndex('by_item', (query) => query.eq('itemId', itemId))
      .take(REMOVE_BATCH_SIZE);
    if (tagMemberships.length > 0) {
      for (const membership of tagMemberships) await ctx.db.delete(membership._id);
      await ctx.scheduler.runAfter(0, internal.library.items.continueRemoveItem, { itemId });
      return { deleted: tagMemberships.length, done: false };
    }
    const profileFavorites = await ctx.db
      .query('profileFavorites')
      .withIndex('by_item', (query) => query.eq('itemId', itemId))
      .take(REMOVE_BATCH_SIZE);
    if (profileFavorites.length > 0) {
      for (const favorite of profileFavorites) await ctx.db.delete(favorite._id);
      await ctx.scheduler.runAfter(0, internal.library.items.continueRemoveItem, { itemId });
      return { deleted: profileFavorites.length, done: false };
    }
    const [coordinateRefresh, projectionRepair] = await Promise.all([
      ctx.db
        .query('nextEpisodeRefreshes')
        .withIndex('by_item', (query) => query.eq('itemId', itemId))
        .unique(),
      ctx.db
        .query('episodeProjectionRepairs')
        .withIndex('by_item', (query) => query.eq('itemId', itemId))
        .unique(),
    ]);
    if (coordinateRefresh) await ctx.db.delete(coordinateRefresh._id);
    if (projectionRepair) await ctx.db.delete(projectionRepair._id);
    await ctx.db.delete(itemId);
    return { deleted: 1, done: true };
  },
});
