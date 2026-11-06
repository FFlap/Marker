import { v } from 'convex/values';
import { internal } from '../_generated/api';
import { internalAction, internalMutation } from '../_generated/server';
import { mediaType, resolvedTitleValidator, TITLE_FRESH_MS } from './shared';
import { refreshLeaseKey } from './requests';

export const nextReleaseBoundary = (now = Date.now()) =>
  Math.floor(now / 86_400_000) * 86_400_000 + 86_400_000;

/** Complete season counts and names without holding up interactive episode loads. */
export const enrichTitle = internalAction({
  args: {
    mediaType,
    tmdbId: v.number(),
    refreshedAt: v.number(),
    retry: v.optional(v.number()),
    forceCatalog: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<void> => {
    const current = await ctx.runQuery(internal.resolvedMetadata.reads.readTitle, {
      mediaType: args.mediaType,
      tmdbId: args.tmdbId,
    });
    if (
      !current ||
      current.refreshedAt !== args.refreshedAt ||
      current.metadataProvider !== 'tvdb' ||
      !current.tvdbId ||
      !current.seasonOrder
    )
      return;
    const key = `enrichment:${refreshLeaseKey(args.mediaType, args.tmdbId)}`;
    const token = `enrichment:${crypto.randomUUID()}`;
    if (
      !(await ctx.runMutation(internal.resolvedMetadata.requests.claimRefresh, {
        key,
        token,
        leaseMs: 120_000,
      }))
    ) {
      if ((args.retry ?? 0) < 60)
        await ctx.scheduler.runAfter(1_000, internal.resolvedMetadata.enrichment.enrichTitle, {
          ...args,
          retry: (args.retry ?? 0) + 1,
        });
      return;
    }
    try {
      const extras = await ctx.runAction(internal.tvdb.refreshTitleExtras, {
        tmdbId: current.tmdbId,
        title: current.title,
        tvdbId: current.tvdbId,
        order: current.seasonOrder,
        metadataOnly: false,
        force: true,
        forceCatalog: args.forceCatalog ?? false,
      });
      const guide = extras.anime;
      if (!guide || guide.tvdbId !== current.tvdbId || guide.order !== current.seasonOrder) return;
      const seasons = guide.seasons;
      const { _id, _creationTime, ...title } = current;
      void _id;
      void _creationTime;
      await ctx.runMutation(internal.resolvedMetadata.enrichment.publishEnrichment, {
        title: {
          ...title,
          seasons,
          refreshAfter: seasons.some((s) => s.episodeCountVerified === false)
            ? title.refreshAfter
            : Math.min(
                Date.now() + TITLE_FRESH_MS,
                title.mediaType === 'tv' ? nextReleaseBoundary() : Infinity,
              ),
        },
        key,
        token,
      });
    } catch (error) {
      console.warn('[title-enrichment-failed]', args.tmdbId, error);
    } finally {
      await ctx.runMutation(internal.resolvedMetadata.requests.releaseRefresh, { key, token });
    }
  },
});

export const publishEnrichment = internalMutation({
  args: { title: resolvedTitleValidator, key: v.string(), token: v.string() },
  handler: async (ctx, { title, key, token }): Promise<boolean> => {
    const lease = await ctx.db
      .query('metadataRefreshLeases')
      .withIndex('by_key', (q) => q.eq('key', key))
      .unique();
    const mapping = await ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', title.mediaType).eq('tmdbId', title.tmdbId))
      .unique();
    const current = await ctx.db
      .query('resolvedTitles')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', title.mediaType).eq('tmdbId', title.tmdbId))
      .unique();
    if (
      !lease ||
      lease.token !== token ||
      lease.expiresAt <= Date.now() ||
      !current ||
      current.refreshedAt !== title.refreshedAt ||
      current.orderEpoch !== title.orderEpoch ||
      (mapping &&
        (mapping.orderEpoch !== title.orderEpoch ||
          mapping.tvdbId !== title.tvdbId ||
          mapping.seasonOrder !== title.seasonOrder))
    )
      return false;
    // Season publication can proceed while optional provider work is in flight.
    // Keep its verified counts and patch only the fields owned by enrichment.
    const latestSeasons = new Map(current.seasons.map((entry) => [entry.season, entry]));
    await ctx.db.patch(current._id, {
      seasons: title.seasons.map((entry) => {
        const latest = latestSeasons.get(entry.season);
        return latest?.episodeCountVerified
          ? { ...entry, episodeCount: latest.episodeCount, episodeCountVerified: true }
          : entry;
      }),
      refreshAfter: title.refreshAfter,
    });
    await ctx.scheduler.runAfter(0, internal.resolvedMetadata.publication.refreshItemProjections, {
      mediaType: title.mediaType,
      tmdbId: title.tmdbId,
    });
    return true;
  },
});
