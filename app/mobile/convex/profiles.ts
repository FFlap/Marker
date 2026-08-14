import { getClerkUserId } from './clerkAuth';
import { internal } from './_generated/api';
import { internalMutation, mutation, query } from './_generated/server';
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { profileStatsForUser } from './profileStats';
import { normalizeUsername, validateUsername } from './profileRules';
import {
  identityValidator,
  publicTagPreviewValidator,
  relationshipValidator,
  statsValidator,
} from './publicValidators';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const AVATAR_UPLOAD_TTL_MS = 15 * 60 * 1000;
const AVATAR_UPLOAD_PRUNE_BATCH = 100;
const FOLLOW_ACCEPT_BATCH_SIZE = 100;

async function acceptPendingFollowBatch(ctx: MutationCtx, userId: Id<'users'>) {
  const following = await ctx.db.get(userId);
  if (!following || following.isPublic !== true) return { accepted: 0, isDone: true };
  const pending = await ctx.db
    .query('follows')
    .withIndex('by_following_status', (q) => q.eq('followingId', userId).eq('status', 'pending'))
    .take(FOLLOW_ACCEPT_BATCH_SIZE);
  const now = Date.now();
  let accepted = 0;
  for (const request of pending) {
    const follower = await ctx.db.get(request.followerId);
    if (!follower) {
      await ctx.db.delete(request._id);
      continue;
    }
    await ctx.db.patch(request._id, { status: 'accepted', updatedAt: now });
    await ctx.db.patch(follower._id, {
      followingCount: (follower.followingCount ?? 0) + 1,
    });
    accepted += 1;
  }
  if (accepted)
    await ctx.db.patch(userId, {
      followerCount: (following.followerCount ?? 0) + accepted,
    });
  const isDone = pending.length < FOLLOW_ACCEPT_BATCH_SIZE;
  if (!isDone) await ctx.scheduler.runAfter(0, internal.profiles.acceptPendingFollows, { userId });
  return { accepted, isDone };
}

async function requireUser(ctx: Parameters<typeof getClerkUserId>[0]) {
  const userId = await getClerkUserId(ctx);
  if (!userId) throw new Error('Authentication required');
  return userId;
}

async function identity(ctx: QueryCtx, userId: Id<'users'>) {
  const user = await ctx.db.get(userId);
  if (!user) throw new Error('Account not found');
  const avatarUrl = user.avatarStorageId
    ? ((await ctx.storage.getUrl(user.avatarStorageId)) ?? undefined)
    : undefined;
  return {
    isPublic: user.isPublic === true,
    followerCount: user.followerCount ?? 0,
    followingCount: user.followingCount ?? 0,
    ...(user.username && { username: user.username }),
    ...(avatarUrl && { avatarUrl }),
  };
}

export const me = query({
  args: {},
  returns: identityValidator,
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    return identity(ctx, userId);
  },
});

export const save = mutation({
  args: { username: v.string(), isPublic: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const { username, normalizedUsername } = validateUsername(args.username);
    const matching = await ctx.db
      .query('users')
      .withIndex('by_username', (q) => q.eq('normalizedUsername', normalizedUsername))
      .take(2);
    if (matching.some((user) => user._id !== userId)) throw new Error('Username is already taken');
    const current = await ctx.db.get(userId);
    if (!current) throw new Error('Account not found');
    const now = Date.now();
    await ctx.db.patch(userId, {
      username,
      normalizedUsername,
      isPublic: args.isPublic,
      profileCreatedAt: current.profileCreatedAt ?? now,
      profileUpdatedAt: now,
    });
    if (args.isPublic && current.isPublic !== true) await acceptPendingFollowBatch(ctx, userId);
  },
});

export const acceptPendingFollows = internalMutation({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => acceptPendingFollowBatch(ctx, userId),
});

export const generateAvatarUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const uploadId = await ctx.db.insert('avatarUploads', {
      userId,
      status: 'pending',
      createdAt: Date.now(),
    });
    return `/avatar/upload?uploadId=${uploadId}`;
  },
});

export const pendingAvatarUpload = internalMutation({
  args: { userId: v.id('users'), uploadId: v.id('avatarUploads') },
  handler: async (ctx, { userId, uploadId }) => {
    const upload = await ctx.db.get(uploadId);
    if (
      !upload ||
      upload.userId !== userId ||
      upload.status !== 'pending' ||
      upload.storageId !== undefined ||
      upload.createdAt < Date.now() - AVATAR_UPLOAD_TTL_MS
    )
      throw new Error('Avatar upload is invalid or expired');
    return null;
  },
});

export const completeAvatarUpload = internalMutation({
  args: {
    userId: v.id('users'),
    uploadId: v.id('avatarUploads'),
    storageId: v.id('_storage'),
  },
  handler: async (ctx, { userId, uploadId, storageId }) => {
    const upload = await ctx.db.get(uploadId);
    if (
      !upload ||
      upload.userId !== userId ||
      upload.status !== 'pending' ||
      upload.storageId !== undefined ||
      upload.createdAt < Date.now() - AVATAR_UPLOAD_TTL_MS
    )
      throw new Error('Avatar upload is invalid or expired');
    await ctx.db.patch(uploadId, { storageId });
    return null;
  },
});

async function deleteOwnedAvatar(ctx: MutationCtx, userId: Id<'users'>, storageId: Id<'_storage'>) {
  const ownership = await ctx.db
    .query('avatarUploads')
    .withIndex('by_storage', (query) => query.eq('storageId', storageId))
    .unique();
  if (!ownership || ownership.userId !== userId || ownership.status !== 'active') return;
  await ctx.storage.delete(storageId);
  await ctx.db.delete(ownership._id);
}

export const setAvatar = mutation({
  args: { storageId: v.id('_storage') },
  returns: v.null(),
  handler: async (ctx, { storageId }) => {
    const userId = await requireUser(ctx);
    const upload = await ctx.db
      .query('avatarUploads')
      .withIndex('by_storage', (query) => query.eq('storageId', storageId))
      .unique();
    if (
      !upload ||
      upload.userId !== userId ||
      upload.status !== 'pending' ||
      upload.createdAt < Date.now() - AVATAR_UPLOAD_TTL_MS
    )
      throw new Error('Avatar upload was not created by this account');
    const metadata = await ctx.db.system.get('_storage', storageId);
    if (!metadata) throw new Error('Uploaded image was not found');
    if (metadata.size > MAX_AVATAR_BYTES || !IMAGE_TYPES.has(metadata.contentType ?? '')) {
      await ctx.storage.delete(storageId);
      await ctx.db.delete(upload._id);
      throw new Error('Avatar must be a JPG, PNG, WebP, or HEIC image under 5 MB');
    }
    const current = await ctx.db.get(userId);
    if (!current) throw new Error('Account not found');
    await ctx.db.patch(userId, { avatarStorageId: storageId, profileUpdatedAt: Date.now() });
    await ctx.db.patch(upload._id, { status: 'active' });
    if (current.avatarStorageId && current.avatarStorageId !== storageId) {
      await deleteOwnedAvatar(ctx, userId, current.avatarStorageId);
    }
  },
});

export const removeAvatar = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const current = await ctx.db.get(userId);
    if (!current?.avatarStorageId) return;
    await ctx.db.patch(userId, { avatarStorageId: undefined, profileUpdatedAt: Date.now() });
    await deleteOwnedAvatar(ctx, userId, current.avatarStorageId);
  },
});

export const pruneAvatarUploads = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const stale = await ctx.db
      .query('avatarUploads')
      .withIndex('by_status_created', (query) =>
        query.eq('status', 'pending').lt('createdAt', Date.now() - AVATAR_UPLOAD_TTL_MS),
      )
      .take(AVATAR_UPLOAD_PRUNE_BATCH);
    for (const upload of stale) {
      if (upload.storageId) await ctx.storage.delete(upload.storageId);
      await ctx.db.delete(upload._id);
    }
    if (stale.length === AVATAR_UPLOAD_PRUNE_BATCH)
      await ctx.scheduler.runAfter(0, internal.profiles.pruneAvatarUploads, {});
    return null;
  },
});

async function userByUsername(ctx: QueryCtx | MutationCtx, username: string) {
  const normalizedUsername = normalizeUsername(username);
  if (!/^[a-z0-9_]{3,24}$/.test(normalizedUsername)) return null;
  return ctx.db
    .query('users')
    .withIndex('by_username', (q) => q.eq('normalizedUsername', normalizedUsername))
    .unique();
}

async function relationship(
  ctx: QueryCtx | MutationCtx,
  followerId: Id<'users'>,
  followingId: Id<'users'>,
) {
  return ctx.db
    .query('follows')
    .withIndex('by_pair', (q) => q.eq('followerId', followerId).eq('followingId', followingId))
    .unique();
}

async function adjustCounts(
  ctx: MutationCtx,
  follower: Doc<'users'>,
  following: Doc<'users'>,
  delta: 1 | -1,
) {
  await ctx.db.patch(follower._id, {
    followingCount: Math.max(0, (follower.followingCount ?? 0) + delta),
  });
  await ctx.db.patch(following._id, {
    followerCount: Math.max(0, (following.followerCount ?? 0) + delta),
  });
}

export const search = query({
  args: { query: v.string() },
  returns: v.array(
    v.object({
      username: v.string(),
      isPublic: v.boolean(),
      followerCount: v.number(),
      followingCount: v.number(),
      relationship: relationshipValidator,
      avatarUrl: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { query: rawQuery }) => {
    const viewerId = await requireUser(ctx);
    const normalized = normalizeUsername(rawQuery);
    if (normalized.length < 2 || normalized.length > 24) return [];
    const users = await ctx.db
      .query('users')
      .withSearchIndex('search_username', (q) => q.search('normalizedUsername', normalized))
      .take(20);
    return Promise.all(
      users
        .filter((user): user is typeof user & { username: string } => !!user.username)
        .map(async (user) => {
          const avatarUrl = user.avatarStorageId
            ? ((await ctx.storage.getUrl(user.avatarStorageId)) ?? undefined)
            : undefined;
          const follow = user._id === viewerId ? null : await relationship(ctx, viewerId, user._id);
          const relationshipStatus: 'self' | 'none' | 'pending' | 'accepted' =
            user._id === viewerId ? 'self' : (follow?.status ?? 'none');
          return {
            username: user.username,
            isPublic: user.isPublic === true,
            followerCount: user.followerCount ?? 0,
            followingCount: user.followingCount ?? 0,
            relationship: relationshipStatus,
            ...(avatarUrl && { avatarUrl }),
          };
        }),
    );
  },
});

export const follow = mutation({
  args: { username: v.string() },
  returns: v.union(v.literal('accepted'), v.literal('pending')),
  handler: async (ctx, { username }) => {
    const followerId = await requireUser(ctx);
    const following = await userByUsername(ctx, username);
    if (!following) throw new Error('Profile not found');
    if (following._id === followerId) throw new Error('You cannot follow yourself');
    const follower = await ctx.db.get(followerId);
    if (!follower) throw new Error('Account not found');
    const existing = await relationship(ctx, followerId, following._id);
    const status = following.isPublic === true ? ('accepted' as const) : ('pending' as const);
    if (existing?.status === 'accepted') return 'accepted' as const;
    if (existing) {
      if (existing.status === 'pending' && status === 'accepted') {
        await ctx.db.patch(existing._id, { status, updatedAt: Date.now() });
        await adjustCounts(ctx, follower, following, 1);
      }
      return status;
    }
    const now = Date.now();
    await ctx.db.insert('follows', {
      followerId,
      followingId: following._id,
      status,
      createdAt: now,
      updatedAt: now,
    });
    if (status === 'accepted') await adjustCounts(ctx, follower, following, 1);
    return status;
  },
});

export const unfollow = mutation({
  args: { username: v.string() },
  returns: v.null(),
  handler: async (ctx, { username }) => {
    const followerId = await requireUser(ctx);
    const following = await userByUsername(ctx, username);
    if (!following) throw new Error('Profile not found');
    const existing = await relationship(ctx, followerId, following._id);
    if (!existing) return;
    if (existing.status === 'accepted') {
      const follower = await ctx.db.get(followerId);
      if (!follower) throw new Error('Account not found');
      await adjustCounts(ctx, follower, following, -1);
    }
    await ctx.db.delete(existing._id);
  },
});

export const followRequests = query({
  args: {},
  returns: v.array(
    v.object({
      username: v.string(),
      followerCount: v.number(),
      avatarUrl: v.optional(v.string()),
    }),
  ),
  handler: async (ctx) => {
    const followingId = await requireUser(ctx);
    const requests = await ctx.db
      .query('follows')
      .withIndex('by_following_status', (q) =>
        q.eq('followingId', followingId).eq('status', 'pending'),
      )
      .order('desc')
      .take(100);
    return (
      await Promise.all(
        requests.map(async (request) => {
          const user = await ctx.db.get(request.followerId);
          if (!user?.username) return null;
          const avatarUrl = user.avatarStorageId
            ? ((await ctx.storage.getUrl(user.avatarStorageId)) ?? undefined)
            : undefined;
          return {
            username: user.username,
            followerCount: user.followerCount ?? 0,
            ...(avatarUrl && { avatarUrl }),
          };
        }),
      )
    ).filter((request): request is NonNullable<typeof request> => request !== null);
  },
});

export const respondToFollow = mutation({
  args: { username: v.string(), accept: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { username, accept }) => {
    const followingId = await requireUser(ctx);
    const follower = await userByUsername(ctx, username);
    if (!follower) throw new Error('Profile not found');
    const following = await ctx.db.get(followingId);
    if (!following) throw new Error('Account not found');
    const request = await relationship(ctx, follower._id, followingId);
    if (!request || request.status !== 'pending') throw new Error('Follow request not found');
    if (!accept) {
      await ctx.db.delete(request._id);
      return;
    }
    await ctx.db.patch(request._id, { status: 'accepted', updatedAt: Date.now() });
    await adjustCounts(ctx, follower, following, 1);
  },
});

export const publicProfile = query({
  args: { username: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      profile: v.object({
        username: v.string(),
        isPublic: v.boolean(),
        followerCount: v.number(),
        followingCount: v.number(),
        avatarUrl: v.optional(v.string()),
      }),
      relationship: v.optional(relationshipValidator),
      stats: v.optional(statsValidator),
      publicTags: v.array(publicTagPreviewValidator),
    }),
  ),
  handler: async (ctx, args) => {
    const user = await userByUsername(ctx, args.username);
    if (!user?.username) return null;
    const viewerId = await getClerkUserId(ctx);
    const follow =
      viewerId && viewerId !== user._id ? await relationship(ctx, viewerId, user._id) : null;
    const relationshipStatus: 'self' | 'none' | 'pending' | 'accepted' | undefined =
      viewerId === user._id ? ('self' as const) : viewerId ? (follow?.status ?? 'none') : undefined;
    const avatarUrl = user.avatarStorageId
      ? ((await ctx.storage.getUrl(user.avatarStorageId)) ?? undefined)
      : undefined;
    const profile = {
      username: user.username,
      isPublic: user.isPublic === true,
      followerCount: user.followerCount ?? 0,
      followingCount: user.followingCount ?? 0,
      ...(avatarUrl && { avatarUrl }),
    };
    const collections = await ctx.db
      .query('tagCollections')
      .withIndex('by_user_tag', (q) => q.eq('userId', user._id))
      .take(500);
    const publicTags = (
      await Promise.all(
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
      )
    )
      .filter((collection) => collection.count > 0)
      .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag));
    if (
      user.isPublic !== true &&
      relationshipStatus !== 'accepted' &&
      relationshipStatus !== 'self'
    ) {
      return {
        profile,
        publicTags,
        ...(relationshipStatus && { relationship: relationshipStatus }),
      };
    }
    const stats = await profileStatsForUser(ctx, user._id);
    return {
      profile,
      ...(relationshipStatus && { relationship: relationshipStatus }),
      stats: {
        ...stats,
        favorites: stats.favorites.map((favorite) => ({
          _id: favorite._id,
          title: favorite.title,
          mediaType: favorite.mediaType,
          isAnime: favorite.isAnime,
          ...(favorite.posterPath && { posterPath: favorite.posterPath }),
          rank: favorite.rank,
        })),
      },
      publicTags,
    };
  },
});
