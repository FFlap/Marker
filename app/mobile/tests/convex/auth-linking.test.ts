import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import schema from '../../convex/schema';
import { api, internal } from '../../convex/_generated/api';
import { ConvexError, v } from 'convex/values';
import { internalAction } from '../../convex/_generated/server';

const modules = import.meta.glob('../../convex/**/*.ts');
afterEach(() => vi.unstubAllEnvs());

describe('extension provider failures', () => {
  it.each([
    ...[
      'timeout',
      'provider_global_limiter',
      'upstream',
      'stale_epoch',
      'stale_season_version',
      'refresh_in_progress',
      'refresh_superseded',
      'mapping_changed',
      'title_unavailable',
      'touch_budget',
    ].map((code) => [new ConvexError({ code, retryable: true }), 503] as const),
    [new Error('Uncaught ConvexError: {"code":"refresh_in_progress"}'), 503],
    [new Error('Uncaught ConvexError: {"code":"touch_budget","retryable":true}'), 503],
    [new ConvexError({ code: 'timeout', retryable: false }), 400],
    [new Error('Invalid payload: timeout upstream refresh_in_progress'), 400],
    [new Error('Invalid payload: "ConvexError: {\\"code\\":\\"timeout\\"}"'), 400],
    [new ConvexError({ code: 'invalid-request' }), 400],
  ])('classifies %s as HTTP %s', async (error, status) => {
    const t = convexTest(schema, {
      ...modules,
      '../../convex/sync.ts': async () => ({
        recordWatchFromExtensionInternal: internalAction({
          args: { userId: v.id('users') },
          handler: async () => {
            throw error;
          },
        }),
      }),
    });
    await t.run((ctx) => ctx.db.insert('users', { clerkId: 'sync_user' }));
    const origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
    vi.stubEnv('EXTENSION_ORIGINS', origin);
    const response = await t.withIdentity({ subject: 'sync_user' }).fetch('/extension/watch', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      error: status === 503 ? 'upstream' : 'invalid-request',
    });
  });
});

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
