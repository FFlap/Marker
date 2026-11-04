import type { Doc } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { activeResolvedTitle } from './resolvedTitleModel';

export async function visibleResolvedTitle(
  ctx: QueryCtx,
  identity: Pick<Doc<'items'>, 'mediaType' | 'tmdbId'>,
) {
  const title = await activeResolvedTitle(ctx, identity);
  if (!title || title.mediaType !== 'tv' || title.seasons.length === 0) return title;
  const numbers = title.seasons.map((entry) => entry.season);
  const first = Math.min(...numbers);
  const last = Math.max(...numbers);
  // Dense guides use one bounded index scan instead of one index query per season.
  // Sparse/custom orders keep exact lookups, avoiding a scan of unrelated seasons.
  const dense = last - first < 100 && last - first + 1 <= numbers.length * 2;
  const parents = dense
    ? await ctx.db
        .query('resolvedSeasons')
        .withIndex('by_tmdb_season', (q) =>
          q.eq('tmdbId', title.tmdbId).gte('season', first).lte('season', last),
        )
        .collect()
    : undefined;
  const bySeason = new Map<number, Doc<'resolvedSeasons'>>();
  for (const parent of parents ?? []) {
    if (bySeason.has(parent.season)) throw new Error('Duplicate canonical season');
    bySeason.set(parent.season, parent);
  }
  const seasons = await Promise.all(
    title.seasons.map(async (entry) => {
      const resolved = parents
        ? bySeason.get(entry.season)
        : await ctx.db
            .query('resolvedSeasons')
            .withIndex('by_tmdb_season', (q) =>
              q.eq('tmdbId', title.tmdbId).eq('season', entry.season),
            )
            .unique();
      if (
        resolved?.chunksComplete === true &&
        resolved.orderEpoch === title.orderEpoch &&
        resolved.episodeCount !== undefined &&
        (resolved.refreshedAt >= title.refreshedAt ||
          (entry.episodeCountVerified === false && resolved.episodeCount > 0))
      ) {
        return resolved.episodeCount === 0
          ? []
          : [{ ...entry, episodeCount: resolved.episodeCount, episodeCountVerified: true }];
      }
      return entry.episodeCountVerified === false || entry.episodeCount > 0 ? [entry] : [];
    }),
  );
  return { ...title, seasons: seasons.flat() };
}
