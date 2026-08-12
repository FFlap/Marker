export const TVDB_ANIME_GUIDE_VERSION = 'v7';

export const tvdbAnimeGuideKey = (tmdbId: number, tvdbId: number, order: string) =>
  `tvdb:anime:${TVDB_ANIME_GUIDE_VERSION}:${tmdbId}:${tvdbId}:${order}`;

export const tvdbAnimeLookupKey = (tmdbId: number) =>
  `tvdb:anime:${TVDB_ANIME_GUIDE_VERSION}:lookup:${tmdbId}`;
