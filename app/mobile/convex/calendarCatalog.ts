import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import {
  CALENDAR_TTL_MS,
  catalogRegion,
  candidateValidator,
  libraryTitleValidator,
  releaseValidator,
  scheduleKey,
} from './calendarTypes';

const monthArgs = { month: v.string(), region: v.string() };
const catalogValidator = v.object({ version: v.string(), refreshedAt: v.number() });
const savedValidator = v.object({ events: v.array(releaseValidator), refreshedAt: v.number() });

export const metadata = internalQuery({
  args: monthArgs,
  returns: v.union(v.null(), catalogValidator),
  handler: async (ctx, { month, region }) => {
    const row = await ctx.db
      .query('calendarMonths')
      .withIndex('by_region_month', (q) => q.eq('region', region).eq('month', month))
      .unique();
    return row?.version ? { version: row.version, refreshedAt: row.refreshedAt } : null;
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
      (row.refreshedAt > Date.now() - CALENDAR_TTL_MS || (row.leaseExpiresAt ?? 0) > Date.now())
    )
      return false;
    const lease = { leaseToken: token, leaseExpiresAt: Date.now() + 60_000 };
    if (row) await ctx.db.patch(row._id, lease);
    else
      await ctx.db.insert('calendarMonths', {
        month,
        region,
        candidates: [],
        version: '',
        refreshedAt: 0,
        ...lease,
      });
    return true;
  },
});

export const publish = internalMutation({
  args: { ...monthArgs, token: v.string(), candidates: v.optional(v.array(candidateValidator)) },
  returns: v.boolean(),
  handler: async (ctx, { month, region, token, candidates }) => {
    const row = await ctx.db
      .query('calendarMonths')
      .withIndex('by_region_month', (q) => q.eq('region', region).eq('month', month))
      .unique();
    if (!row || row.leaseToken !== token) return false;
    // Keep the last complete catalog on errors. Never publish a partial discovery page.
    if (candidates && new TextEncoder().encode(JSON.stringify(candidates)).length > 700 * 1024)
      throw new Error('The release catalog exceeds the storage limit');
    await ctx.db.patch(row._id, {
      leaseToken: undefined,
      leaseExpiresAt: undefined,
      ...(candidates ? { candidates, version: token, refreshedAt: Date.now() } : {}),
    });
    return true;
  },
});

/** The month index selects candidates first; only point lookups touch the user's library. */
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
    emptyLibrary: v.boolean(),
    nextMediaType: v.union(v.literal('movie'), v.null()),
    nextOffset: v.union(v.null(), v.number()),
    titles: v.array(
      v.object({ item: libraryTitleValidator, saved: v.union(v.null(), savedValidator) }),
    ),
  }),
  handler: async (ctx, { month, region, mediaType, userId, offset, version }) => {
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Invalid calendar cursor');
    const [hasType, hasMovies] = await Promise.all([
      ctx.db
        .query('items')
        .withIndex('by_user_tmdb', (q) => q.eq('userId', userId).eq('mediaType', mediaType))
        .first(),
      mediaType === 'tv'
        ? ctx.db
            .query('items')
            .withIndex('by_user_tmdb', (q) => q.eq('userId', userId).eq('mediaType', 'movie'))
            .first()
        : null,
    ]);
    const nextMediaType = hasMovies ? ('movie' as const) : null;
    if (!hasType)
      return { catalog: null, nextOffset: null, titles: [], emptyLibrary: true, nextMediaType };
    const catalog = await ctx.db
      .query('calendarMonths')
      .withIndex('by_region_month', (q) =>
        q.eq('region', catalogRegion(region, mediaType)).eq('month', month),
      )
      .unique();
    if (!catalog?.version)
      return { catalog: null, nextOffset: null, titles: [], emptyLibrary: false, nextMediaType };
    if (version && version !== catalog.version)
      throw new Error('Release dates changed. Please retry the calendar.');
    if (offset > catalog.candidates.length) throw new Error('Invalid calendar cursor');
    // Bounded work independent of library size, with pagination for any number of candidates.
    const candidates = catalog.candidates.slice(offset, offset + 1500);
    const matches = await Promise.all(
      candidates.map(async (candidate) => {
        const item = await ctx.db
          .query('items')
          .withIndex('by_user_tmdb', (q) =>
            q
              .eq('userId', userId)
              .eq('mediaType', candidate.mediaType)
              .eq('tmdbId', candidate.tmdbId),
          )
          .unique();
        if (!item || item.deletingAt !== undefined || item.status === 'dropped') return null;
        const saved = await ctx.db
          .query('calendarSchedules')
          .withIndex('by_key', (q) => q.eq('key', scheduleKey(month, region, item)))
          .unique();
        return {
          item: {
            ...candidate,
            title: item.title,
            status: item.status,
            ...(item.posterPath && { posterPath: item.posterPath }),
            ...(item.releaseDate && { releaseDate: item.releaseDate }),
          },
          saved: saved ? { events: saved.events, refreshedAt: saved.refreshedAt } : null,
        };
      }),
    );
    const next = offset + candidates.length;
    return {
      emptyLibrary: false,
      nextMediaType,
      catalog: { version: catalog.version, refreshedAt: catalog.refreshedAt },
      nextOffset: next < catalog.candidates.length ? next : null,
      titles: matches.filter((match): match is NonNullable<typeof match> => match !== null),
    };
  },
});

export const saveSchedules = internalMutation({
  args: {
    entries: v.array(v.object({ key: v.string(), month: v.string(), ...savedValidator.fields })),
  },
  returns: v.null(),
  handler: async (ctx, { entries }) => {
    if (entries.length > 20) throw new Error('Calendar schedule batch is too large');
    for (const entry of entries) {
      const old = await ctx.db
        .query('calendarSchedules')
        .withIndex('by_key', (q) => q.eq('key', entry.key))
        .unique();
      // An older in-flight reader must not overwrite a newer provider refresh.
      if (old && old.refreshedAt > entry.refreshedAt) continue;
      if (old) await ctx.db.patch(old._id, entry);
      else await ctx.db.insert('calendarSchedules', entry);
    }
    return null;
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
    for (const row of [...months, ...schedules]) await ctx.db.delete(row._id);
    if (months.length === 5 || schedules.length === 5)
      await ctx.scheduler.runAfter(0, internal.calendarCatalog.prune, {});
    return null;
  },
});
