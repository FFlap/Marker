import { v } from 'convex/values';
import { internalMutation, internalQuery, type QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { internal } from './_generated/api';
import {
  CALENDAR_TTL_MS,
  catalogRegion,
  libraryTitleValidator,
  scheduleKey,
} from './calendarTypes';

const monthArgs = { month: v.string(), region: v.string() };
const catalogValidator = v.object({ version: v.string(), refreshedAt: v.number() });
const metadataValidator = v.object({
  ...catalogValidator.fields,
  error: v.optional(v.string()),
  retryAt: v.optional(v.number()),
});
const savedValidator = v.object({ refreshedAt: v.number() });
const DIRECT_LIBRARY_LIMIT = 20;

async function savedTitle(ctx: QueryCtx, item: Doc<'items'>, month: string, region: string) {
  if (item.deletingAt !== undefined || item.status === 'dropped') return null;
  const saved = await ctx.db
    .query('calendarSchedules')
    .withIndex('by_key', (q) => q.eq('key', scheduleKey(month, region, item)))
    .unique();
  return {
    item: {
      mediaType: item.mediaType,
      tmdbId: item.tmdbId,
      title: item.title,
      status: item.status,
      ...(item.posterPath && { posterPath: item.posterPath }),
      ...(item.releaseDate && { releaseDate: item.releaseDate }),
    },
    saved: saved?.version ? { refreshedAt: saved.refreshedAt } : null,
  };
}

export const metadata = internalQuery({
  args: monthArgs,
  returns: v.union(v.null(), metadataValidator),
  handler: async (ctx, { month, region }) => {
    const row = await ctx.db
      .query('calendarMonths')
      .withIndex('by_region_month', (q) => q.eq('region', region).eq('month', month))
      .unique();
    return row
      ? {
          version: row.version,
          refreshedAt: row.refreshedAt,
          ...(row.discoveryError && { error: row.discoveryError }),
          ...(row.discoveryRetryAt && { retryAt: row.discoveryRetryAt }),
        }
      : null;
  },
});

export const claim = internalMutation({
  args: { ...monthArgs, token: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { month, region, token }) => {
    const row = await ctx.db
      .query('calendarMonths')
      .withIndex('by_region_month', (q) => q.eq('region', region).eq('month', month))
      .unique();
    if (
      row &&
      (row.refreshedAt > Date.now() - CALENDAR_TTL_MS ||
        (row.leaseExpiresAt ?? 0) > Date.now() ||
        (row.discoveryRetryAt ?? 0) > Date.now())
    )
      return false;
    const lease = {
      leaseToken: token,
      leaseExpiresAt: Date.now() + 120_000,
      stagingVersion: row?.stagingVersion ?? token,
      discoveryFeed: row?.discoveryFeed ?? 0,
      discoveryPage: row?.discoveryPage ?? 1,
      stagingCount: row?.stagingCount ?? 0,
      discoveryFailures: 0,
      discoveryError: undefined,
      discoveryRetryAt: undefined,
    };
    if (row) await ctx.db.patch(row._id, lease);
    else
      await ctx.db.insert('calendarMonths', {
        month,
        region,
        candidateCount: 0,
        version: '',
        refreshedAt: 0,
        ...lease,
      });
    await ctx.scheduler.runAfter(0, internal.calendarDiscovery.continueDiscovery, {
      month,
      region,
      token,
    });
    await ctx.scheduler.runAfter(120_000, internal.calendarRefresh.recover, {
      month,
      region,
      token,
    });
    return true;
  },
});

export const page = internalQuery({
  args: {
    ...monthArgs,
    userId: v.id('users'),
    mediaType: v.union(v.literal('movie'), v.literal('tv')),
    offset: v.number(),
    version: v.optional(v.string()),
  },
  returns: v.object({
    catalog: v.union(v.null(), catalogValidator),
    direct: v.boolean(),
    version: v.string(),
    emptyLibrary: v.boolean(),
    nextMediaType: v.union(v.literal('movie'), v.null()),
    nextOffset: v.union(v.null(), v.number()),
    titles: v.array(
      v.object({ item: libraryTitleValidator, saved: v.union(v.null(), savedValidator) }),
    ),
  }),
  handler: async (ctx, { month, region, mediaType, userId, offset, version }) => {
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Invalid calendar cursor');
    const [library, hasMovies] = await Promise.all([
      ctx.db
        .query('items')
        .withIndex('by_user_tmdb_active', (q) =>
          q.eq('userId', userId).eq('mediaType', mediaType).eq('deletingAt', undefined),
        )
        .take(DIRECT_LIBRARY_LIMIT + 1),
      mediaType === 'tv'
        ? ctx.db
            .query('items')
            .withIndex('by_user_tmdb_active', (q) =>
              q.eq('userId', userId).eq('mediaType', 'movie').eq('deletingAt', undefined),
            )
            .first()
        : null,
    ]);
    const nextMediaType = hasMovies ? ('movie' as const) : null;
    if (library.length <= DIRECT_LIBRARY_LIMIT) {
      const titles = (
        await Promise.all(library.map((item) => savedTitle(ctx, item, month, region)))
      ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      const currentVersion = `library:${JSON.stringify(titles.map(({ item }) => item.tmdbId))}`;
      if (offset !== 0 || (version && version !== currentVersion))
        throw new Error('Release dates changed. Please retry the calendar.');
      return {
        catalog: null,
        direct: true,
        version: currentVersion,
        nextOffset: null,
        titles,
        emptyLibrary: titles.length === 0,
        nextMediaType,
      };
    }
    const catalog = await ctx.db
      .query('calendarMonths')
      .withIndex('by_region_month', (q) =>
        q.eq('region', catalogRegion(region, mediaType)).eq('month', month),
      )
      .unique();
    if (!catalog?.version)
      return {
        catalog: null,
        direct: false,
        version: '',
        nextOffset: null,
        titles: [],
        emptyLibrary: false,
        nextMediaType,
      };
    if (version && version !== catalog.version)
      throw new Error('Release dates changed. Please retry the calendar.');
    const candidateCount = catalog.candidateCount;
    if (offset > candidateCount) throw new Error('Invalid calendar cursor');
    const matches = [];
    let consumed = 0;
    const scanLimit = Math.min(1500, candidateCount - offset);
    while (consumed < scanLimit && matches.length < 100) {
      const size = Math.min(100 - matches.length, scanLimit - consumed);
      const batch = await ctx.db
        .query('calendarCandidates')
        .withIndex('by_catalog_ordinal', (q) =>
          q
            .eq('region', catalog.region)
            .eq('month', month)
            .eq('version', catalog.version)
            .gte('ordinal', offset + consumed),
        )
        .take(size);
      if (!batch.length) throw new Error('Release catalog is incomplete. Please retry.');
      const found = await Promise.all(
        batch.map(async (candidate) => {
          const item = await ctx.db
            .query('items')
            .withIndex('by_user_tmdb_active', (q) =>
              q
                .eq('userId', userId)
                .eq('mediaType', candidate.mediaType)
                .eq('deletingAt', undefined)
                .eq('tmdbId', candidate.tmdbId),
            )
            .unique();
          return item ? savedTitle(ctx, item, month, region) : null;
        }),
      );
      matches.push(...found.filter((match): match is NonNullable<typeof match> => match !== null));
      consumed += batch.length;
    }
    const next = offset + consumed;
    return {
      emptyLibrary: false,
      direct: false,
      version: catalog.version,
      nextMediaType,
      catalog: { version: catalog.version, refreshedAt: catalog.refreshedAt },
      nextOffset: next < candidateCount ? next : null,
      titles: matches,
    };
  },
});

export const prune = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // Retain the previous UTC month for devices that have not crossed the month boundary yet.
    const now = new Date(Date.now());
    const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
      .toISOString()
      .slice(0, 7);
    const months = await ctx.db
      .query('calendarMonths')
      .withIndex('by_month', (q) => q.lt('month', cutoff))
      .take(5);
    const schedules = await ctx.db
      .query('calendarSchedules')
      .withIndex('by_month', (q) => q.lt('month', cutoff))
      .take(5);
    const candidates = await ctx.db
      .query('calendarCandidates')
      .withIndex('by_month', (q) => q.lt('month', cutoff))
      .take(100);
    const chunks = await ctx.db
      .query('calendarReleaseChunks')
      .withIndex('by_month', (q) => q.lt('month', cutoff))
      .take(100);
    for (const row of [...months, ...schedules, ...candidates, ...chunks])
      await ctx.db.delete(row._id);
    if (
      months.length === 5 ||
      schedules.length === 5 ||
      candidates.length === 100 ||
      chunks.length === 100
    )
      await ctx.scheduler.runAfter(0, internal.calendarCatalog.prune, {});
    return null;
  },
});
