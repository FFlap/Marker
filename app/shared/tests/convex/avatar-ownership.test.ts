import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from '../../convex/_generated/api';
import schema from '../../convex/schema';

const modules = import.meta.glob('../../convex/**/*.ts');

describe('avatar upload ownership', () => {
  it('binds the upload endpoint to the account that opened the pending upload', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert('users', { clerkId: 'avatar_uploader' });
      await ctx.db.insert('users', { clerkId: 'avatar_intruder' });
    });
    const uploader = t.withIdentity({ subject: 'avatar_uploader' });
    const intruder = t.withIdentity({ subject: 'avatar_intruder' });
    const uploadPath = await uploader.mutation(api.profiles.generateAvatarUploadUrl, {});
    const request = {
      method: 'POST',
      headers: { 'Content-Type': 'image/png', 'Content-Length': '5' },
      body: new Blob(['image'], { type: 'image/png' }),
    } satisfies RequestInit;

    expect((await intruder.fetch(uploadPath, request)).status).toBe(400);
    const response = await uploader.fetch(uploadPath, request);
    expect(response.status).toBe(200);
    const { storageId } = (await response.json()) as { storageId: string };
    const upload = await t.run((ctx) =>
      ctx.db
        .query('avatarUploads')
        .withIndex('by_storage', (query) => query.eq('storageId', storageId as never))
        .unique(),
    );
    expect(upload).toMatchObject({ status: 'pending' });
  });

  it('rejects another user’s storage id without deleting the file', async () => {
    const t = convexTest(schema, modules);
    const { ownerId, attackerId, storageId } = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert('users', { clerkId: 'avatar_owner' });
      const attackerId = await ctx.db.insert('users', { clerkId: 'avatar_attacker' });
      const storageId = await ctx.storage.store(new Blob(['owned image'], { type: 'image/png' }));
      await ctx.db.insert('avatarUploads', {
        userId: ownerId,
        storageId,
        status: 'active',
        createdAt: Date.now(),
      });
      await ctx.db.patch(ownerId, { avatarStorageId: storageId });
      return { ownerId, attackerId, storageId };
    });
    const attacker = t.withIdentity({ subject: 'avatar_attacker' });

    await expect(attacker.mutation(api.profiles.setAvatar, { storageId })).rejects.toThrow(
      'not created by this account',
    );
    const state = await t.run(async (ctx) => ({
      file: await ctx.db.system.get('_storage', storageId),
      owner: await ctx.db.get(ownerId),
      attacker: await ctx.db.get(attackerId),
    }));
    expect(state.file).not.toBeNull();
    expect(state.owner?.avatarStorageId).toBe(storageId);
    expect(state.attacker?.avatarStorageId).toBeUndefined();
  });

  it('clears an unproven legacy reference without deleting its storage file', async () => {
    const t = convexTest(schema, modules);
    const { userId, storageId } = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(['legacy image'], { type: 'image/png' }));
      const userId = await ctx.db.insert('users', {
        clerkId: 'avatar_legacy',
        avatarStorageId: storageId,
      });
      return { userId, storageId };
    });

    await t.withIdentity({ subject: 'avatar_legacy' }).mutation(api.profiles.removeAvatar, {});
    const state = await t.run(async (ctx) => ({
      file: await ctx.db.system.get('_storage', storageId),
      user: await ctx.db.get(userId),
    }));
    expect(state.file).not.toBeNull();
    expect(state.user?.avatarStorageId).toBeUndefined();
  });
});
