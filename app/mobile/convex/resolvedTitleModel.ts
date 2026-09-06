import type { Doc } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';

type MediaIdentity = Pick<Doc<'items'>, 'mediaType' | 'tmdbId'>;
type ResolvedTitle = Doc<'resolvedTitles'>;

export const mediaIdentityKey = ({ mediaType, tmdbId }: MediaIdentity) => `${mediaType}:${tmdbId}`;

export async function activeResolvedTitle(ctx: QueryCtx, item: MediaIdentity) {
  const [title, mapping] = await Promise.all([
    ctx.db
      .query('resolvedTitles')
      .withIndex('by_tmdb', (query) =>
        query.eq('mediaType', item.mediaType).eq('tmdbId', item.tmdbId),
      )
      .unique(),
    ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (query) =>
        query.eq('mediaType', item.mediaType).eq('tmdbId', item.tmdbId),
      )
      .unique(),
  ]);
  return title && (mapping?.orderEpoch === undefined || title.orderEpoch === mapping.orderEpoch)
    ? title
    : null;
}

export async function activeResolvedTitles(
  ctx: QueryCtx,
  items: readonly MediaIdentity[],
): Promise<Map<string, ResolvedTitle | null>> {
  const uniqueItems = new Map(items.map((item) => [mediaIdentityKey(item), item]));
  return new Map(
    await Promise.all(
      [...uniqueItems.entries()].map(
        async ([key, item]) => [key, await activeResolvedTitle(ctx, item)] as const,
      ),
    ),
  );
}

export function resolvedItemRuntime(
  item: Pick<Doc<'items'>, 'runtime'>,
  title: ResolvedTitle | null | undefined,
) {
  return (
    title?.runtime ??
    (title?.episodeRunTime.length
      ? title.episodeRunTime.reduce((sum, runtime) => sum + runtime, 0) /
        title.episodeRunTime.length
      : item.runtime)
  );
}

export function hydrateLibraryItem(
  item: Doc<'items'>,
  title: ResolvedTitle | null | undefined,
): Doc<'items'> {
  if (!title) return item;
  return {
    ...item,
    title: title.title,
    normalizedTitle: title.title.toLocaleLowerCase(),
    posterPath: title.posterPath,
    overview: title.overview,
    releaseDate: title.releaseDate ?? title.firstAirDate,
    runtime: resolvedItemRuntime(item, title),
    genres: title.genres,
    isAnime: title.genres.some((genre) => genre.toLocaleLowerCase() === 'anime'),
  };
}
