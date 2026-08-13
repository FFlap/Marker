import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';

export const normalizeTagKey = (tag: string) => tag.trim().toLocaleLowerCase();

const membershipPatch = (collection: Doc<'tagCollections'>, item: Doc<'items'>, rank: number) => ({
  collectionId: collection._id,
  userId: collection.userId,
  itemId: item._id,
  tagKey: collection.tagKey,
  rank,
  updatedAt: Date.now(),
});

export async function refreshTagCollectionSummary(
  ctx: MutationCtx,
  collectionId: Id<'tagCollections'>,
  memberCount: number,
) {
  const collection = await ctx.db.get(collectionId);
  if (!collection) return;
  const previewRows = await ctx.db
    .query('tagMemberships')
    .withIndex('by_collection_rank', (query) => query.eq('collectionId', collectionId))
    .take(20);
  const previewItems = await Promise.all(
    previewRows.map((membership) => ctx.db.get(membership.itemId)),
  );
  await ctx.db.patch(collectionId, {
    memberCount,
    previewPosters: previewItems
      .filter((item) => item && item.deletingAt === undefined)
      .slice(0, 3)
      .map((item) => ({
        title: item!.title,
        itemId: item!._id,
        posterPath: item!.posterPath,
      })),
    updatedAt: Date.now(),
  });
}

export async function ensureTagMemberships(
  ctx: MutationCtx,
  userId: Id<'users'>,
  label: string,
  _defaultPublic = false,
) {
  const tagKey = normalizeTagKey(label);
  if (!tagKey || tagKey.length > 40) throw new Error('Tag not found');
  let collection = await ctx.db
    .query('tagCollections')
    .withIndex('by_user_tag', (q) => q.eq('userId', userId).eq('tagKey', tagKey))
    .unique();
  if (!collection) throw new Error('Tag not found');

  const existing = await ctx.db
    .query('tagMemberships')
    .withIndex('by_collection_rank', (q) => q.eq('collectionId', collection._id))
    .take(2_001);
  if (existing.length > 2_000) throw new Error('Too many tag entries');
  if (existing.length > 0) return collection;

  throw new Error('Tag not found');
}

export async function syncItemTagMemberships(
  ctx: MutationCtx,
  item: Doc<'items'>,
  nextTags: string[],
) {
  const desired = new Map(nextTags.map((label) => [normalizeTagKey(label), label.trim()]));
  const existing = await ctx.db
    .query('tagMemberships')
    .withIndex('by_item', (q) => q.eq('itemId', item._id))
    .take(100);
  const existingByTag = new Map(existing.map((membership) => [membership.tagKey, membership]));
  const countDeltas = new Map<Id<'tagCollections'>, number>();
  const changedCollections = new Set<Id<'tagCollections'>>();
  for (const membership of existing) {
    if (!desired.has(membership.tagKey)) {
      await ctx.db.delete(membership._id);
      countDeltas.set(membership.collectionId, (countDeltas.get(membership.collectionId) ?? 0) - 1);
      changedCollections.add(membership.collectionId);
    }
  }
  for (const [tagKey, label] of desired) {
    let collection = await ctx.db
      .query('tagCollections')
      .withIndex('by_user_tag', (q) => q.eq('userId', item.userId).eq('tagKey', tagKey))
      .unique();
    if (!collection) {
      const now = Date.now();
      const collectionId = await ctx.db.insert('tagCollections', {
        userId: item.userId,
        tagKey,
        label,
        isPublic: false,
        memberCount: 0,
        previewPosters: [],
        createdAt: now,
        updatedAt: now,
      });
      collection = await ctx.db.get(collectionId);
    }
    if (!collection) throw new Error('Tag collection could not be created');
    const current = existingByTag.get(tagKey);
    let rank = current?.rank;
    if (rank === undefined) {
      const tail = await ctx.db
        .query('tagMemberships')
        .withIndex('by_collection_rank', (q) => q.eq('collectionId', collection._id))
        .order('desc')
        .first();
      rank = (tail?.rank ?? 0) + 1;
    }
    const patch = membershipPatch(collection, { ...item, tags: nextTags }, rank);
    if (current) await ctx.db.patch(current._id, patch);
    else {
      await ctx.db.insert('tagMemberships', { ...patch, createdAt: Date.now() });
      countDeltas.set(collection._id, (countDeltas.get(collection._id) ?? 0) + 1);
    }
    changedCollections.add(collection._id);
  }
  for (const collectionId of changedCollections) {
    const collection = await ctx.db.get(collectionId);
    if (!collection) continue;
    const delta = countDeltas.get(collectionId) ?? 0;
    await refreshTagCollectionSummary(
      ctx,
      collectionId,
      Math.max(0, collection.memberCount + delta),
    );
  }
}
