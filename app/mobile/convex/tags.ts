import { getClerkUserId } from './clerkAuth';
import { mutation, query } from './_generated/server';
import { v } from 'convex/values';
import { ensureTagMemberships, normalizeTagKey } from './tagCollectionsModel';
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
    const collection = await ensureTagMemberships(ctx, userId, tag, isPublic);
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
          posters: collection.previewPosters,
        })),
    );
    return previews
      .filter((collection) => collection.count > 0)
      .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag));
  },
});

export const mine = query({
  args: {},
  returns: v.array(
    v.object({
      tag: v.string(),
      count: v.number(),
      posters: v.array(
        v.object({
          itemId: v.string(),
          title: v.string(),
          posterPath: v.optional(v.string()),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const [items, memberships] = await Promise.all([
      ctx.db
        .query('items')
        .withIndex('by_user', (q) => q.eq('userId', userId))
        .filter((q) => q.eq(q.field('deletingAt'), undefined))
        .take(2_001),
      ctx.db
        .query('tagMemberships')
        .withIndex('by_user_tag_rank', (q) => q.eq('userId', userId))
        .take(2_001),
    ]);
    if (items.length > 2_000 || memberships.length > 2_000) throw new Error('Too many tag entries');

    const membershipRanks = new Map(
      memberships.map((membership) => [
        `${membership.tagKey}:${String(membership.itemId)}`,
        membership.rank,
      ]),
    );
    const grouped = new Map<string, { label: string; items: typeof items }>();
    for (const item of items) {
      for (const label of item.tags) {
        const tagKey = normalizeTagKey(label);
        if (!tagKey) continue;
        const group = grouped.get(tagKey) ?? { label: label.trim(), items: [] };
        group.items.push(item);
        grouped.set(tagKey, group);
      }
    }

    return [...grouped.entries()]
      .map(([tagKey, group]) => {
        const ordered = [...group.items].sort((left, right) => {
          const leftKey = `${tagKey}:${String(left._id)}`;
          const rightKey = `${tagKey}:${String(right._id)}`;
          const leftRank = membershipRanks.get(leftKey);
          const rightRank = membershipRanks.get(rightKey);
          if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank;
          if (leftRank !== undefined) return -1;
          if (rightRank !== undefined) return 1;
          return (
            left.rank - right.rank ||
            left._creationTime - right._creationTime ||
            String(left._id).localeCompare(String(right._id))
          );
        });
        return {
          tag: group.label,
          count: ordered.length,
          posters: ordered.slice(0, 3).map((item) => ({
            itemId: String(item._id),
            title: item.title,
            posterPath: item.posterPath,
          })),
        };
      })
      .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag));
  },
});

export const publicByUser = query({
  args: { username: v.string(), tag: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      username: v.string(),
      tag: v.string(),
      isOwner: v.boolean(),
      isPublic: v.boolean(),
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
      .take(2_000);
    const titles = await Promise.all(
      memberships.map(async (membership) => {
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
      titles: titles.filter((title) => title !== null),
    };
  },
});

export const searchPublic = query({
  args: { query: v.string() },
  returns: v.array(
    v.object({
      tag: v.string(),
      titleCount: v.number(),
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
        const memberships = (
          await Promise.all(
            owners.map((owner) =>
              ctx.db
                .query('tagMemberships')
                .withIndex('by_collection_rank', (q) => q.eq('collectionId', owner._id))
                .take(10),
            ),
          )
        ).flat();
        const titles = new Map<string, { title: string; posterPath?: string }>();
        const contributors = new Set(owners.map((owner) => String(owner.userId)));
        const uniqueMemberships = [
          ...new Map(
            memberships.map((membership) => [String(membership.itemId), membership]),
          ).values(),
        ].slice(0, 60);
        const items = await Promise.all(
          uniqueMemberships.map((membership) => ctx.db.get(membership.itemId)),
        );
        for (const item of items) {
          if (!item || item.deletingAt !== undefined) continue;
          const key = `${item.mediaType}:${item.tmdbId}`;
          if (!titles.has(key))
            titles.set(key, {
              title: item.title,
              ...(item.posterPath && { posterPath: item.posterPath }),
            });
        }
        const label =
          collections.find((collection) => collection.tagKey === tagKey)?.label ?? tagKey;
        return {
          tag: label,
          titleCount: titles.size,
          contributorCount: contributors.size,
          posters: [...titles.values()].filter((item) => item.posterPath).slice(0, 3),
        };
      }),
    );
    return results
      .filter((result) => result.titleCount > 0)
      .sort(
        (left, right) => right.titleCount - left.titleCount || left.tag.localeCompare(right.tag),
      );
  },
});

export const publicDetails = query({
  args: { tag: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      tag: v.string(),
      contributorCount: v.number(),
      titles: v.array(v.object({ ...publicTitleValidator.fields, contributorCount: v.number() })),
    }),
  ),
  handler: async (ctx, { tag }) => {
    await requireUser(ctx);
    const tagKey = normalizeTagKey(tag);
    if (!tagKey || tagKey.length > 40) return null;
    const collections = await ctx.db
      .query('tagCollections')
      .withIndex('by_public_tag', (q) => q.eq('isPublic', true).eq('tagKey', tagKey))
      .take(20);
    const memberships = (
      await Promise.all(
        collections.map((collection) =>
          ctx.db
            .query('tagMemberships')
            .withIndex('by_collection_rank', (q) => q.eq('collectionId', collection._id))
            .take(100),
        ),
      )
    ).flat();
    if (!memberships.length) return null;
    const titles = new Map<string, ReturnType<typeof publicTitle> & { contributorCount: number }>();
    const contributors = new Set(collections.map((collection) => String(collection.userId)));
    const membershipCounts = new Map<string, number>();
    for (const membership of memberships)
      membershipCounts.set(
        String(membership.itemId),
        (membershipCounts.get(String(membership.itemId)) ?? 0) + 1,
      );
    const uniqueMemberships = [
      ...new Map(memberships.map((membership) => [String(membership.itemId), membership])).values(),
    ].slice(0, 500);
    const items = await Promise.all(
      uniqueMemberships.map((membership) => ctx.db.get(membership.itemId)),
    );
    for (const item of items) {
      if (!item || item.deletingAt !== undefined) continue;
      const key = `${item.mediaType}:${item.tmdbId}`;
      const current = titles.get(key);
      if (current) {
        current.contributorCount += membershipCounts.get(String(item._id)) ?? 1;
        continue;
      }
      titles.set(key, {
        ...publicTitle(item),
        contributorCount: membershipCounts.get(String(item._id)) ?? 1,
      });
    }
    return {
      tag: collections[0]!.label,
      contributorCount: contributors.size,
      titles: [...titles.values()].sort((left, right) => left.title.localeCompare(right.title)),
    };
  },
});
