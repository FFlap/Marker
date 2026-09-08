import { boundedEpisode } from './seasonStorage';

export type Json = Record<string, unknown>;
export type SeasonOrder =
  'default' | 'official' | 'dvd' | 'absolute' | 'alternate' | 'alttwo' | 'regional';
export type AnimeEpisode = {
  id: number;
  providerEpisodeId?: number;
  season: number;
  episode: number;
  name: string;
  overview?: string;
  runtime?: number;
  imageUrl?: string;
  airDate?: string;
};
export type SeasonRecord = {
  id: number;
  number: number;
  name: string;
  translatedName?: string;
  type: SeasonOrder;
  typeId?: number;
  episodeCount?: number;
};
export type AnimeDetails = {
  tvdbId: number;
  title: string;
  firstAirDate?: string;
  episodeRunTime: number[];
  genres: string[];
  order: SeasonOrder;
  seasons: { season: number; name: string; episodeCount: number }[];
  selectedSeason?: number;
  selectedEpisodes?: AnimeEpisode[];
};
export type AnimeResolution = { details: AnimeDetails; episodes?: AnimeEpisode[] };

const MAX_SEASON_TRANSLATIONS = 64;
export const validOrders = new Set<SeasonOrder>([
  'default',
  'official',
  'dvd',
  'absolute',
  'alternate',
  'alttwo',
  'regional',
]);
export const records = (value: unknown): Json[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is Json => typeof entry === 'object' && entry !== null)
    : [];
export const record = (value: unknown): Json =>
  typeof value === 'object' && value !== null ? (value as Json) : {};
export const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
export const integer = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) ? value : undefined;
export const normalize = (value: string) =>
  value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/\p{P}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
export const imageUrl = (value: unknown) => {
  const path = text(value);
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  return `https://artworks.thetvdb.com/banners/${path.replace(/^\/?banners\//, '').replace(/^\//, '')}`;
};

export const boundedAnimeEpisode = (episode: AnimeEpisode): AnimeEpisode => ({
  id: episode.id,
  ...boundedEpisode({ ...episode, providerEpisodeId: episode.providerEpisodeId ?? episode.id }),
});

export function mapEpisode(payload: Json): AnimeEpisode | undefined {
  const id = integer(payload.id);
  const season = integer(payload.seasonNumber);
  const episode = integer(payload.number);
  if (id === undefined || season === undefined || episode === undefined) return undefined;
  return {
    id,
    season,
    episode,
    name: text(payload.name) || `Episode ${episode}`,
    ...(text(payload.overview) && { overview: text(payload.overview) }),
    ...(integer(payload.runtime) !== undefined && { runtime: integer(payload.runtime) }),
    ...(imageUrl(payload.image) && { imageUrl: imageUrl(payload.image) }),
    ...(text(payload.aired) && { airDate: text(payload.aired) }),
  };
}

export const episodesForSeason = (episodes: AnimeEpisode[], season?: number) =>
  season === undefined ? episodes : episodes.filter((episode) => episode.season === season);

export const mapSeason = (value: Json): SeasonRecord | undefined => {
  const id = integer(value.id);
  const number = integer(value.number);
  const typeRecord = record(value.type);
  const type = text(typeRecord.type).toLocaleLowerCase() as SeasonOrder;
  if (id === undefined || number === undefined || !validOrders.has(type)) return undefined;
  const translatedName = records(value.translations)
    .map((translation) => ({
      language: normalize(text(translation.language) || text(translation.languageCode)),
      name: text(translation.name),
    }))
    .find(
      (translation) =>
        (translation.language === 'eng' || translation.language === 'english') && translation.name,
    )?.name;
  return {
    id,
    number,
    name: text(value.name),
    ...(translatedName && { translatedName }),
    type,
    typeId: integer(typeRecord.id),
    episodeCount:
      integer(value.episodeCount) ??
      (records(value.episodes).length > 0 ? records(value.episodes).length : undefined),
  };
};

export function selectSeasonOrder(
  seasons: SeasonRecord[],
  defaultSeasonType?: number,
): SeasonOrder {
  if (seasons.some((season) => season.type === 'official')) return 'official';
  const preferred = seasons.find((season) => season.typeId === defaultSeasonType)?.type;
  return preferred && validOrders.has(preferred) ? preferred : 'default';
}

export const seriesId = (entry: Json) => {
  const direct = Number(text(entry.tvdb_id));
  if (Number.isInteger(direct) && direct > 0) return direct;
  const parsed = Number(text(entry.id).match(/(\d+)$/)?.[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};
export const authoritativeNames = (title: string, originalTitle?: string) => [
  ...new Set([title, originalTitle].filter((value): value is string => !!value?.trim())),
];
export const normalizedNames = (titles: string[]) => [
  ...new Set(titles.map(normalize).filter(Boolean)),
];
export const seasonTranslationLimit = (seasonCount: number) =>
  Math.max(0, Math.min(MAX_SEASON_TRANSLATIONS, seasonCount));
export const titleMatches = (entry: Json, titles: string[]) => {
  const targets = new Set(normalizedNames(titles));
  const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
  return [entry.name, entry.name_translated, entry.title, ...aliases]
    .map((value) => (typeof value === 'string' ? value : text(record(value).name)))
    .some((value) => targets.has(normalize(value)));
};
const tmdbRemoteSources = new Set(['tmdb', 'the movie database', 'themoviedb', 'themoviedb com']);

// Search relevance can put a spinoff first whose aliases include the parent title.
// Provider identity outranks names; primary/translatable names outrank aliases.
export function selectSeriesMatch(entries: Json[], tmdbId: number, titles: string[]) {
  const targets = new Set(normalizedNames(titles));
  const ranked = entries
    .flatMap((entry) => {
      if (text(entry.type) !== 'series' || !seriesId(entry)) return [];
      const tmdbIds = records(entry.remote_ids).filter((remote) =>
        tmdbRemoteSources.has(normalize(text(remote.sourceName))),
      );
      const verified = tmdbIds.some((remote) => String(remote.id) === String(tmdbId));
      if (tmdbIds.length && !verified) return [];
      const primaryMatch = [
        entry.name,
        entry.name_translated,
        entry.title,
        ...Object.values(record(entry.translations)),
      ].some((name) => typeof name === 'string' && targets.has(normalize(name)));
      const score = verified ? 3 : primaryMatch ? 2 : titleMatches(entry, titles) ? 1 : 0;
      return score ? [{ entry, score }] : [];
    })
    .sort((left, right) => right.score - left.score);
  if (
    !ranked.length ||
    (ranked[1]?.score === ranked[0].score &&
      seriesId(ranked[1].entry) !== seriesId(ranked[0].entry))
  )
    return undefined;
  return ranked[0].entry;
}
const remoteIdSource = (entry: Json) => {
  const remote = record(entry.remote_id ?? entry.remoteId);
  return normalize(
    text(entry.sourceName) ||
      text(entry.source) ||
      text(entry.provider) ||
      text(remote.sourceName) ||
      text(remote.source) ||
      text(remote.provider),
  );
};
export const verifiedTmdbRemoteSeries = (entry: Json, titles: string[]) => {
  if (!tmdbRemoteSources.has(remoteIdSource(entry))) return undefined;
  const series = record(entry.series);
  if (!titleMatches(series, titles) && !titleMatches(entry, titles)) return undefined;
  return integer(entry.seriesId) ?? integer(series.id);
};

export function seasonDisplayName(seasonNumber: number, rawName: string, translatedName?: string) {
  if (seasonNumber === 0) return 'Specials';
  const translated = translatedName?.trim();
  if (translated && !/^season\s+\d+$/i.test(translated)) return translated;
  if (translated) return `Season ${seasonNumber}`;
  const raw = rawName.trim();
  return raw && !/^season\s+\d+$/i.test(raw) ? raw : `Season ${seasonNumber}`;
}
export const knownAnimeSeasonName = (titles: string[], season: number) => {
  const normalized = normalizedNames(titles);
  if (
    season === 2 &&
    normalized.some(
      (title) =>
        title === 'kaguya sama love is war' ||
        title === 'kaguya sama wa kokurasetai tensai tachi no renai zunousen',
    )
  ) {
    return 'Kaguya-sama: Love Is War?';
  }
  return undefined;
};

export const validateOrder = (value: string): SeasonOrder => {
  if (!validOrders.has(value as SeasonOrder)) throw new Error('Unsupported TVDB season order');
  return value as SeasonOrder;
};
