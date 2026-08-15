import { v } from 'convex/values';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { internalAction, internalMutation, internalQuery } from './_generated/server';
import {
  mediaType,
  mergeEpisodes,
  mergeTitle,
  SEASON_FRESH_MS,
  type ProviderAnime,
  type ProviderTitle,
} from './resolvedMetadataShared.impl';
import { type ResolvedEpisode } from './seasonStorage';
import { tvdbAnimeGuideKey, tvdbAnimeLookupKey } from './tvdbGuideKeys';

export const listSeedItems = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query('items').paginate({ cursor: cursor ?? null, numItems: 100 });
    const seen = new Set<string>();
    return {
      ...page,
      page: page.page.filter((item) => {
        const key = `${item.mediaType}:${item.tmdbId}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    };
  },
});

export const setTitleMapping = internalMutation({
  args: {
    mediaType,
    tmdbId: v.number(),
    tvdbId: v.optional(v.number()),
    seasonOrder: v.optional(v.string()),
    source: v.union(v.literal('auto'), v.literal('manual')),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', args.mediaType).eq('tmdbId', args.tmdbId))
      .unique();
    if (existing?.source === 'manual' && args.source === 'auto') return existing;
    const changed =
      !existing || existing.tvdbId !== args.tvdbId || existing.seasonOrder !== args.seasonOrder;
    const value = {
      ...args,
      orderEpoch: existing ? existing.orderEpoch + (changed ? 1 : 0) : 0,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.replace(existing._id, value);
    else await ctx.db.insert('titleMappings', value);
    if (args.mediaType === 'tv')
      await ctx.scheduler.runAfter(0, internal.nextEpisode.refreshForTitle, {
        tmdbId: args.tmdbId,
      });
    return value;
  },
});

export const seedFromProviderSnapshots = internalAction({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, { cursor }): Promise<{ found: number; seeded: number; isDone: boolean }> => {
    const page: { page: Doc<'items'>[]; continueCursor: string; isDone: boolean } =
      await ctx.runQuery(internal.resolvedMetadata.listSeedItems, { cursor });
    const items = page.page;
    const readProviderSnapshot = internal.providerSnapshots.get;
    let seeded = 0;
    for (const item of items) {
      const existing = await ctx.runQuery(internal.resolvedMetadata.readTitle, {
        mediaType: item.mediaType,
        tmdbId: item.tmdbId,
      });
      if (existing) continue;
      const existingMapping = await ctx.runQuery(internal.resolvedMetadata.readTitleMapping, {
        mediaType: item.mediaType,
        tmdbId: item.tmdbId,
      });
      const lookup =
        item.mediaType === 'tv' && item.isAnime
          ? await ctx.runQuery(readProviderSnapshot, {
              key: tvdbAnimeLookupKey(item.tmdbId),
            })
          : null;
      const lookupValue = lookup?.value as { tvdbId?: unknown; order?: unknown } | undefined;
      const mapping =
        existingMapping ??
        (await ctx.runMutation(internal.resolvedMetadata.setTitleMapping, {
          mediaType: item.mediaType,
          tmdbId: item.tmdbId,
          ...(typeof lookupValue?.tvdbId === 'number' && { tvdbId: lookupValue.tvdbId }),
          ...(typeof lookupValue?.order === 'string' && { seasonOrder: lookupValue.order }),
          source: 'auto',
        }));
      const tmdbKey =
        item.mediaType === 'movie' ? `tmdb:movie:${item.tmdbId}` : `tmdb:tv:full:${item.tmdbId}`;
      const tmdbSnapshot = await ctx.runQuery(readProviderSnapshot, { key: tmdbKey });
      let animeSnapshot = null;
      if (item.mediaType === 'tv' && item.isAnime) {
        const identityKey =
          mapping?.tvdbId && mapping.seasonOrder
            ? tvdbAnimeGuideKey(item.tmdbId, mapping.tvdbId, mapping.seasonOrder)
            : typeof lookupValue?.tvdbId === 'number' && typeof lookupValue.order === 'string'
              ? tvdbAnimeGuideKey(item.tmdbId, lookupValue.tvdbId, lookupValue.order)
              : undefined;
        for (const key of [
          ...(identityKey ? [identityKey] : []),
          `tvdb:anime:v4:${item.tmdbId}`,
          `tvdb:anime:v2:${item.tmdbId}`,
          `tvdb:anime:${item.tmdbId}`,
        ]) {
          const candidate = await ctx.runQuery(readProviderSnapshot, { key });
          if (candidate?.value) {
            animeSnapshot = candidate;
            break;
          }
        }
      }
      const base = (tmdbSnapshot?.value ?? {
        title: item.title,
        posterPath: item.posterPath,
        overview: item.overview,
        releaseDate: item.releaseDate,
        runtime: item.runtime,
        genres: item.genres ?? [],
        cast: [],
        seasons: [],
        episodeRunTime: item.runtime ? [item.runtime] : [],
      }) as ProviderTitle;
      const anime = (animeSnapshot?.value ?? null) as ProviderAnime | null;
      const seasons = anime?.seasons.length ? anime.seasons : (base.seasons ?? []);
      const selectedSeason =
        anime?.selectedSeason ?? seasons.find((entry) => entry.season > 0)?.season;
      const seasonSnapshot =
        selectedSeason === undefined
          ? null
          : await ctx.runQuery(readProviderSnapshot, {
              key: `tmdb:season:${item.tmdbId}:${selectedSeason}`,
            });
      const complete = !!tmdbSnapshot && (item.mediaType === 'movie' || !item.isAnime || !!anime);
      const refreshedAt = complete
        ? Math.min(tmdbSnapshot.refreshedAt, animeSnapshot?.refreshedAt ?? tmdbSnapshot.refreshedAt)
        : 0;
      const value = {
        ...mergeTitle(item.tmdbId, item.mediaType, base, anime, refreshedAt),
        orderEpoch: mapping.orderEpoch,
      };
      await ctx.runMutation(internal.resolvedMetadata.putTitle, { value });
      const selectedEpisodes = (anime?.selectedEpisodes ??
        seasonSnapshot?.value ??
        []) as ResolvedEpisode[];
      if (selectedSeason !== undefined && selectedEpisodes.length)
        await ctx.runMutation(internal.resolvedMetadata.putSeason, {
          tmdbId: item.tmdbId,
          season: selectedSeason,
          metadataProvider: value.metadataProvider,
          episodes: mergeEpisodes(selectedEpisodes, []),
          refreshedAt,
          refreshAfter: refreshedAt + SEASON_FRESH_MS,
          orderEpoch: mapping.orderEpoch,
        });
      seeded += 1;
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(0, internal.resolvedMetadata.seedFromProviderSnapshots, {
        cursor: page.continueCursor,
      });
    return { found: items.length, seeded, isDone: page.isDone };
  },
});
