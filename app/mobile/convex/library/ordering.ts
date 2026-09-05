import { internalMutation, internalQuery, mutation, type MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { v } from 'convex/values';
import { refreshTagCollectionSummary } from '../tagCollectionsModel';
import { itemActivityBase, writeActivityEvents } from '../activityEvents';
import { requestProfileStatsRefresh } from '../profileStatsRefresh';
import { hasTag, normalizedTagKey, ownedItem, requireUser, status } from './shared';

type MoveItemArgs = {
  itemId: Id<'items'>;
  status?: Doc<'items'>['status'];
  beforeId?: Id<'items'>;
  afterId?: Id<'items'>;
};

const RANK_EPSILON = 1e-9;
const REBALANCE_SIDE = 8;

const compareRanked = <T extends { rank: number; _creationTime: number; _id: unknown }>(
  left: T,
  right: T,
) =>
  left.rank - right.rank ||
  left._creationTime - right._creationTime ||
  String(left._id).localeCompare(String(right._id));

async function statusRowBefore(
  ctx: MutationCtx,
  userId: Id<'users'>,
  targetStatus: Doc<'items'>['status'],
  rank: number,
  movedId: Id<'items'>,
  inclusive = false,
) {
  const rows = await ctx.db
    .query('items')
    .withIndex('by_user_status', (query) => {
      const prefix = query.eq('userId', userId).eq('status', targetStatus);
      return inclusive ? prefix.lte('rank', rank) : prefix.lt('rank', rank);
    })
    .filter((query) => query.eq(query.field('deletingAt'), undefined))
    .order('desc')
    .take(2);
  return rows.find((row) => row._id !== movedId);
}

async function statusRowAfter(
  ctx: MutationCtx,
  userId: Id<'users'>,
  targetStatus: Doc<'items'>['status'],
  rank: number,
  movedId: Id<'items'>,
  inclusive = false,
) {
  const rows = await ctx.db
    .query('items')
    .withIndex('by_user_status', (query) => {
      const prefix = query.eq('userId', userId).eq('status', targetStatus);
      return inclusive ? prefix.gte('rank', rank) : prefix.gt('rank', rank);
    })
    .filter((query) => query.eq(query.field('deletingAt'), undefined))
    .take(2);
  return rows.find((row) => row._id !== movedId);
}

async function rebalanceStatusWindow(
  ctx: MutationCtx,
  userId: Id<'users'>,
  targetStatus: Doc<'items'>['status'],
  movedId: Id<'items'>,
  before: Doc<'items'>,
  after: Doc<'items'>,
) {
  const [leftRows, rightRows] = await Promise.all([
    ctx.db
      .query('items')
      .withIndex('by_user_status', (query) =>
        query.eq('userId', userId).eq('status', targetStatus).lte('rank', before.rank),
      )
      .filter((query) => query.eq(query.field('deletingAt'), undefined))
      .order('desc')
      .take(REBALANCE_SIDE + 1),
    ctx.db
      .query('items')
      .withIndex('by_user_status', (query) =>
        query.eq('userId', userId).eq('status', targetStatus).gte('rank', after.rank),
      )
      .filter((query) => query.eq(query.field('deletingAt'), undefined))
      .take(REBALANCE_SIDE + 1),
  ]);
  const left = leftRows.filter((row) => row._id !== movedId);
  const right = rightRows.filter((row) => row._id !== movedId);
  const lower = left[REBALANCE_SIDE];
  const upper = right[REBALANCE_SIDE];
  const window = [
    ...new Map(
      [...left.slice(0, REBALANCE_SIDE), ...right.slice(0, REBALANCE_SIDE)].map((row) => [
        String(row._id),
        row,
      ]),
    ).values(),
  ].sort(compareRanked);
  const step = lower && upper ? (upper.rank - lower.rank) / (window.length + 1) : 1;
  const start = lower ? lower.rank + step : upper ? upper.rank - step * window.length : 1;
  if (!Number.isFinite(step) || step <= 0 || (lower && start === lower.rank))
    throw new Error('Item order is too dense to update');
  const ranks = new Map<Id<'items'>, number>();
  for (const [index, row] of window.entries()) {
    const rank = start + step * index;
    ranks.set(row._id, rank);
    if (row.rank !== rank) await ctx.db.patch(row._id, { rank });
  }
  const beforeRank = ranks.get(before._id);
  const afterRank = ranks.get(after._id);
  if (beforeRank === undefined || afterRank === undefined)
    throw new Error('Item order is too dense to update');
  return { beforeRank, afterRank };
}

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
  let before: Doc<'items'> | undefined;
  let after: Doc<'items'> | undefined;
  if (claimedBefore && claimedAfter) {
    const next = await statusRowAfter(ctx, userId, targetStatus, claimedBefore.rank, item._id);
    if (claimedBefore.rank < claimedAfter.rank && next?._id === claimedAfter._id) {
      before = claimedBefore;
      after = claimedAfter;
    } else {
      const projectedRank = (claimedBefore.rank + claimedAfter.rank) / 2;
      before = await statusRowBefore(ctx, userId, targetStatus, projectedRank, item._id, true);
      after = before
        ? await statusRowAfter(ctx, userId, targetStatus, before.rank, item._id)
        : await statusRowAfter(ctx, userId, targetStatus, projectedRank, item._id, true);
    }
  } else if (claimedBefore) {
    before = claimedBefore;
    after = await statusRowAfter(ctx, userId, targetStatus, before.rank, item._id);
  } else if (claimedAfter) {
    after = claimedAfter;
    before = await statusRowBefore(ctx, userId, targetStatus, after.rank, item._id);
  } else {
    after = await statusRowAfter(ctx, userId, targetStatus, -Number.MAX_VALUE, item._id, true);
  }
  let rank: number;
  if (before && after) {
    let beforeRank = before.rank;
    let afterRank = after.rank;
    if (afterRank - beforeRank < RANK_EPSILON) {
      ({ beforeRank, afterRank } = await rebalanceStatusWindow(
        ctx,
        userId,
        targetStatus,
        item._id,
        before,
        after,
      ));
    }
    rank = (beforeRank + afterRank) / 2;
  } else if (before) rank = before.rank + 1;
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

async function tagMembership(
  ctx: MutationCtx,
  userId: Id<'users'>,
  tagKey: string,
  itemId: Id<'items'> | undefined,
) {
  if (!itemId) return undefined;
  return (
    (await ctx.db
      .query('tagMemberships')
      .withIndex('by_user_tag_item', (query) =>
        query.eq('userId', userId).eq('tagKey', tagKey).eq('itemId', itemId),
      )
      .unique()) ?? undefined
  );
}

async function tagRowBefore(
  ctx: MutationCtx,
  collectionId: Id<'tagCollections'>,
  rank: number,
  movedId: Id<'tagMemberships'>,
  inclusive = false,
) {
  const rows = await ctx.db
    .query('tagMemberships')
    .withIndex('by_collection_rank', (query) => {
      const prefix = query.eq('collectionId', collectionId);
      return inclusive ? prefix.lte('rank', rank) : prefix.lt('rank', rank);
    })
    .order('desc')
    .take(2);
  return rows.find((row) => row._id !== movedId);
}

async function tagRowAfter(
  ctx: MutationCtx,
  collectionId: Id<'tagCollections'>,
  rank: number,
  movedId: Id<'tagMemberships'>,
  inclusive = false,
) {
  const rows = await ctx.db
    .query('tagMemberships')
    .withIndex('by_collection_rank', (query) => {
      const prefix = query.eq('collectionId', collectionId);
      return inclusive ? prefix.gte('rank', rank) : prefix.gt('rank', rank);
    })
    .take(2);
  return rows.find((row) => row._id !== movedId);
}

async function rebalanceTagWindow(
  ctx: MutationCtx,
  collectionId: Id<'tagCollections'>,
  movedId: Id<'tagMemberships'>,
  before: Doc<'tagMemberships'>,
  after: Doc<'tagMemberships'>,
) {
  const [leftRows, rightRows] = await Promise.all([
    ctx.db
      .query('tagMemberships')
      .withIndex('by_collection_rank', (query) =>
        query.eq('collectionId', collectionId).lte('rank', before.rank),
      )
      .order('desc')
      .take(REBALANCE_SIDE + 1),
    ctx.db
      .query('tagMemberships')
      .withIndex('by_collection_rank', (query) =>
        query.eq('collectionId', collectionId).gte('rank', after.rank),
      )
      .take(REBALANCE_SIDE + 1),
  ]);
  const left = leftRows.filter((row) => row._id !== movedId);
  const right = rightRows.filter((row) => row._id !== movedId);
  const lower = left[REBALANCE_SIDE];
  const upper = right[REBALANCE_SIDE];
  const window = [
    ...new Map(
      [...left.slice(0, REBALANCE_SIDE), ...right.slice(0, REBALANCE_SIDE)].map((row) => [
        String(row._id),
        row,
      ]),
    ).values(),
  ].sort(compareRanked);
  const step = lower && upper ? (upper.rank - lower.rank) / (window.length + 1) : 1;
  const start = lower ? lower.rank + step : upper ? upper.rank - step * window.length : 1;
  if (!Number.isFinite(step) || step <= 0 || (lower && start === lower.rank))
    throw new Error('Tag order is too dense to update');
  const now = Date.now();
  const ranks = new Map<Id<'tagMemberships'>, number>();
  for (const [index, row] of window.entries()) {
    const rank = start + step * index;
    ranks.set(row._id, rank);
    if (row.rank !== rank) await ctx.db.patch(row._id, { rank, updatedAt: now });
  }
  const beforeRank = ranks.get(before._id);
  const afterRank = ranks.get(after._id);
  if (beforeRank === undefined || afterRank === undefined)
    throw new Error('Tag order is too dense to update');
  return { beforeRank, afterRank };
}

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
    const collection = await ctx.db
      .query('tagCollections')
      .withIndex('by_user_tag', (query) => query.eq('userId', userId).eq('tagKey', tagKey))
      .unique();
    if (!collection) throw new Error('Tag not found');
    const current = await tagMembership(ctx, userId, tagKey, moved._id);
    if (!current || current.collectionId !== collection._id)
      throw new Error('Tag order could not be initialized');
    const beforeClaim = await tagMembership(ctx, userId, tagKey, args.beforeId);
    const afterClaim = await tagMembership(ctx, userId, tagKey, args.afterId);
    const claimedBefore = beforeClaim?._id === current._id ? undefined : beforeClaim;
    const claimedAfter = afterClaim?._id === current._id ? undefined : afterClaim;
    let before: Doc<'tagMemberships'> | undefined;
    let after: Doc<'tagMemberships'> | undefined;
    if (claimedBefore && claimedAfter) {
      const next = await tagRowAfter(ctx, collection._id, claimedBefore.rank, current._id);
      if (claimedBefore.rank < claimedAfter.rank && next?._id === claimedAfter._id) {
        before = claimedBefore;
        after = claimedAfter;
      } else {
        const projectedRank = (claimedBefore.rank + claimedAfter.rank) / 2;
        before = await tagRowBefore(ctx, collection._id, projectedRank, current._id, true);
        after = before
          ? await tagRowAfter(ctx, collection._id, before.rank, current._id)
          : await tagRowAfter(ctx, collection._id, projectedRank, current._id, true);
      }
    } else if (claimedBefore) {
      before = claimedBefore;
      after = await tagRowAfter(ctx, collection._id, before.rank, current._id);
    } else if (claimedAfter) {
      after = claimedAfter;
      before = await tagRowBefore(ctx, collection._id, after.rank, current._id);
    } else {
      after = await tagRowAfter(ctx, collection._id, -Number.MAX_VALUE, current._id, true);
    }
    let beforeRank = before?.rank;
    let afterRank = after?.rank;
    if (
      before &&
      after &&
      beforeRank !== undefined &&
      afterRank !== undefined &&
      afterRank - beforeRank < RANK_EPSILON
    )
      ({ beforeRank, afterRank } = await rebalanceTagWindow(
        ctx,
        collection._id,
        current._id,
        before,
        after,
      ));
    const nextRank =
      beforeRank !== undefined && afterRank !== undefined
        ? (beforeRank + afterRank) / 2
        : beforeRank !== undefined
          ? beforeRank + 1
          : afterRank !== undefined
            ? afterRank - 1
            : 1;
    await ctx.db.patch(current._id, { rank: nextRank, updatedAt: Date.now() });
    await refreshTagCollectionSummary(ctx, collection._id, collection.memberCount);
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
