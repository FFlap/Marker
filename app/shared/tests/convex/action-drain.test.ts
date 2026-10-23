import { afterEach, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import schema from '../../convex/schema';
import { getFunctionName } from 'convex/server';
import { orchestrateSeasonRefresh } from '../../convex/resolvedMetadata/orchestration';
import type { ActionCtx } from '../../convex/_generated/server';

const modules = import.meta.glob('../../convex/**/*.ts');
afterEach(() => vi.restoreAllMocks());

it('drains sibling reads before settling the season request or releasing its lease', async () => {
  const t = convexTest({ schema, modules });
  const userId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert('users', { clerkId: 'drain-test' });
    await ctx.db.insert('metadataRefreshRequests', {
      key: 'season:88:2',
      state: 'inFlight',
      attemptToken: 'drain-attempt',
      lastRequestedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    });
    return userId;
  });
  let rejectTitle!: (cause: Error) => void;
  let releaseMapping!: () => void;
  const title = vi.fn(
    () =>
      new Promise<null>((_, reject) => {
        rejectTitle = reject;
      }),
  );
  const mapping = vi.fn(
    () =>
      new Promise<null>((resolve) => {
        releaseMapping = () => resolve(null);
      }),
  );
  // Hold SDK promises outside convex-test's transaction mutex while running real
  // request/lease mutations, matching the action runtime's concurrent RPCs.
  const ctx = {
    runMutation: t.mutation,
    runQuery: (reference, args) => {
      const name = getFunctionName(reference);
      if (name === 'resolvedMetadata/reads:readTitle') return title();
      if (name === 'resolvedMetadata/reads:readTitleMapping') return mapping();
      return t.query(reference, args);
    },
  } as Pick<ActionCtx, 'runQuery' | 'runMutation'> as ActionCtx;
  let returned = false;
  const pending = orchestrateSeasonRefresh
    ._handler(ctx, {
      userId,
      tmdbId: 88,
      season: 2,
      key: 'season:88:2',
      attemptToken: 'drain-attempt',
    })
    .then(() => {
      returned = true;
    });
  await vi.waitFor(() => {
    expect(title).toHaveBeenCalledTimes(1);
    expect(mapping).toHaveBeenCalledTimes(1);
  });
  rejectTitle(new Error('read failed'));
  // Allow the rejection and any premature finalization to propagate while the sibling is held.
  await new Promise((resolve) => setTimeout(resolve, 20));
  try {
    expect(returned).toBe(false);
    await t.run(async (ctx) => {
      const request = await ctx.db
        .query('metadataRefreshRequests')
        .withIndex('by_key', (q) => q.eq('key', 'season:88:2'))
        .unique();
      const lease = await ctx.db
        .query('metadataRefreshLeases')
        .withIndex('by_key', (q) => q.eq('key', 'metadata:tv:88'))
        .unique();
      expect(request?.state).toBe('inFlight');
      expect(lease?.token).toBe('scheduled:drain-attempt');
    });
  } finally {
    releaseMapping();
    await pending;
  }
  await t.run(async (ctx) => {
    const request = await ctx.db
      .query('metadataRefreshRequests')
      .withIndex('by_key', (q) => q.eq('key', 'season:88:2'))
      .unique();
    const lease = await ctx.db
      .query('metadataRefreshLeases')
      .withIndex('by_key', (q) => q.eq('key', 'metadata:tv:88'))
      .unique();
    expect(request?.state).toBe('failed');
    expect(lease).toBeNull();
  });
});
