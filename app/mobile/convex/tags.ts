import { getClerkUserId } from './clerkAuth';
import { mutation, query } from './_generated/server';
import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
import { v } from 'convex/values';
import { normalizeTagKey, requireTagCollection } from './tagCollectionsModel';
import { normalizeUsername } from './profileRules';
import { mediaTypeValidator, publicTagPreviewValidator, statusValidator } from './publicValidators';

const publicTitleValidator = v.object({
  tmdbId: v.number(),
  mediaType: mediaTypeValidator,
  title: v.string(),
  posterPath: v.optional(v.string()),
  overview: v.optional(v.string()),
  releaseDate: v.optional(v.string()),
});

const tagPreviewValidator = v.object({
  tag: v.string(),
  count: v.number(),
  posters: v.array(
    v.object({
      itemId: v.optional(v.string()),
      title: v.string(),
      posterPath: v.optional(v.string()),
    }),
  ),
});

async function requireUser(ctx: Parameters<typeof getClerkUserId>[0]) {
  const userId = await getClerkUserId(ctx);
  if (!userId) throw new Error('Authentication required');
  return userId;
}

const publicTitle = (item: {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath?: string;
  overview?: string;
  releaseDate?: string;
}) => ({
  tmdbId: item.tmdbId,
  mediaType: item.mediaType,
  title: item.title,
  ...(item.posterPath && { posterPath: item.posterPath }),
  ...(item.overview && { overview: item.overview }),
  ...(item.releaseDate && { releaseDate: item.releaseDate }),
});

export const visibility = query({
  args: { tag: v.string() },
  returns: v.object({ isPublic: v.boolean() }),
  handler: async (ctx, { tag }) => {
    const userId = await requireUser(ctx);
    const tagKey = normalizeTagKey(tag);
    if (!tagKey || tagKey.length > 40) return { isPublic: false };
    const collection = await ctx.db
      .query('tagCollections')
      .withIndex('by_user_tag', (q) => q.eq('userId', userId).eq('tagKey', tagKey))
      .unique();
    return { isPublic: collection?.isPublic === true };
  },
});

export const setVisibility = mutation({
  args: { tag: v.string(), isPublic: v.boolean() },
  returns: v.id('tagCollections'),
  handler: async (ctx, { tag, isPublic }) => {
    const userId = await requireUser(ctx);
    const collection = await requireTagCollection(ctx, userId, tag);
    const now = Date.now();
    if (collection.label !== tag.trim() || collection.isPublic !== isPublic)
      await ctx.db.patch(collection._id, {
        label: tag.trim(),
        isPublic,
        updatedAt: now,
      });
    return collection._id;
  },
});

export const myPublic = query({
  args: {},
  returns: v.array(publicTagPreviewValidator),
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const collections = await ctx.db
      .query('tagCollections')
      .withIndex('by_user_tag', (q) => q.eq('userId', userId))
      .take(500);
    const previews = await Promise.all(
      collections
        .filter((collection) => collection.isPublic)
        .map(async (collection) => ({
          tag: collection.label,
          count: collection.memberCount,
          posters: collection.previewPosters.map(({ title, posterPath }) => ({
            title,
            posterPath,
          })),
        })),
    );
    return previews
      .filter((collection) => collection.count > 0)
      .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag));
  },
});

export const mine = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(tagPreviewValidator),
  handler: async (ctx, { paginationOpts }) => {
    const userId = await requireUser(ctx);
    const page = await ctx.db
      .query('tagCollections')
      .withIndex('by_user_tag', (q) => q.eq('userId', userId))
      .paginate(paginationOpts);
    return {
      ...page,
      page: page.page
        .filter((collection) => collection.memberCount > 0)
        .map((collection) => ({
          tag: collection.label,
          count: collection.memberCount,
          posters: collection.previewPosters.map((poster) => ({
            ...(poster.itemId && { itemId: String(poster.itemId) }),
            title: poster.title,
            posterPath: poster.posterPath,
          })),
        }))
        .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag)),
    };
  },
});

export const publicByUser = query({
  args: { username: v.string(), tag: v.string(), cursor: v.optional(v.string()) },
  returns: v.union(
    v.null(),
    v.object({
      username: v.string(),
      tag: v.string(),
      isOwner: v.boolean(),
      isPublic: v.boolean(),
      nextCursor: v.optional(v.string()),
      titles: v.array(
        v.object({
          ...publicTitleValidator.fields,
          rank: v.number(),
          status: statusValidator,
          rating: v.optional(v.number()),
          genres: v.optional(v.array(v.string())),
          isAnime: v.boolean(),
        }),
      ),
    }),
  ),
  handler: async (ctx, args) => {
    const normalizedUsername = normalizeUsername(args.username);
    const tagKey = normalizeTagKey(args.tag);
    if (!/^[a-z0-9_]{3,24}$/.test(normalizedUsername) || !tagKey || tagKey.length > 40) return null;
    const owner = await ctx.db
      .query('users')
      .withIndex('by_username', (q) => q.eq('normalizedUsername', normalizedUsername))
      .unique();
    if (!owner?.username) return null;
    const collection = await ctx.db
      .query('tagCollections')
      .withIndex('by_user_tag', (q) => q.eq('userId', owner._id).eq('tagKey', tagKey))
      .unique();
    if (!collection) return null;
    const viewerId = await getClerkUserId(ctx);
    const isOwner = viewerId === owner._id;
    if (!collection.isPublic && !isOwner) return null;
    const memberships = await ctx.db
      .query('tagMemberships')
      .withIndex('by_collection_rank', (q) => q.eq('collectionId', collection._id))
      .paginate({ cursor: args.cursor ?? null, numItems: 100 });
    const titles = await Promise.all(
      memberships.page.map(async (membership) => {
        const item = await ctx.db.get(membership.itemId);
        if (!item || item.deletingAt !== undefined) return null;
        return {
          ...publicTitle(item),
          rank: membership.rank,
          status: item.status,
          ...(item.rating !== undefined && { rating: item.rating }),
          ...(item.genres && { genres: item.genres }),
          isAnime: item.isAnime,
        };
      }),
    );
    return {
      username: owner.username,
      tag: collection.label,
      isOwner,
      isPublic: collection.isPublic,
      ...(!memberships.isDone && { nextCursor: memberships.continueCursor }),
      titles: titles.filter((title) => title !== null),
    };
  },
});

export const searchPublic = query({
  args: { query: v.string() },
  returns: v.array(
    v.object({
      tag: v.string(),
      entryCount: v.number(),
      contributorCount: v.number(),
      posters: v.array(v.object({ title: v.string(), posterPath: v.optional(v.string()) })),
    }),
  ),
  handler: async (ctx, { query: rawQuery }) => {
    await requireUser(ctx);
    const search = normalizeTagKey(rawQuery);
    if (search.length < 2 || search.length > 40) return [];
    const collections = await ctx.db
      .query('tagCollections')
      .withSearchIndex('search_tag', (q) => q.search('tagKey', search).eq('isPublic', true))
      .take(100);
    const tagKeys = [...new Set(collections.map((collection) => collection.tagKey))].slice(0, 20);
    const results = await Promise.all(
      tagKeys.map(async (tagKey) => {
        const owners = await ctx.db
          .query('tagCollections')
          .withIndex('by_public_tag', (q) => q.eq('isPublic', true).eq('tagKey', tagKey))
          .take(20);
        const populated = owners.filter((owner) => owner.memberCount > 0);
        const posters = new Map<string, { title: string; posterPath?: string }>();
        for (const owner of populated)
          for (const poster of owner.previewPosters) {
            const key = `${poster.title}:${poster.posterPath ?? ''}`;
            if (!posters.has(key)) posters.set(key, poster);
          }
        const label =
          collections.find((collection) => collection.tagKey === tagKey)?.label ?? tagKey;
        return {
          tag: label,
          entryCount: populated.reduce((total, owner) => total + owner.memberCount, 0),
          contributorCount: populated.length,
          posters: [...posters.values()].filter((item) => item.posterPath).slice(0, 3),
        };
      }),
    );
    return results
      .filter((result) => result.entryCount > 0)
      .sort(
        (left, right) => right.entryCount - left.entryCount || left.tag.localeCompare(right.tag),
      );
  },
});

export const publicDetails = query({
  args: { tag: v.string(), cursor: v.optional(v.string()) },
  returns: v.union(
    v.null(),
    v.object({
      tag: v.string(),
      contributorCount: v.number(),
      nextCursor: v.optional(v.string()),
      titles: v.array(publicTitleValidator),
    }),
  ),
  handler: async (ctx, { tag, cursor }) => {
    await requireUser(ctx);
    const tagKey = normalizeTagKey(tag);
    if (!tagKey || tagKey.length > 40) return null;
    const collections = await ctx.db
      .query('tagCollections')
      .withIndex('by_public_tag', (q) => q.eq('isPublic', true).eq('tagKey', tagKey))
      .take(20);
    const populatedCollections = collections.filter((collection) => collection.memberCount > 0);
    if (!populatedCollections.length) return null;
    let pageState: {
      collectionId: string;
      collectionCreatedAt: number;
      cursor: string | null;
    } = {
      collectionId: String(populatedCollections[0]!._id),
      collectionCreatedAt: populatedCollections[0]!._creationTime,
      cursor: null,
    };
    if (cursor) {
      try {
        const parsed = JSON.parse(cursor) as typeof pageState;
        if (
          typeof parsed.collectionId === 'string' &&
          typeof parsed.collectionCreatedAt === 'number' &&
          (typeof parsed.cursor === 'string' || parsed.cursor === null)
        )
          pageState = parsed;
      } catch {
        // Restart at the first page instead of treating a damaged cursor as a missing tag.
      }
    }
    let collectionIndex = populatedCollections.findIndex(
      (collection) => String(collection._id) === pageState.collectionId,
    );
    const collectionStillExists = collectionIndex >= 0;
    if (!collectionStillExists)
      collectionIndex = populatedCollections.findIndex(
        (collection) =>
          collection._creationTime > pageState.collectionCreatedAt ||
          (collection._creationTime === pageState.collectionCreatedAt &&
            String(collection._id).localeCompare(pageState.collectionId) > 0),
      );
    if (collectionIndex < 0) return null;
    const collection = populatedCollections[collectionIndex]!;
    const memberships = await ctx.db
      .query('tagMemberships')
      .withIndex('by_collection_rank', (q) => q.eq('collectionId', collection._id))
      .paginate({ cursor: collectionStillExists ? pageState.cursor : null, numItems: 100 });
    const titles = new Map<string, ReturnType<typeof publicTitle>>();
    const contributors = new Set(
      populatedCollections.map((collection) => String(collection.userId)),
    );
    const items = await Promise.all(
      memberships.page.map((membership) => ctx.db.get(membership.itemId)),
    );
    for (const item of items) {
      if (!item || item.deletingAt !== undefined) continue;
      const key = `${item.mediaType}:${item.tmdbId}`;
      if (!titles.has(key)) titles.set(key, publicTitle(item));
    }
    const nextCursor = !memberships.isDone
      ? JSON.stringify({
          collectionId: String(collection._id),
          collectionCreatedAt: collection._creationTime,
          cursor: memberships.continueCursor,
        })
      : collectionIndex + 1 < populatedCollections.length
        ? JSON.stringify({
            collectionId: String(populatedCollections[collectionIndex + 1]!._id),
            collectionCreatedAt: populatedCollections[collectionIndex + 1]!._creationTime,
            cursor: null,
          })
        : undefined;
    return {
      tag: collection.label,
      contributorCount: contributors.size,
      ...(nextCursor && { nextCursor }),
      titles: [...titles.values()].sort((left, right) => left.title.localeCompare(right.title)),
    };
  },
});
