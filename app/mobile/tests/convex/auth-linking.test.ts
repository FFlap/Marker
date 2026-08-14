import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import schema from '../../convex/schema';
import { api, internal } from '../../convex/_generated/api';

const modules = import.meta.glob('../../convex/**/*.ts');
afterEach(() => vi.unstubAllEnvs());

describe('Clerk account identity linking', () => {
  it('creates a complete Marker profile for a new Clerk identity', async () => {
    const t = convexTest(schema, modules);
    const userId = await t
      .withIdentity({
        subject: 'user_new_clerk',
        email: 'new@example.com',
        preferredUsername: 'new_viewer',
      })
      .mutation(api.clerkAuth.ensureCurrentUser, {});

    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user).toMatchObject({
      clerkId: 'user_new_clerk',
      email: 'new@example.com',
      username: 'new_viewer',
      normalizedUsername: 'new_viewer',
      isPublic: false,
      followerCount: 0,
      followingCount: 0,
    });
  });

  it('provisions a new Clerk identity before an email claim reaches the JWT', async () => {
    const t = convexTest(schema, modules);
    const userId = await t
      .withIdentity({ subject: 'user_fresh_session' })
      .mutation(api.clerkAuth.ensureCurrentUser, { username: 'fresh_viewer' });

    const user = await t.run((ctx) => ctx.db.get(userId));
    expect(user).toMatchObject({
      clerkId: 'user_fresh_session',
      username: 'fresh_viewer',
      normalizedUsername: 'fresh_viewer',
    });
    expect(user?.email).toBeUndefined();
  });

  it('does not restart profile stats work when resolving an already-linked account', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: 'user_repeat_login' });
    const userId = await asUser.mutation(api.clerkAuth.ensureCurrentUser, {});
    const before = await t.run((ctx) =>
      ctx.db
        .query('profileStatsRefreshes')
        .withIndex('by_user', (query) => query.eq('userId', userId))
        .unique(),
    );
    expect(before?.restartRequested).toBe(false);

    await asUser.mutation(api.clerkAuth.ensureCurrentUser, {});
    const after = await t.run((ctx) =>
      ctx.db
        .query('profileStatsRefreshes')
        .withIndex('by_user', (query) => query.eq('userId', userId))
        .unique(),
    );
    expect(after?.restartRequested).toBe(false);
  });

  it('restarts profile stats work that stopped making progress', async () => {
    const t = convexTest(schema, modules);
    const asUser = t.withIdentity({ subject: 'user_stalled_stats' });
    const userId = await asUser.mutation(api.clerkAuth.ensureCurrentUser, {});
    const refreshId = await t.run(async (ctx) => {
      const refresh = await ctx.db
        .query('profileStatsRefreshes')
        .withIndex('by_user', (query) => query.eq('userId', userId))
        .unique();
      if (!refresh) throw new Error('Expected a profile refresh');
      await ctx.db.patch(refresh._id, {
        restartRequested: false,
        lastProgressAt: Date.now() - 10 * 60 * 1_000,
      });
      return refresh._id;
    });

    const beforeRestart = Date.now();
    await t.mutation(internal.profileStatsRefresh.start, { userId });
    expect(await t.run((ctx) => ctx.db.get(refreshId))).toMatchObject({
      restartRequested: true,
      lastProgressAt: expect.any(Number),
    });
    expect((await t.run((ctx) => ctx.db.get(refreshId)))?.lastProgressAt).toBeGreaterThanOrEqual(
      beforeRestart,
    );
  });

  it('does not fall back to email or let a second Clerk identity claim a profile', async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert('users', {
        clerkId: 'user_owner',
        email: 'viewer@example.com',
        username: 'viewer',
        normalizedUsername: 'viewer',
      }),
    );

    await expect(
      t
        .withIdentity({ subject: 'user_attacker', email: 'viewer@example.com' })
        .mutation(api.clerkAuth.ensureCurrentUser, {}),
    ).rejects.toThrow('already attached');
  });

  it('rejects extension watch requests without a Clerk JWT', async () => {
    const t = convexTest(schema, modules);
    const origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
    vi.stubEnv('EXTENSION_ORIGINS', origin);
    const response = await t.fetch('/extension/watch', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: 'netflix',
        seriesTitle: 'Dark',
        seasonNumber: 1,
        episodeNumber: 1,
      }),
    });
    expect(response.status).toBe(401);
  });
});
