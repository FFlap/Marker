import { v } from 'convex/values';
import { internal } from '../_generated/api';
import { internalAction, internalMutation } from '../_generated/server';
import { resolvedSeasonValidator } from '../publicValidators';
import { TITLE_FRESH_MS } from './shared';

export const nextReleaseBoundary = (now = Date.now()) =>
  Math.floor(now / 86_400_000) * 86_400_000 + 86_400_000;

/** Fill season summaries from the shared episode catalog after title publication. */
export const refresh = internalAction({
  args: {
    tmdbId: v.number(),
    refreshedAt: v.number(),
    forceCatalog: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<void> => {
    const current = await ctx.runQuery(internal.resolvedMetadata.reads.readTitle, {
      mediaType: 'tv',
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
    try {
      const seasons = await ctx.runAction(internal.tvdb.loadSeasonSummaries, {
        tmdbId: current.tmdbId,
        title: current.title,
        tvdbId: current.tvdbId,
        order: current.seasonOrder,
        seasons: current.seasons,
        forceCatalog: args.forceCatalog ?? false,
      });
      await ctx.runMutation(internal.resolvedMetadata.seasonSummaries.publish, {
        tmdbId: current.tmdbId,
        tvdbId: current.tvdbId,
        seasonOrder: current.seasonOrder,
        orderEpoch: current.orderEpoch,
        refreshedAt: current.refreshedAt,
        seasons,
      });
    } catch (error) {
      // Leave the title's short freshness deadline intact so a later touch retries.
      console.warn('[season-summary-refresh-failed]', args.tmdbId, error);
    }
  },
});

export const publish = internalMutation({
  args: {
    tmdbId: v.number(),
    tvdbId: v.number(),
    seasonOrder: v.string(),
    orderEpoch: v.number(),
    refreshedAt: v.number(),
    seasons: v.array(resolvedSeasonValidator),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const mapping = await ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', 'tv').eq('tmdbId', args.tmdbId))
      .unique();
    const current = await ctx.db
      .query('resolvedTitles')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', 'tv').eq('tmdbId', args.tmdbId))
      .unique();
    if (
      !current ||
      current.refreshedAt !== args.refreshedAt ||
      current.orderEpoch !== args.orderEpoch ||
      current.tvdbId !== args.tvdbId ||
      current.seasonOrder !== args.seasonOrder ||
      (mapping &&
        (mapping.orderEpoch !== args.orderEpoch ||
          mapping.tvdbId !== args.tvdbId ||
          mapping.seasonOrder !== args.seasonOrder))
    )
      return false;
    // Episode publication can finish while translations are in flight.
    const latestSeasons = new Map(current.seasons.map((entry) => [entry.season, entry]));
    await ctx.db.patch(current._id, {
      seasons: args.seasons.map((entry) => {
        const latest = latestSeasons.get(entry.season);
        return latest?.episodeCountVerified
          ? { ...entry, episodeCount: latest.episodeCount, episodeCountVerified: true }
          : entry;
      }),
      refreshAfter: Math.min(Date.now() + TITLE_FRESH_MS, nextReleaseBoundary()),
    });
    await ctx.scheduler.runAfter(0, internal.resolvedMetadata.publication.refreshItemProjections, {
      mediaType: 'tv',
      tmdbId: args.tmdbId,
    });
    return true;
  },
});
