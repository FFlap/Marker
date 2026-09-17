import type { Doc } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { activeResolvedTitle } from './resolvedTitleModel';

/** Provider counts can be unknown (zero); only complete canonical data proves emptiness. */
export async function visibleResolvedTitle(
  ctx: QueryCtx,
  identity: Pick<Doc<'items'>, 'mediaType' | 'tmdbId'>,
) {
  const title = await activeResolvedTitle(ctx, identity);
  if (!title || title.mediaType !== 'tv') return title;
  const seasons = await Promise.all(
    title.seasons.map(async (entry) => {
      const resolved = await ctx.db
        .query('resolvedSeasons')
        .withIndex('by_tmdb_season', (q) => q.eq('tmdbId', title.tmdbId).eq('season', entry.season))
        .unique();
      return resolved?.chunksComplete === true &&
        resolved.orderEpoch === title.orderEpoch &&
        resolved.episodeCount === 0
        ? []
        : [entry];
    }),
  );
  return { ...title, seasons: seasons.flat() };
}
