import type { SearchResult } from '@/types';

export type MediaType = 'movie' | 'tv';
export type TitleRouteParams = {
  mediaType?: string;
  tmdbId?: string;
  preview?: string;
};

export function parseTitleRoute(params: TitleRouteParams) {
  const mediaType: MediaType | undefined =
    params.mediaType === 'movie' || params.mediaType === 'tv' ? params.mediaType : undefined;
  const rawTmdbId = params.tmdbId ?? '';
  const tmdbId = Number(rawTmdbId);
  const validId = rawTmdbId.trim() !== '' && Number.isInteger(tmdbId) && tmdbId >= 1;
  return {
    mediaType,
    tmdbId,
    validId,
    routeKey: `${mediaType ?? 'invalid'}:${validId ? tmdbId : 'invalid'}`,
  };
}

export function parseTitlePreview(value?: string): SearchResult | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<SearchResult>;
    if (
      typeof parsed.id !== 'number' ||
      typeof parsed.title !== 'string' ||
      !parsed.title.trim() ||
      (parsed.mediaType !== 'movie' && parsed.mediaType !== 'tv') ||
      (parsed.posterPath !== undefined &&
        (typeof parsed.posterPath !== 'string' ||
          !/^\/(?!\/)[A-Za-z0-9._/-]+$/u.test(parsed.posterPath) ||
          parsed.posterPath.split('/').includes('..'))) ||
      (parsed.overview !== undefined && typeof parsed.overview !== 'string') ||
      (parsed.releaseDate !== undefined && typeof parsed.releaseDate !== 'string')
    ) {
      return undefined;
    }
    return parsed as SearchResult;
  } catch {
    return undefined;
  }
}
