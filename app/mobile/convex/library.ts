import { getClerkUserId } from './clerkAuth';
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { ConvexError, v } from 'convex/values';
import { rankAtEnd } from './rank';
import { EPISODES_PER_CHUNK, MAX_SEASON_EPISODES } from './seasonStorage';
import { seasonSummaryIdentityKey, updateSummaryForEpisodeUpsert } from './episodeSummaries';
import {
  ensureTagMemberships,
  refreshTagCollectionSummary,
  syncItemTagMemberships,
} from './tagCollectionsModel';
import { itemActivityBase, writeActivityEvents, type ActivityEventWrite } from './activityEvents';
import { episodeValidator, itemValidator } from './publicValidators';
import { refreshNextEpisode } from './nextEpisode';
import { requestProfileStatsRefresh } from './profileStatsRefresh';

const status = v.union(
  v.literal('watched'),
  v.literal('watching'),
  v.literal('watchlist'),
  v.literal('dropped'),
);
const mediaType = v.union(v.literal('movie'), v.literal('tv'));
const rating = v.optional(v.number());
const addItemFields = {
  tmdbId: v.number(),
  mediaType,
  title: v.string(),
  posterPath: v.optional(v.string()),
  overview: v.optional(v.string()),
  releaseDate: v.optional(v.string()),
  runtime: v.optional(v.number()),
  genres: v.optional(v.array(v.string())),
  status,
  rating,
  timesWatched: v.optional(v.number()),
  tags: v.optional(v.array(v.string())),
};
type AddItemArgs = {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath?: string;
  overview?: string;
  releaseDate?: string;
  runtime?: number;
  genres?: string[];
  status: 'watched' | 'watching' | 'watchlist' | 'dropped';
  rating?: number;
  timesWatched?: number;
  tags?: string[];
};
const requireRating = (value: number | undefined) => {
  if (value !== undefined && (value < 0 || value > 10))
    throw new Error('Rating must be between 0 and 10');
};
const boundedOptional = (name: string, value: string | undefined, max: number) => {
  if (value !== undefined && value.length > max)
    throw new Error(`${name} must be at most ${max} characters`);
};
const requireRuntime = (value: number | undefined) => {
  if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 3000))
    throw new Error('Runtime must be a finite number between 0 and 3000 minutes');
};
const normalizeGenres = (genres: string[] | undefined) => {
  if (genres === undefined) return undefined;
  if (genres.length > 15) throw new Error('Genres are limited to 15 entries');
  return genres.map((genre) => {
    const value = genre.trim();
    if (!value || value.length > 50)
      throw new Error('Each genre must be between 1 and 50 characters');
    return value;
  });
};
export const normalizeTags = (tags: string[]) => {
  if (tags.length > 20) throw new Error('Tags are limited to 20 per item or episode');
  const seen = new Set<string>();
  return tags.flatMap((raw) => {
    const tag = raw.trim();
    if (!tag || tag.length > 40) throw new Error('Each tag must be between 1 and 40 characters');
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [tag];
  });
};
const normalizedTagKey = (tag: string) => tag.trim().toLocaleLowerCase();
const hasTag = (item: Doc<'items'>, tagKey: string) =>
  item.tags.some((tag) => normalizedTagKey(tag) === tagKey);
const requireUser = async (ctx: { auth: Parameters<typeof getClerkUserId>[0]['auth'] }) => {
  const userId = await getClerkUserId(ctx);
  if (!userId) throw new Error('Authentication required');
  return userId;
};
const ownedItem = async (
  ctx: { db: { get: (id: Id<'items'>) => Promise<Doc<'items'> | null> } },
  id: Id<'items'>,
  userId: Id<'users'>,
) => {
  const item = await ctx.db.get(id);
  if (!item || item.userId !== userId || item.deletingAt !== undefined)
    throw new Error('Item not found');
  return item;
};

type EpisodeMetadataStamp = {
  metadataProvider: 'tmdb' | 'tvdb';
  seasonOrder?: string;
  providerEpisodeId?: number;
  summaryIdentityKey?: string;
  summaryTotal?: number;
  seasonName?: string;
  name?: string;
  overview?: string;
  runtime?: number;
  imageUrl?: string;
  airDate?: string;
};

const episodeMetadataStamp = async (
  ctx: MutationCtx,
  item: Doc<'items'>,
  season: number,
  episode: number,
): Promise<EpisodeMetadataStamp> => {
  const [mapping, title, resolved] = await Promise.all([
    ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', item.mediaType).eq('tmdbId', item.tmdbId))
      .unique(),
    ctx.db
      .query('resolvedTitles')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', item.mediaType).eq('tmdbId', item.tmdbId))
      .unique(),
    ctx.db
      .query('resolvedSeasons')
      .withIndex('by_tmdb_season', (q) => q.eq('tmdbId', item.tmdbId).eq('season', season))
      .unique(),
  ]);
  const activeResolved =
    resolved &&
    resolved.chunksComplete === true &&
    resolved.chunkCount !== undefined &&
    resolved.seasonVersion !== undefined &&
    (resolved.metadataProvider === 'tmdb' ||
      (mapping !== null && resolved.orderEpoch === mapping.orderEpoch))
      ? resolved
      : undefined;
  let canonicalEpisode: Doc<'resolvedSeasonChunks'>['episodes'][number] | undefined;
  if (activeResolved) {
    const chunkCount = activeResolved.chunkCount!;
    const seasonVersion = activeResolved.seasonVersion!;
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      const chunk = await ctx.db
        .query('resolvedSeasonChunks')
        .withIndex('by_tmdb_season_version_chunk', (query) =>
          query
            .eq('tmdbId', item.tmdbId)
            .eq('season', season)
            .eq('seasonVersion', seasonVersion)
            .eq('chunkIndex', chunkIndex),
        )
        .unique();
      if (!chunk) break;
      canonicalEpisode = chunk.episodes.find((entry) => entry.episode === episode);
      if (canonicalEpisode) break;
      const last = chunk.episodes.reduce(
        (maximum, entry) => Math.max(maximum, entry.episode),
        Number.NEGATIVE_INFINITY,
      );
      if (episode <= last) break;
    }
  }
  const metadataProvider = activeResolved?.metadataProvider ?? 'tmdb';
  const seasonOrder = mapping?.seasonOrder;
  const activeTitle =
    title && (mapping?.orderEpoch === undefined || title.orderEpoch === mapping.orderEpoch)
      ? title
      : undefined;
  const seasonName = activeTitle?.seasons.find((entry) => entry.season === season)?.name;
  if (!canonicalEpisode || (metadataProvider === 'tvdb' && seasonOrder === undefined))
    return {
      metadataProvider,
      seasonOrder: metadataProvider === 'tvdb' ? seasonOrder : undefined,
      ...(seasonName !== undefined && { seasonName }),
      name: canonicalEpisode?.name,
      overview: canonicalEpisode?.overview,
      runtime: canonicalEpisode?.runtime,
      imageUrl: canonicalEpisode?.imageUrl,
      airDate: canonicalEpisode?.airDate,
    };
  return {
    metadataProvider,
    seasonOrder: metadataProvider === 'tvdb' ? seasonOrder : undefined,
    // Undefined is intentional: a verified replacement clears a stale id.
    providerEpisodeId: canonicalEpisode.providerEpisodeId,
    summaryIdentityKey: seasonSummaryIdentityKey(activeResolved!, seasonOrder),
    summaryTotal: activeResolved!.episodeCount,
    ...(seasonName !== undefined && { seasonName }),
    name: canonicalEpisode.name,
    overview: canonicalEpisode.overview,
    runtime: canonicalEpisode.runtime,
    imageUrl: canonicalEpisode.imageUrl,
    airDate: canonicalEpisode.airDate,
  };
};

const episodeMatchesStamp = (
  episode: Doc<'episodes'> | null | undefined,
  stamp: {
    metadataProvider?: 'tmdb' | 'tvdb';
    seasonOrder?: string;
    providerEpisodeId?: number;
  },
) =>
  !!episode &&
  episode.metadataProvider === stamp.metadataProvider &&
  episode.seasonOrder === stamp.seasonOrder &&
  episode.providerEpisodeId === stamp.providerEpisodeId;

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
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const items = await ctx.db
      .query('items')
      .withIndex('by_user', (query) => query.eq('userId', userId))
      .filter((query) => query.eq(query.field('deletingAt'), undefined))
      .take(2_000);
    return [...new Set(items.flatMap((item) => item.tags))].sort((left, right) =>
      left.localeCompare(right),
    );
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

async function insertItem(ctx: MutationCtx, userId: Id<'users'>, args: AddItemArgs) {
  requireRating(args.rating);
  requireRuntime(args.runtime);
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
    await ctx.scheduler.runAfter(0, internal.library.continueRemoveItem, { itemId });
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
      await ctx.scheduler.runAfter(0, internal.library.continueRemoveItem, { itemId });
      return { deleted: episodes.length, done: false };
    }
    const summaries = await ctx.db
      .query('episodeSummaries')
      .withIndex('by_item', (query) => query.eq('itemId', itemId))
      .take(REMOVE_BATCH_SIZE);
    if (summaries.length > 0) {
      for (const summary of summaries) await ctx.db.delete(summary._id);
      await ctx.scheduler.runAfter(0, internal.library.continueRemoveItem, { itemId });
      return { deleted: summaries.length, done: false };
    }
    const tagMemberships = await ctx.db
      .query('tagMemberships')
      .withIndex('by_item', (query) => query.eq('itemId', itemId))
      .take(REMOVE_BATCH_SIZE);
    if (tagMemberships.length > 0) {
      for (const membership of tagMemberships) await ctx.db.delete(membership._id);
      await ctx.scheduler.runAfter(0, internal.library.continueRemoveItem, { itemId });
      return { deleted: tagMemberships.length, done: false };
    }
    const profileFavorites = await ctx.db
      .query('profileFavorites')
      .withIndex('by_item', (query) => query.eq('itemId', itemId))
      .take(REMOVE_BATCH_SIZE);
    if (profileFavorites.length > 0) {
      for (const favorite of profileFavorites) await ctx.db.delete(favorite._id);
      await ctx.scheduler.runAfter(0, internal.library.continueRemoveItem, { itemId });
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

type MoveItemArgs = {
  itemId: Id<'items'>;
  status?: Doc<'items'>['status'];
  beforeId?: Id<'items'>;
  afterId?: Id<'items'>;
};

async function moveItemToSlot(ctx: MutationCtx, userId: Id<'users'>, args: MoveItemArgs) {
  const item = await ownedItem(ctx, args.itemId, userId);
  const targetStatus = args.status ?? item.status;
  const claimedBefore = args.beforeId ? await ownedItem(ctx, args.beforeId, userId) : undefined;
  const claimedAfter = args.afterId ? await ownedItem(ctx, args.afterId, userId) : undefined;
  if (claimedBefore?._id === item._id || claimedAfter?._id === item._id)
    throw new Error('An item cannot be its own neighbor');
  if (claimedBefore && claimedBefore.status !== targetStatus)
    throw new Error('Neighbors must share a status');
  if (claimedAfter && claimedAfter.status !== targetStatus)
    throw new Error('Neighbors must share a status');

  const loadOrdered = async () => {
    const items = await ctx.db
      .query('items')
      .withIndex('by_user_status', (q) => q.eq('userId', userId).eq('status', targetStatus))
      .filter((q) => q.eq(q.field('deletingAt'), undefined))
      .take(2001);
    if (items.length > 2000) throw new Error('Too many items to reorder');
    return items.sort(
      (a, b) =>
        a.rank - b.rank ||
        a._creationTime - b._creationTime ||
        String(a._id).localeCompare(String(b._id)),
    );
  };
  let ordered = await loadOrdered();
  let withoutMoved = ordered.filter((entry) => entry._id !== item._id);
  const indexById = new Map(withoutMoved.map((entry, index) => [entry._id, index]));
  const beforeIndex = claimedBefore ? indexById.get(claimedBefore._id) : undefined;
  const afterIndex = claimedAfter ? indexById.get(claimedAfter._id) : undefined;

  // Valid client claims identify one authoritative slot. Stale claims are projected
  // to the closest slot between their current server-side positions.
  let slot: number;
  if (beforeIndex !== undefined && afterIndex !== undefined) {
    slot = Math.round((beforeIndex + 1 + afterIndex) / 2);
  } else if (beforeIndex !== undefined) slot = beforeIndex + 1;
  else if (afterIndex !== undefined) slot = afterIndex;
  else slot = 0;
  slot = Math.max(0, Math.min(slot, withoutMoved.length));
  let before = withoutMoved[slot - 1];
  let after = withoutMoved[slot];

  if (before && after && after.rank - before.rank < 1e-9) {
    for (const [index, entry] of ordered.entries())
      await ctx.db.patch(entry._id, { rank: index + 1 });
    ordered = await loadOrdered();
    withoutMoved = ordered.filter((entry) => entry._id !== item._id);
    before = withoutMoved[slot - 1];
    after = withoutMoved[slot];
  }
  let rank: number;
  if (before && after) rank = (before.rank + after.rank) / 2;
  else if (before) rank = before.rank + 1;
  else if (after) rank = after.rank - 1;
  else rank = 1;
  await ctx.db.patch(args.itemId, {
    status: targetStatus,
    rank,
    ...(targetStatus === 'watched' && {
      timesWatched: Math.max(1, item.timesWatched),
    }),
    updatedAt: Date.now(),
  });
  await requestProfileStatsRefresh(ctx, userId);
  if (targetStatus !== item.status)
    await writeActivityEvents(ctx, [
      {
        ...itemActivityBase(item),
        kind: targetStatus === 'watched' ? 'finished' : 'status',
        status: targetStatus,
      },
    ]);
  return rank;
}

export const reorderItem = mutation({
  args: {
    itemId: v.id('items'),
    status: v.optional(status),
    beforeId: v.optional(v.id('items')),
    afterId: v.optional(v.id('items')),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    return moveItemToSlot(ctx, userId, args);
  },
});

export const reorderTagItem = mutation({
  args: {
    tag: v.string(),
    itemId: v.id('items'),
    beforeId: v.optional(v.id('items')),
    afterId: v.optional(v.id('items')),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const tagKey = normalizedTagKey(args.tag);
    if (!tagKey || tagKey.length > 40) throw new Error('Tag not found');
    const moved = await ownedItem(ctx, args.itemId, userId);
    if (!hasTag(moved, tagKey)) throw new Error('Item is not in this tag');
    const collection = await ensureTagMemberships(ctx, userId, args.tag);

    const allItems = await ctx.db
      .query('items')
      .withIndex('by_user', (query) => query.eq('userId', userId))
      .filter((query) => query.eq(query.field('deletingAt'), undefined))
      .take(2_001);
    if (allItems.length > 2_000) throw new Error('Too many items to reorder');
    const members = allItems.filter((item) => hasTag(item, tagKey));
    const memberships = await ctx.db
      .query('tagMemberships')
      .withIndex('by_collection_rank', (query) => query.eq('collectionId', collection._id))
      .take(2_001);
    if (memberships.length > 2_000) throw new Error('Too many items to reorder');
    const membershipByItem = new Map(
      memberships.map((membership) => [String(membership.itemId), membership]),
    );
    let ordered = [...members].sort((left, right) => {
      const leftRank = membershipByItem.get(String(left._id))?.rank;
      const rightRank = membershipByItem.get(String(right._id))?.rank;
      if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
      if (leftRank !== undefined) return -1;
      if (rightRank !== undefined) return 1;
      return (
        left.rank - right.rank ||
        left._creationTime - right._creationTime ||
        String(left._id).localeCompare(String(right._id))
      );
    });
    if (ordered.some((item) => !membershipByItem.has(String(item._id))))
      throw new Error('Tag membership could not be initialized');

    ordered = ordered.filter((item) => item._id !== moved._id);
    const indexById = new Map(ordered.map((item, index) => [String(item._id), index]));
    const beforeIndex = args.beforeId ? indexById.get(String(args.beforeId)) : undefined;
    const afterIndex = args.afterId ? indexById.get(String(args.afterId)) : undefined;
    let slot: number;
    if (beforeIndex !== undefined && afterIndex !== undefined)
      slot = Math.round((beforeIndex + 1 + afterIndex) / 2);
    else if (beforeIndex !== undefined) slot = beforeIndex + 1;
    else if (afterIndex !== undefined) slot = afterIndex;
    else slot = 0;
    slot = Math.max(0, Math.min(slot, ordered.length));

    let before = ordered[slot - 1];
    let after = ordered[slot];
    let beforeRank = before ? membershipByItem.get(String(before._id))?.rank : undefined;
    let afterRank = after ? membershipByItem.get(String(after._id))?.rank : undefined;
    if (
      before &&
      after &&
      beforeRank !== undefined &&
      afterRank !== undefined &&
      afterRank - beforeRank < 1e-9
    ) {
      const now = Date.now();
      for (const [index, item] of ordered.entries()) {
        const membership = membershipByItem.get(String(item._id));
        if (!membership) throw new Error('Tag membership could not be initialized');
        await ctx.db.patch(membership._id, { rank: index + 1, updatedAt: now });
        membershipByItem.set(String(item._id), { ...membership, rank: index + 1 });
      }
      before = ordered[slot - 1];
      after = ordered[slot];
      beforeRank = before ? membershipByItem.get(String(before._id))?.rank : undefined;
      afterRank = after ? membershipByItem.get(String(after._id))?.rank : undefined;
    }
    const nextRank =
      beforeRank !== undefined && afterRank !== undefined
        ? (beforeRank + afterRank) / 2
        : beforeRank !== undefined
          ? beforeRank + 1
          : afterRank !== undefined
            ? afterRank - 1
            : 1;
    const current = membershipByItem.get(String(moved._id));
    if (!current) throw new Error('Tag order could not be initialized');
    await ctx.db.patch(current._id, { rank: nextRank, updatedAt: Date.now() });
    await refreshTagCollectionSummary(ctx, collection._id, collection.memberCount);
    const membership = await ctx.db
      .query('tagMemberships')
      .withIndex('by_user_tag_item', (query) =>
        query.eq('userId', userId).eq('tagKey', tagKey).eq('itemId', moved._id),
      )
      .unique();
    if (!membership || membership.collectionId !== collection._id)
      throw new Error('Tag membership could not be initialized');
    if (membership._id !== current._id) throw new Error('Tag membership could not be initialized');
    return nextRank;
  },
});

export const getOwnedItemForStatusMove = internalQuery({
  args: { userId: v.id('users'), itemId: v.id('items') },
  handler: (ctx, { userId, itemId }) => ownedItem(ctx, itemId, userId),
});

export const moveItemToSlotInternal = internalMutation({
  args: {
    userId: v.id('users'),
    itemId: v.id('items'),
    status,
    beforeId: v.optional(v.id('items')),
    afterId: v.optional(v.id('items')),
  },
  handler: (ctx, { userId, ...args }) => moveItemToSlot(ctx, userId, args),
});

const episodeArgs = {
  itemId: v.id('items'),
  season: v.number(),
  episode: v.number(),
  watched: v.optional(v.boolean()),
  rating,
  clearRating: v.optional(v.boolean()),
  tags: v.optional(v.array(v.string())),
  seasonName: v.optional(v.string()),
  name: v.optional(v.string()),
  overview: v.optional(v.string()),
  runtime: v.optional(v.number()),
  imageUrl: v.optional(v.string()),
  airDate: v.optional(v.string()),
};
async function setEpisode(
  ctx: MutationCtx,
  userId: Id<'users'>,
  args: {
    itemId: Id<'items'>;
    season: number;
    episode: number;
    watched?: boolean;
    rating?: number;
    clearRating?: boolean;
    tags?: string[];
    seasonName?: string;
    name?: string;
    overview?: string;
    runtime?: number;
    imageUrl?: string;
    airDate?: string;
    stamp?: EpisodeMetadataStamp;
  },
  knownItem?: Doc<'items'>,
  knownExisting?: Doc<'episodes'> | null,
  activityEvents?: ActivityEventWrite[],
  refreshCoordinate = true,
) {
  if (!Number.isInteger(args.season) || args.season < 0 || args.season > 10_000)
    throw new Error('Season must be an integer between 0 and 10000');
  if (!Number.isInteger(args.episode) || args.episode < 0 || args.episode > 10_000)
    throw new Error('Episode must be an integer between 0 and 10000');
  const item = knownItem ?? (await ownedItem(ctx, args.itemId, userId));
  requireRating(args.rating);
  requireRuntime(args.runtime);
  boundedOptional('Season name', args.seasonName, 300);
  boundedOptional('Episode name', args.name, 300);
  boundedOptional('Episode overview', args.overview, 400);
  boundedOptional('Episode image URL', args.imageUrl, 500);
  boundedOptional('Episode air date', args.airDate, 50);
  const tags = args.tags === undefined ? undefined : normalizeTags(args.tags);
  const existing =
    knownExisting === undefined
      ? await ctx.db
          .query('episodes')
          .withIndex('by_item', (q) =>
            q.eq('itemId', args.itemId).eq('season', args.season).eq('episode', args.episode),
          )
          .unique()
      : knownExisting;
  const watched = args.watched ?? existing?.watched ?? false;
  const nextRating = args.clearRating
    ? undefined
    : args.rating !== undefined
      ? args.rating
      : existing?.rating;
  const stamp = args.stamp ?? (await episodeMetadataStamp(ctx, item, args.season, args.episode));
  const materializeDisplay = watched || nextRating !== undefined;
  const display = {
    seasonName: stamp.seasonName ?? args.seasonName,
    name: stamp.name ?? args.name,
    overview: stamp.overview ?? args.overview,
    runtime: stamp.runtime ?? args.runtime,
    imageUrl: stamp.imageUrl ?? args.imageUrl,
    airDate: stamp.airDate ?? args.airDate,
  };
  const values = {
    watched,
    ...(args.clearRating
      ? { rating: undefined }
      : args.rating !== undefined && { rating: args.rating }),
    ...(tags !== undefined && { tags }),
    ...(materializeDisplay &&
      display.seasonName !== undefined && {
        seasonName: display.seasonName,
      }),
    ...(materializeDisplay && display.name !== undefined && { name: display.name }),
    ...(materializeDisplay && display.overview !== undefined && { overview: display.overview }),
    ...(materializeDisplay && display.runtime !== undefined && { runtime: display.runtime }),
    ...(materializeDisplay && display.imageUrl !== undefined && { imageUrl: display.imageUrl }),
    ...(materializeDisplay && display.airDate !== undefined && { airDate: display.airDate }),
    ...(watched && !existing?.watched && { watchedAt: Date.now() }),
    ...(!watched && existing?.watched && { watchedAt: undefined }),
    metadataProvider: stamp.metadataProvider,
    seasonOrder: stamp.seasonOrder,
    providerEpisodeId: stamp.providerEpisodeId,
  };
  await updateSummaryForEpisodeUpsert(
    ctx,
    userId,
    args.itemId,
    args.season,
    watched,
    existing,
    stamp.summaryIdentityKey
      ? {
          key: stamp.summaryIdentityKey,
          total: stamp.summaryTotal!,
          existingMatches: episodeMatchesStamp(existing, stamp),
          nextMatches: true,
        }
      : undefined,
    {
      runtime: display.runtime ?? existing?.runtime,
      unverified: existing?.unverified,
      tags: tags ?? existing?.tags ?? [],
    },
  );
  const semanticEvents: ActivityEventWrite[] = [];
  if (!existing?.watched && watched)
    semanticEvents.push({
      ...itemActivityBase(item),
      kind: 'episode',
      season: args.season,
      episode: args.episode,
    });
  if (nextRating !== existing?.rating)
    semanticEvents.push({
      ...itemActivityBase(item),
      kind: 'rating',
      season: args.season,
      episode: args.episode,
      ...(nextRating !== undefined && { rating: nextRating }),
    });
  if (activityEvents) activityEvents.push(...semanticEvents);
  else await writeActivityEvents(ctx, semanticEvents);
  let episodeId: Id<'episodes'>;
  if (existing) {
    await ctx.db.patch(existing._id, values);
    episodeId = existing._id;
  } else {
    episodeId = await ctx.db.insert('episodes', {
      userId,
      itemId: args.itemId,
      season: args.season,
      episode: args.episode,
      tags: tags ?? [],
      ...values,
    });
  }
  if (refreshCoordinate)
    await refreshNextEpisode(
      ctx,
      item._id,
      watched ? { season: args.season, episode: args.episode } : undefined,
    );
  return episodeId;
}
export const setEpisodeState = mutation({
  args: episodeArgs,
  returns: v.id('episodes'),
  handler: async (ctx, args) => setEpisode(ctx, await requireUser(ctx), args),
});

const matchesCurrentEpisodeIdentity = (
  episode: Doc<'episodes'>,
  provider: 'tmdb' | 'tvdb' | undefined,
  mapping: Doc<'titleMappings'> | null,
  canonicalIdentityKnown: boolean,
  canonicalCoordinateExists: boolean,
  canonicalProviderEpisodeId?: number,
) => {
  if (canonicalIdentityKnown && !canonicalCoordinateExists) return false;
  if (provider === undefined || episode.metadataProvider !== provider) return false;
  const currentOrder = provider === 'tvdb' ? mapping?.seasonOrder : undefined;
  if (episode.seasonOrder !== currentOrder) return false;
  return !canonicalIdentityKnown || episode.providerEpisodeId === canonicalProviderEpisodeId;
};

export const listEpisodes = query({
  args: { itemId: v.id('items'), season: v.number(), pageCount: v.optional(v.number()) },
  returns: v.array(episodeValidator),
  handler: async (ctx, { itemId, season, pageCount = 1 }) => {
    const userId = await requireUser(ctx);
    const item = await ownedItem(ctx, itemId, userId);
    if (!Number.isInteger(season) || season < 0 || season > 10_000)
      throw new Error('Season must be an integer between 0 and 10000');
    const maximumPages = MAX_SEASON_EPISODES / EPISODES_PER_CHUNK;
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > maximumPages)
      throw new Error(`Episode state pages must be between 1 and ${maximumPages}`);
    const [mapping, title, resolvedSeason] = await Promise.all([
      ctx.db
        .query('titleMappings')
        .withIndex('by_tmdb', (query) =>
          query.eq('mediaType', item.mediaType).eq('tmdbId', item.tmdbId),
        )
        .unique(),
      ctx.db
        .query('resolvedTitles')
        .withIndex('by_tmdb', (query) =>
          query.eq('mediaType', item.mediaType).eq('tmdbId', item.tmdbId),
        )
        .unique(),
      ctx.db
        .query('resolvedSeasons')
        .withIndex('by_tmdb_season', (query) =>
          query.eq('tmdbId', item.tmdbId).eq('season', season),
        )
        .unique(),
    ]);
    const activeSeason =
      resolvedSeason &&
      (resolvedSeason.metadataProvider === 'tmdb' ||
        (mapping !== null && resolvedSeason.orderEpoch === mapping.orderEpoch))
        ? resolvedSeason
        : null;
    const canonicalIdentityKnown =
      !!activeSeason &&
      activeSeason.chunkCount !== undefined &&
      activeSeason.seasonVersion !== undefined &&
      activeSeason.chunksComplete === true;
    const activeTitle =
      title && (mapping?.orderEpoch === undefined || title.orderEpoch === mapping.orderEpoch)
        ? title
        : null;
    const provider = activeSeason?.metadataProvider ?? activeTitle?.metadataProvider ?? 'tmdb';
    const canonicalEpisodes = !canonicalIdentityKnown
      ? []
      : (
          await ctx.db
            .query('resolvedSeasonChunks')
            .withIndex('by_tmdb_season_version_chunk', (query) =>
              query
                .eq('tmdbId', item.tmdbId)
                .eq('season', season)
                .eq('seasonVersion', activeSeason.seasonVersion!),
            )
            .take(pageCount)
        ).flatMap((chunk) => chunk.episodes);
    const canonicalIds = new Map(
      canonicalEpisodes.map((episode) => [episode.episode, episode.providerEpisodeId]),
    );
    const episodeLimit = pageCount * EPISODES_PER_CHUNK;
    const episodeCandidates = await ctx.db
      .query('episodes')
      .withIndex('by_item_identity', (query) =>
        query
          .eq('itemId', itemId)
          .eq('season', season)
          .eq('metadataProvider', provider)
          .eq('seasonOrder', provider === 'tvdb' ? mapping?.seasonOrder : undefined),
      )
      // A canonical season is capped at 600 rows. Provider-id validation below
      // preserves history while keeping stale identities from escaping this bound.
      .take(MAX_SEASON_EPISODES);
    return episodeCandidates
      .filter((episode) =>
        matchesCurrentEpisodeIdentity(
          episode,
          provider,
          mapping,
          canonicalIdentityKnown,
          !canonicalIdentityKnown || canonicalIds.has(episode.episode),
          canonicalIds.get(episode.episode),
        ),
      )
      .slice(0, episodeLimit);
  },
});

/** Compact whole-item progress; full episode documents stay season/page scoped. */
export const listEpisodeProgress = query({
  args: { itemId: v.id('items') },
  returns: v.array(
    v.object({
      season: v.number(),
      watchedCount: v.number(),
      total: v.number(),
      currentWatchedCount: v.number(),
      currentTotal: v.number(),
      identityStale: v.boolean(),
    }),
  ),
  handler: async (ctx, { itemId }) => {
    const userId = await requireUser(ctx);
    const item = await ownedItem(ctx, itemId, userId);
    const [summaries, mapping, seasons] = await Promise.all([
      ctx.db
        .query('episodeSummaries')
        .withIndex('by_item', (query) => query.eq('itemId', itemId))
        // Public season coordinates are restricted to 0..10,000.
        .take(10_001),
      ctx.db
        .query('titleMappings')
        .withIndex('by_tmdb', (query) =>
          query.eq('mediaType', item.mediaType).eq('tmdbId', item.tmdbId),
        )
        .unique(),
      ctx.db
        .query('resolvedSeasons')
        .withIndex('by_tmdb_season', (query) => query.eq('tmdbId', item.tmdbId))
        .take(10_001),
    ]);
    const seasonByNumber = new Map(seasons.map((season) => [season.season, season]));
    return summaries.map((summary) => {
      const resolved = seasonByNumber.get(summary.season);
      const active =
        resolved &&
        (resolved.metadataProvider === 'tmdb' ||
          (mapping !== null && resolved.orderEpoch === mapping.orderEpoch)) &&
        resolved.chunkCount !== undefined &&
        resolved.seasonVersion !== undefined &&
        resolved.chunksComplete === true
          ? resolved
          : undefined;
      const currentIdentityKey = active
        ? seasonSummaryIdentityKey(active, mapping?.seasonOrder)
        : undefined;
      const identityStale =
        currentIdentityKey === undefined || summary.currentIdentityKey !== currentIdentityKey;
      return {
        season: summary.season,
        watchedCount: summary.watchedCount,
        total: summary.total,
        currentWatchedCount: identityStale ? 0 : (summary.currentWatchedCount ?? 0),
        currentTotal: identityStale ? 0 : (summary.currentTotal ?? 0),
        identityStale,
      };
    });
  },
});
/** Derives the batch from the server's epoch-checked canonical season. */
const SEASON_WATCH_BATCH_SIZE = EPISODES_PER_CHUNK;
const MAX_SEASON_WATCH_RESTARTS = 4;
const MAX_SEASON_WATCH_BATCHES =
  Math.ceil(MAX_SEASON_EPISODES / SEASON_WATCH_BATCH_SIZE) * (MAX_SEASON_WATCH_RESTARTS + 1);
const seasonWatchIdentity = {
  userId: v.id('users'),
  itemId: v.id('items'),
  season: v.number(),
  watched: v.boolean(),
  orderEpoch: v.optional(v.number()),
  metadataProvider: v.optional(v.union(v.literal('tmdb'), v.literal('tvdb'))),
};

const staleSeasonEpoch = () =>
  new ConvexError({
    code: 'stale_epoch',
    retryable: true,
    message: 'Season metadata changed because its provider or episode order changed; retry',
  });

async function loadSeasonWatchState(
  ctx: MutationCtx | QueryCtx,
  args: {
    userId: Id<'users'>;
    itemId: Id<'items'>;
    season: number;
    orderEpoch?: number;
    metadataProvider?: 'tmdb' | 'tvdb';
  },
) {
  const item = await ownedItem(ctx, args.itemId, args.userId);
  const [mapping, resolved, title] = await Promise.all([
    ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (query) =>
        query.eq('mediaType', item.mediaType).eq('tmdbId', item.tmdbId),
      )
      .unique(),
    ctx.db
      .query('resolvedSeasons')
      .withIndex('by_tmdb_season', (query) =>
        query.eq('tmdbId', item.tmdbId).eq('season', args.season),
      )
      .unique(),
    ctx.db
      .query('resolvedTitles')
      .withIndex('by_tmdb', (query) =>
        query.eq('mediaType', item.mediaType).eq('tmdbId', item.tmdbId),
      )
      .unique(),
  ]);
  if (
    !mapping ||
    !resolved ||
    resolved.orderEpoch !== mapping.orderEpoch ||
    resolved.chunkCount === undefined ||
    resolved.seasonVersion === undefined ||
    resolved.chunksComplete !== true
  )
    throw staleSeasonEpoch();
  const epoch = mapping.orderEpoch;
  if (args.orderEpoch !== undefined && args.orderEpoch !== epoch) throw staleSeasonEpoch();
  if (args.metadataProvider !== undefined && args.metadataProvider !== resolved.metadataProvider)
    throw staleSeasonEpoch();
  const episodeCount = resolved.episodeCount;
  if (episodeCount === undefined || episodeCount > MAX_SEASON_EPISODES)
    throw new Error(`A season batch is limited to ${MAX_SEASON_EPISODES} episodes`);
  const seasonName =
    title && title.orderEpoch === epoch
      ? title.seasons.find((entry) => entry.season === args.season)?.name
      : undefined;
  return { item, mapping, resolved, episodeCount, epoch, seasonName };
}

async function loadSeasonWatchChunk(
  ctx: MutationCtx,
  resolved: Doc<'resolvedSeasons'>,
  offset: number,
) {
  if (
    resolved.chunkCount === undefined ||
    resolved.orderEpoch === undefined ||
    resolved.seasonVersion === undefined
  )
    throw staleSeasonEpoch();
  const chunkIndex = Math.floor(offset / EPISODES_PER_CHUNK);
  const chunk = await ctx.db
    .query('resolvedSeasonChunks')
    .withIndex('by_tmdb_season_version_chunk', (query) =>
      query
        .eq('tmdbId', resolved.tmdbId)
        .eq('season', resolved.season)
        .eq('seasonVersion', resolved.seasonVersion!)
        .eq('chunkIndex', chunkIndex),
    )
    .unique();
  if (!chunk) throw staleSeasonEpoch();
  const withinChunk = offset % EPISODES_PER_CHUNK;
  return chunk.episodes.slice(withinChunk, withinChunk + SEASON_WATCH_BATCH_SIZE);
}

export const getSeasonWatchedPlan = internalQuery({
  args: seasonWatchIdentity,
  handler: async (ctx, args) => {
    const { resolved, episodeCount, epoch } = await loadSeasonWatchState(ctx, args);
    return {
      episodeCount,
      refreshedAt: resolved.refreshedAt,
      orderEpoch: epoch,
      metadataProvider: resolved.metadataProvider,
    };
  },
});

export const setSeasonWatchedBatch = internalMutation({
  args: {
    ...seasonWatchIdentity,
    offset: v.number(),
    expectedRefreshedAt: v.number(),
    expectedOrderEpoch: v.number(),
    expectedMetadataProvider: v.union(v.literal('tmdb'), v.literal('tvdb')),
  },
  handler: async (ctx, args) => {
    const { item, mapping, resolved, episodeCount, epoch, seasonName } = await loadSeasonWatchState(
      ctx,
      {
        userId: args.userId,
        itemId: args.itemId,
        season: args.season,
        orderEpoch: args.expectedOrderEpoch,
        metadataProvider: args.expectedMetadataProvider,
      },
    );
    if (epoch !== args.expectedOrderEpoch) throw staleSeasonEpoch();

    const seasonOrder = mapping.seasonOrder;
    const identityAvailable = resolved.metadataProvider === 'tmdb' || seasonOrder !== undefined;
    const summaryIdentityKey = identityAvailable
      ? seasonSummaryIdentityKey(resolved, seasonOrder)
      : undefined;
    const restarted = resolved.refreshedAt !== args.expectedRefreshedAt;
    const offset = restarted ? 0 : args.offset;
    const batch = await loadSeasonWatchChunk(ctx, resolved, offset);
    const existing = await Promise.all(
      batch.map((episode) =>
        ctx.db
          .query('episodes')
          .withIndex('by_item', (query) =>
            query
              .eq('itemId', args.itemId)
              .eq('season', args.season)
              .eq('episode', episode.episode),
          )
          .unique(),
      ),
    );
    const activityEvents: ActivityEventWrite[] = [];
    for (const [index, episode] of batch.entries())
      await setEpisode(
        ctx,
        args.userId,
        {
          itemId: args.itemId,
          ...episode,
          watched: args.watched,
          ...(identityAvailable && {
            stamp: {
              metadataProvider: resolved.metadataProvider,
              seasonOrder: resolved.metadataProvider === 'tvdb' ? seasonOrder : undefined,
              providerEpisodeId: episode.providerEpisodeId,
              summaryIdentityKey,
              summaryTotal: episodeCount,
              ...(seasonName !== undefined && { seasonName }),
              name: episode.name,
              overview: episode.overview,
              runtime: episode.runtime,
              imageUrl: episode.imageUrl,
              airDate: episode.airDate,
            },
          }),
        },
        item,
        existing[index] ?? null,
        activityEvents,
        false,
      );
    await writeActivityEvents(ctx, activityEvents);
    const watchedCoordinate =
      args.watched &&
      item.nextEpisode &&
      batch.some(
        (episode) =>
          episode.season === item.nextEpisode!.season &&
          episode.episode === item.nextEpisode!.episode,
      )
        ? { season: item.nextEpisode.season, episode: item.nextEpisode.episode }
        : undefined;
    await refreshNextEpisode(ctx, item._id, watchedCoordinate);
    return {
      processed: batch.length,
      episodeCount,
      refreshedAt: resolved.refreshedAt,
      restarted,
    };
  },
});

type SeasonWatchedActionArgs = {
  userId: Id<'users'>;
  itemId: Id<'items'>;
  season: number;
  watched: boolean;
  orderEpoch?: number;
  metadataProvider?: 'tmdb' | 'tvdb';
};

async function applySeasonWatched(
  ctx: ActionCtx,
  { userId, itemId, season, watched, orderEpoch, metadataProvider }: SeasonWatchedActionArgs,
) {
  if (!Number.isInteger(season) || season < 0 || season > 10_000)
    throw new Error('Season must be an integer between 0 and 10000');
  const plan = await ctx.runQuery(internal.library.getSeasonWatchedPlan, {
    userId,
    itemId,
    season,
    watched,
    orderEpoch,
    metadataProvider,
  });
  let processed = 0;
  let batches = 0;
  let restarts = 0;
  let episodeCount = plan.episodeCount;
  let refreshedAt = plan.refreshedAt;
  while (true) {
    if (processed >= episodeCount) {
      const current = await ctx.runQuery(internal.library.getSeasonWatchedPlan, {
        userId,
        itemId,
        season,
        watched,
        orderEpoch: plan.orderEpoch,
        metadataProvider: plan.metadataProvider,
      });
      if (current.refreshedAt === refreshedAt && current.episodeCount === episodeCount) break;
      restarts += 1;
      if (restarts > MAX_SEASON_WATCH_RESTARTS) throw staleSeasonEpoch();
      processed = 0;
      episodeCount = current.episodeCount;
      refreshedAt = current.refreshedAt;
      continue;
    }
    batches += 1;
    if (batches > MAX_SEASON_WATCH_BATCHES) throw staleSeasonEpoch();
    const result = await ctx.runMutation(internal.library.setSeasonWatchedBatch, {
      userId,
      itemId,
      season,
      watched,
      offset: processed,
      expectedRefreshedAt: refreshedAt,
      expectedOrderEpoch: plan.orderEpoch,
      expectedMetadataProvider: plan.metadataProvider,
    });
    if (result.processed === 0) throw new Error('Season batch made no progress');
    if (result.restarted) {
      restarts += 1;
      if (restarts > MAX_SEASON_WATCH_RESTARTS) throw staleSeasonEpoch();
    }
    processed = (result.restarted ? 0 : processed) + result.processed;
    episodeCount = result.episodeCount;
    refreshedAt = result.refreshedAt;
  }
  return { processed };
}

export const setSeasonWatched = action({
  args: {
    itemId: v.id('items'),
    season: v.number(),
    watched: v.optional(v.boolean()),
    orderEpoch: v.optional(v.number()),
    metadataProvider: v.optional(v.union(v.literal('tmdb'), v.literal('tvdb'))),
  },
  returns: v.object({ processed: v.number() }),
  handler: async (ctx, { itemId, season, watched = true, orderEpoch, metadataProvider }) => {
    const userId = await requireUser(ctx);
    return applySeasonWatched(ctx, {
      userId,
      itemId,
      season,
      watched,
      orderEpoch,
      metadataProvider,
    });
  },
});

async function moveItemToWatchedForUser(
  ctx: ActionCtx,
  userId: Id<'users'>,
  args: {
    itemId: Id<'items'>;
    beforeId?: Id<'items'>;
    afterId?: Id<'items'>;
  },
): Promise<number> {
  const item: Doc<'items'> = await ctx.runQuery(internal.library.getOwnedItemForStatusMove, {
    userId,
    itemId: args.itemId,
  });
  if (item.mediaType === 'tv') {
    const initialTitle = await ctx.runAction(internal.resolvedMetadata.resolveTitleForUser, {
      userId,
      mediaType: 'tv',
      tmdbId: item.tmdbId,
      title: item.title,
    });
    if (!initialTitle?.seasons.length) throw new Error('Season information is unavailable');
    for (const seasonInfo of initialTitle.seasons.filter(
      (entry: { season: number }) => entry.season >= 0,
    )) {
      const episodes = await ctx.runAction(internal.resolvedMetadata.resolveSeasonForUser, {
        userId,
        tmdbId: item.tmdbId,
        season: seasonInfo.season,
      });
      if (seasonInfo.episodeCount > 0 && episodes.length === 0)
        throw new Error('Episode information is unavailable');
      const currentTitle = await ctx.runQuery(internal.resolvedMetadata.readTitle, {
        mediaType: 'tv',
        tmdbId: item.tmdbId,
      });
      if (!currentTitle) throw new Error('Season identity is unavailable');
      await applySeasonWatched(ctx, {
        userId,
        itemId: item._id,
        season: seasonInfo.season,
        watched: true,
        orderEpoch: currentTitle.orderEpoch,
        metadataProvider: currentTitle.metadataProvider,
      });
    }
  }
  return ctx.runMutation(internal.library.moveItemToSlotInternal, {
    userId,
    itemId: item._id,
    status: 'watched',
    beforeId: args.beforeId,
    afterId: args.afterId,
  });
}

export const moveItemToWatched = action({
  args: {
    itemId: v.id('items'),
    beforeId: v.optional(v.id('items')),
    afterId: v.optional(v.id('items')),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    return moveItemToWatchedForUser(ctx, userId, args);
  },
});

export const addItemAndMarkWatched = action({
  args: addItemFields,
  returns: v.id('items'),
  handler: async (ctx, args): Promise<Id<'items'>> => {
    if (args.mediaType !== 'tv' || args.status !== 'watched')
      throw new Error('This action only adds watched TV shows');
    const userId = await requireUser(ctx);
    const itemId: Id<'items'> = await ctx.runMutation(internal.library.addItemInternal, {
      userId,
      ...args,
      status: 'watchlist',
    });
    try {
      await moveItemToWatchedForUser(ctx, userId, { itemId });
    } catch (error) {
      await ctx
        .runMutation(internal.library.discardAddedItem, { userId, itemId })
        .catch(() => undefined);
      throw error;
    }
    return itemId;
  },
});

export const discardAddedItem = internalMutation({
  args: { userId: v.id('users'), itemId: v.id('items') },
  handler: async (ctx, { userId, itemId }) => {
    const item = await ctx.db.get(itemId);
    if (!item || item.userId !== userId) return;
    if (item.deletingAt === undefined) {
      await ctx.db.patch(itemId, { deletingAt: Date.now() });
      await requestProfileStatsRefresh(ctx, userId);
    }
    await ctx.scheduler.runAfter(0, internal.library.continueRemoveItem, { itemId });
  },
});
