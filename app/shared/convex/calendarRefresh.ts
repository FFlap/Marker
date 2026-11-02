import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { CALENDAR_TTL_MS, candidateValidator } from './calendarTypes';

const args = { month: v.string(), region: v.string(), token: v.string() };
export const progress = internalQuery({
  args,
  returns: v.union(v.null(), v.object({ feed: v.number(), page: v.number() })),
  handler: async (ctx, { month, region, token }) => {
    const row = await ctx.db
      .query('calendarMonths')
      .withIndex('by_region_month', (q) => q.eq('region', region).eq('month', month))
      .unique();
    return row?.leaseToken === token && row.stagingVersion
      ? { feed: row.discoveryFeed ?? 0, page: row.discoveryPage ?? 1 }
      : null;
  },
});

export const checkpoint = internalMutation({
  args: {
    ...args,
    feed: v.number(),
    page: v.number(),
    totalPages: v.number(),
    candidates: v.array(candidateValidator),
  },
  returns: v.boolean(),
  handler: async (ctx, { month, region, token, feed, page, totalPages, candidates }) => {
    if (candidates.length > 1000) throw new Error('Discovery page exceeds the storage limit');
    const row = await ctx.db
      .query('calendarMonths')
      .withIndex('by_region_month', (q) => q.eq('region', region).eq('month', month))
      .unique();
    if (
      !row ||
      row.leaseToken !== token ||
      !row.stagingVersion ||
      (row.discoveryFeed ?? 0) !== feed ||
      (row.discoveryPage ?? 1) !== page
    )
      return false;
    let count = row.stagingCount ?? 0;
    for (const candidate of candidates) {
      const existing = await ctx.db
        .query('calendarCandidates')
        .withIndex('by_catalog_title', (q) =>
          q
            .eq('region', region)
            .eq('month', month)
            .eq('version', row.stagingVersion!)
            .eq('mediaType', candidate.mediaType)
            .eq('tmdbId', candidate.tmdbId),
        )
        .unique();
      if (!existing)
        await ctx.db.insert('calendarCandidates', {
          month,
          region,
          version: row.stagingVersion,
          ordinal: count++,
          ...candidate,
        });
    }
    const nextFeed = page >= totalPages ? feed + 1 : feed;
    const done = nextFeed >= (region === 'tv' ? 1 : 2);
    await ctx.db.patch(
      row._id,
      done
        ? {
            version: row.stagingVersion,
            candidateCount: count,
            refreshedAt: Date.now(),
            leaseToken: undefined,
            leaseExpiresAt: undefined,
            stagingVersion: undefined,
            discoveryFeed: undefined,
            discoveryPage: undefined,
            stagingCount: undefined,
            discoveryFailures: undefined,
            discoveryError: undefined,
            discoveryRetryAt: undefined,
          }
        : {
            stagingCount: count,
            discoveryFailures: 0,
            discoveryFeed: nextFeed,
            discoveryPage: nextFeed === feed ? page + 1 : 1,
            leaseExpiresAt: Date.now() + 120_000,
          },
    );
    if (!done)
      await ctx.scheduler.runAfter(0, internal.calendarDiscovery.continueDiscovery, {
        month,
        region,
        token,
      });
    if (done && row.version)
      await ctx.scheduler.runAfter(0, internal.calendarRefresh.discardVersion, {
        month,
        region,
        version: row.version,
      });
    return !done;
  },
});

export const failed = internalMutation({
  args: {
    ...args,
    feed: v.number(),
    page: v.number(),
    permanent: v.boolean(),
    message: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, { month, region, token, feed, page, permanent, message }) => {
    const row = await ctx.db
      .query('calendarMonths')
      .withIndex('by_region_month', (q) => q.eq('region', region).eq('month', month))
      .unique();
    if (
      !row ||
      row.leaseToken !== token ||
      !row.stagingVersion ||
      row.discoveryFeed !== feed ||
      row.discoveryPage !== page
    )
      return null;
    const failures = (row.discoveryFailures ?? 0) + 1;
    if (permanent || failures >= 5) {
      await ctx.db.patch(row._id, {
        leaseToken: undefined,
        leaseExpiresAt: undefined,
        discoveryFailures: failures,
        discoveryError: message.slice(0, 500),
        discoveryRetryAt: Date.now() + (permanent ? CALENDAR_TTL_MS : 60_000),
      });
    } else {
      await ctx.db.patch(row._id, {
        discoveryFailures: failures,
        leaseExpiresAt: Date.now() + 180_000,
      });
      await ctx.scheduler.runAfter(60_000, internal.calendarDiscovery.continueDiscovery, {
        month,
        region,
        token,
      });
    }
    return null;
  },
});

export const recover = internalMutation({
  args,
  returns: v.null(),
  handler: async (ctx, { month, region, token }) => {
    const row = await ctx.db
      .query('calendarMonths')
      .withIndex('by_region_month', (q) => q.eq('region', region).eq('month', month))
      .unique();
    if (!row || row.leaseToken !== token || !row.stagingVersion) return null;
    const delay = (row.leaseExpiresAt ?? 0) - Date.now();
    if (delay > 0) {
      await ctx.scheduler.runAfter(delay, internal.calendarRefresh.recover, {
        month,
        region,
        token,
      });
      return null;
    }
    const nextToken = `${row.stagingVersion}:${Date.now()}`;
    await ctx.db.patch(row._id, { leaseToken: nextToken, leaseExpiresAt: Date.now() + 120_000 });
    await ctx.scheduler.runAfter(0, internal.calendarDiscovery.continueDiscovery, {
      month,
      region,
      token: nextToken,
    });
    await ctx.scheduler.runAfter(120_000, internal.calendarRefresh.recover, {
      month,
      region,
      token: nextToken,
    });
    return null;
  },
});

export const discardVersion = internalMutation({
  args: { month: v.string(), region: v.string(), version: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('calendarCandidates')
      .withIndex('by_catalog_ordinal', (q) =>
        q.eq('region', args.region).eq('month', args.month).eq('version', args.version),
      )
      .take(200);
    for (const row of rows) await ctx.db.delete(row._id);
    if (rows.length === 200)
      await ctx.scheduler.runAfter(0, internal.calendarRefresh.discardVersion, args);
    return null;
  },
});
