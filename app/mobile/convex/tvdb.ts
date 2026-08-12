import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';
import { providerFetch } from './providerHttp';
import { isAnime } from './mergePolicy';
import { isTruncatedSnapshot, putNonFatal, SNAPSHOT_TTL_MS } from './providerSnapshots';
import { boundedEpisode, MAX_SEASON_EPISODES } from './seasonStorage';
import { tvdbAnimeGuideKey, tvdbAnimeLookupKey } from './tvdbGuideKeys';

type Json = Record<string, unknown>;
type SeasonOrder =
  'default' | 'official' | 'dvd' | 'absolute' | 'alternate' | 'alttwo' | 'regional';

const API_ROOT = 'https://api4.thetvdb.com/v4';
const GUIDE_SNAPSHOT_MS = SNAPSHOT_TTL_MS;
const SEASON_SNAPSHOT_MS = SNAPSHOT_TTL_MS;
const MAX_EPISODE_PAGES = 5;
const EPISODE_FETCH_DEADLINE_MS = 20_000;
const MAX_SEASON_TRANSLATIONS = 64;
const validOrders = new Set<SeasonOrder>([
  'default',
  'official',
  'dvd',
  'absolute',
  'alternate',
  'alttwo',
  'regional',
]);
const records = (value: unknown): Json[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is Json => typeof entry === 'object' && entry !== null)
    : [];
const record = (value: unknown): Json =>
  typeof value === 'object' && value !== null ? (value as Json) : {};
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const integer = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) ? value : undefined;
const normalize = (value: string) =>
  value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/\p{P}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
const imageUrl = (value: unknown) => {
  const path = text(value);
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  return `https://artworks.thetvdb.com/banners/${path.replace(/^\/?banners\//, '').replace(/^\//, '')}`;
};

let credentials: { token: string; expiresAt: number } | undefined;

async function login(ctx: { runMutation: Function }) {
  const apikey = process.env.TVDB_API_KEY;
  if (!apikey) throw new Error('TVDB_API_KEY is not configured');
  if (credentials && credentials.expiresAt > Date.now() + 60_000) return credentials.token;
  const response = await providerFetch(
    `${API_ROOT}/login`,
    {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ apikey }),
    },
    {
      provider: 'tvdb',
      operation: '/login',
      beforeRequest: () =>
        ctx.runMutation(internal.tmdb.consumeGlobalProviderLimiter, { provider: 'tvdb' }),
    },
  );
  if (!response.ok) throw new Error(`TVDB login failed (${response.status})`);
  const payload = record(await response.json());
  const token = text(record(payload.data).token);
  if (!token) throw new Error('TVDB login returned malformed data');
  credentials = { token, expiresAt: Date.now() + 29 * 24 * 60 * 60 * 1000 };
  return token;
}

async function request(
  ctx: { runMutation: Function },
  path: string,
  emptyOnNotFound = false,
  retryAuth = true,
): Promise<Json> {
  const response = await providerFetch(
    `${API_ROOT}${path}`,
    {
      headers: { Authorization: `Bearer ${await login(ctx)}`, accept: 'application/json' },
    },
    {
      provider: 'tvdb',
      operation: path.split('?')[0],
      beforeRequest: () =>
        ctx.runMutation(internal.tmdb.consumeGlobalProviderLimiter, { provider: 'tvdb' }),
    },
  );
  if (response.status === 401 && retryAuth) {
    credentials = undefined;
    return request(ctx, path, emptyOnNotFound, false);
  }
  if (response.status === 404 && emptyOnNotFound) return {};
  if (!response.ok) throw new Error(`TVDB request failed (${response.status})`);
  return record(await response.json());
}

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

const boundedAnimeEpisode = (episode: AnimeEpisode): AnimeEpisode => ({
  id: episode.id,
  ...boundedEpisode({
    ...episode,
    providerEpisodeId: episode.providerEpisodeId ?? episode.id,
  }),
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

export function episodesForSeason(episodes: AnimeEpisode[], season?: number) {
  return season === undefined ? episodes : episodes.filter((episode) => episode.season === season);
}

async function fetchEpisodes(
  ctx: { runMutation: Function },
  tvdbId: number,
  order: SeasonOrder,
  season?: number,
) {
  const episodes: AnimeEpisode[] = [];
  const seen = new Set<number>();
  let hasNextPage = false;
  const deadline = Date.now() + EPISODE_FETCH_DEADLINE_MS;
  for (let page = 0; page < MAX_EPISODE_PAGES; page += 1) {
    if (Date.now() >= deadline) throw new Error('TVDB episode pagination exceeded its deadline');
    const query = new URLSearchParams({ page: String(page) });
    if (season !== undefined) query.set('season', String(season));
    const payload = await request(
      ctx,
      `/series/${tvdbId}/episodes/${order}/eng?${query.toString()}`,
      true,
    );
    const mapped = records(record(payload.data).episodes).flatMap((entry) => {
      const episode = mapEpisode(entry);
      if (!episode || seen.has(episode.id)) return [];
      seen.add(episode.id);
      return [boundedAnimeEpisode(episode)];
    });
    episodes.push(...mapped.slice(0, MAX_SEASON_EPISODES - episodes.length));
    if (episodes.length >= MAX_SEASON_EPISODES) {
      hasNextPage = false;
      break;
    }
    const next = record(payload.links).next;
    hasNextPage = next !== null && next !== undefined && next !== '' && mapped.length > 0;
    if (!hasNextPage) break;
  }
  if (hasNextPage) throw new Error('TVDB episode pagination exceeded the safety limit');
  return episodesForSeason(episodes, season);
}

type SeasonRecord = {
  id: number;
  number: number;
  name: string;
  translatedName?: string;
  type: SeasonOrder;
  typeId?: number;
  episodeCount?: number;
};

const mapSeason = (value: Json): SeasonRecord | undefined => {
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
  if (preferred && validOrders.has(preferred)) return preferred;
  return 'default';
}

type AnimeDetails = {
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

type AnimeResolution = { details: AnimeDetails; episodes?: AnimeEpisode[] };

const seriesId = (entry: Json) => {
  const direct = Number(text(entry.tvdb_id));
  if (Number.isInteger(direct) && direct > 0) return direct;
  const suffix = text(entry.id).match(/(\d+)$/)?.[1];
  const parsed = Number(suffix);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const authoritativeNames = (title: string, originalTitle?: string) => [
  ...new Set([title, originalTitle].filter((value): value is string => !!value?.trim())),
];

const normalizedNames = (titles: string[]) => [
  ...new Set(titles.map(normalize).filter((value) => value.length > 0)),
];

export const seasonTranslationLimit = (seasonCount: number) =>
  Math.max(0, Math.min(MAX_SEASON_TRANSLATIONS, seasonCount));

const titleMatches = (entry: Json, titles: string[]) => {
  const targets = new Set(normalizedNames(titles));
  const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
  return [entry.name, entry.name_translated, entry.title, ...aliases]
    .map((value) => (typeof value === 'string' ? value : text(record(value).name)))
    .some((value) => targets.has(normalize(value)));
};

const tmdbRemoteSources = new Set(['tmdb', 'the movie database', 'themoviedb', 'themoviedb com']);

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

const verifiedTmdbRemoteSeries = (entry: Json, titles: string[]) => {
  if (!tmdbRemoteSources.has(remoteIdSource(entry))) return undefined;
  const series = record(entry.series);
  if (!titleMatches(series, titles) && !titleMatches(entry, titles)) return undefined;
  return integer(entry.seriesId) ?? integer(series.id);
};

async function findSeries(ctx: { runMutation: Function }, tmdbId: number, titles: string[]) {
  try {
    const remote = await request(
      ctx,
      `/search/remoteid/${encodeURIComponent(String(tmdbId))}`,
      true,
    );
    const remoteResults = records(remote.data);
    const remoteId = remoteResults
      .map((entry) => verifiedTmdbRemoteSeries(entry, titles))
      .find((id) => id !== undefined);
    if (remoteId) return remoteId;
  } catch {
    // Some numeric remote IDs are ambiguous across providers; title search verifies the fallback.
  }

  for (const title of titles) {
    const search = await request(
      ctx,
      `/search?query=${encodeURIComponent(title)}&type=series&limit=20`,
      true,
    );
    const matches = records(search.data).filter((entry) => text(entry.type) === 'series');
    const exact = matches.find((entry) => titleMatches(entry, titles));
    const id = seriesId(exact ?? {});
    if (id) return id;
  }
  return undefined;
}

export function seasonDisplayName(seasonNumber: number, rawName: string, translatedName?: string) {
  if (seasonNumber === 0) return 'Specials';
  const translated = translatedName?.trim();
  if (translated && !/^season\s+\d+$/i.test(translated)) return translated;
  if (translated) return `Season ${seasonNumber}`;
  const raw = rawName.trim();
  if (raw && !/^season\s+\d+$/i.test(raw)) return raw;
  return `Season ${seasonNumber}`;
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
  )
    return 'Kaguya-sama: Love Is War?';
  return undefined;
};

async function translatedSeasonName(
  ctx: { runMutation: Function },
  season: SeasonRecord,
  titles: string[],
) {
  if (season.number === 0) return 'Specials';
  const localName = seasonDisplayName(season.number, season.name, season.translatedName);
  const knownName = knownAnimeSeasonName(titles, season.number);
  if (knownName && (!season.translatedName || /^season\s+\d+$/i.test(season.translatedName)))
    return knownName;
  try {
    const payload = await request(ctx, `/seasons/${season.id}/translations/eng`, true);
    const translated = seasonDisplayName(
      season.number,
      season.name,
      text(record(payload.data).name),
    );
    return knownName && /^season\s+\d+$/i.test(translated) ? knownName : translated;
  } catch {
    return knownName && /^season\s+\d+$/i.test(localName) ? knownName : localName;
  }
}

async function translateSeasonNames(
  ctx: { runMutation: Function },
  seasons: SeasonRecord[],
  titles: string[],
) {
  const names = new Map<number, string>();
  let translationsRequested = 0;
  const translationLimit = seasonTranslationLimit(seasons.length);
  for (let start = 0; start < seasons.length; start += 6) {
    const batch = seasons.slice(start, start + 6).map((season) => {
      const translate = season.number > 0 && translationsRequested < translationLimit;
      if (translate) translationsRequested += 1;
      return { season, translate };
    });
    const translated = await Promise.all(
      batch.map(
        async ({ season, translate }) =>
          [
            season.number,
            translate
              ? await translatedSeasonName(ctx, season, titles)
              : seasonDisplayName(
                  season.number,
                  season.name,
                  season.translatedName ?? knownAnimeSeasonName(titles, season.number),
                ),
          ] as const,
      ),
    );
    for (const [number, name] of translated) names.set(number, name);
  }
  return names;
}

async function resolveAnime(
  ctx: { runMutation: Function },
  tmdbId: number,
  titles: string[],
  pinned?: { tvdbId?: number; order?: SeasonOrder },
  requestedSeason?: number,
): Promise<AnimeResolution | null> {
  const tvdbId = pinned?.tvdbId ?? (await findSeries(ctx, tmdbId, titles));
  if (!tvdbId) return null;
  const payload = await request(ctx, `/series/${tvdbId}/extended?meta=translations`);
  const data = record(payload.data);
  const genreNames = records(data.genres).flatMap((genre) => {
    const name = text(genre.name);
    return name ? [name] : [];
  });
  if (!isAnime(genreNames)) return null;
  const seasonRecords = records(data.seasons).flatMap((entry) => {
    const season = mapSeason(entry);
    return season ? [season] : [];
  });
  const order = pinned?.order ?? selectSeasonOrder(seasonRecords, integer(data.defaultSeasonType));
  const selectedSeasons = seasonRecords
    .filter((season) => season.type === order)
    .sort((left, right) => left.number - right.number);
  const names = await translateSeasonNames(ctx, selectedSeasons, titles);
  const selectedSeason = selectedSeasons.find((season) => season.number > 0)?.number;
  const selectedEpisodes =
    selectedSeason !== undefined &&
    (requestedSeason === undefined || requestedSeason === selectedSeason)
      ? (await fetchEpisodes(ctx, tvdbId, order, selectedSeason)).map(boundedAnimeEpisode)
      : undefined;
  const details: AnimeDetails = {
    tvdbId,
    title: text(data.name) || titles[0] || `TVDB ${tvdbId}`,
    ...(text(data.firstAired) && { firstAirDate: text(data.firstAired) }),
    episodeRunTime:
      integer(data.averageRuntime) === undefined ? [] : [integer(data.averageRuntime)!],
    genres: genreNames,
    order,
    seasons: selectedSeasons.map((season) => ({
      season: season.number,
      name:
        names.get(season.number) ?? (season.number === 0 ? 'Specials' : `Season ${season.number}`),
      episodeCount:
        season.number === selectedSeason && selectedEpisodes !== undefined
          ? selectedEpisodes.length
          : (season.episodeCount ?? 0),
    })),
    ...(selectedSeason !== undefined && {
      selectedSeason,
      ...(selectedEpisodes !== undefined && { selectedEpisodes }),
    }),
  };
  return { details, episodes: selectedEpisodes };
}

type SnapshotActionCtx = {
  runQuery: Function;
  runMutation: Function;
};
type StoredSnapshot = { value: unknown; refreshedAt: number } | null;
const guideSnapshotKey = (tmdbId: number, tvdbId: number, order: SeasonOrder) =>
  tvdbAnimeGuideKey(tmdbId, tvdbId, order);
const guideLookupKey = tvdbAnimeLookupKey;
const seasonSnapshotKey = (tvdbId: number, order: SeasonOrder, season: number) =>
  `tvdb:season:${tvdbId}:${order}:${season}`;

async function putSeasonSnapshots(ctx: SnapshotActionCtx, resolution: AnimeResolution) {
  const { details, episodes } = resolution;
  if (details.selectedSeason === undefined || episodes === undefined) return;
  await putNonFatal(ctx, {
    key: seasonSnapshotKey(details.tvdbId, details.order, details.selectedSeason),
    value: episodes,
    metricKey: 'tvdb-season',
  });
}

async function refreshAnimeSnapshot(
  ctx: SnapshotActionCtx,
  tmdbId: number,
  titles: string[],
  pinned?: { tvdbId?: number; order?: SeasonOrder },
  requestedSeason?: number,
): Promise<AnimeDetails | null> {
  const resolution = await resolveAnime(ctx, tmdbId, titles, pinned, requestedSeason);
  if (resolution) {
    await Promise.all([
      putNonFatal(ctx, {
        key: guideSnapshotKey(tmdbId, resolution.details.tvdbId, resolution.details.order),
        value: resolution.details,
        metricKey: 'tvdb-guide',
      }),
      ...(!pinned
        ? [
            putNonFatal(ctx, {
              key: guideLookupKey(tmdbId),
              value: {
                tvdbId: resolution.details.tvdbId,
                order: resolution.details.order,
                authoritativeNames: normalizedNames(titles),
              },
              metricKey: 'tvdb-guide-lookup',
            }),
          ]
        : []),
    ]);
  } else if (pinned?.tvdbId && pinned.order)
    await putNonFatal(ctx, {
      key: guideSnapshotKey(tmdbId, pinned.tvdbId, pinned.order),
      value: null,
      metricKey: 'tvdb-guide',
    });
  if (resolution) await putSeasonSnapshots(ctx, resolution);
  return resolution?.details ?? null;
}

async function animeSnapshot(
  ctx: SnapshotActionCtx,
  tmdbId: number,
  titles: string[],
  pinned?: { tvdbId?: number; order?: SeasonOrder },
  requestedSeason?: number,
): Promise<AnimeDetails | null> {
  if (pinned?.tvdbId && pinned.order) {
    const key = guideSnapshotKey(tmdbId, pinned.tvdbId, pinned.order);
    const stored: StoredSnapshot = await ctx.runQuery(internal.providerSnapshots.get, { key });
    if (stored && stored.refreshedAt > Date.now() - GUIDE_SNAPSHOT_MS) {
      const value = (
        isTruncatedSnapshot(stored.value) ? null : stored.value
      ) as AnimeDetails | null;
      if (value === null) return null;
      if (value?.tvdbId === pinned.tvdbId && value.order === pinned.order) return value;
    }
  } else if (!pinned) {
    const lookup: StoredSnapshot = await ctx.runQuery(internal.providerSnapshots.get, {
      key: guideLookupKey(tmdbId),
    });
    const identity = lookup?.value as
      { tvdbId?: unknown; order?: unknown; authoritativeNames?: unknown } | undefined;
    const currentNames = new Set(normalizedNames(titles));
    const cachedNames = Array.isArray(identity?.authoritativeNames)
      ? identity.authoritativeNames.filter((value): value is string => typeof value === 'string')
      : [];
    if (
      lookup &&
      lookup.refreshedAt > Date.now() - GUIDE_SNAPSHOT_MS &&
      typeof identity?.tvdbId === 'number' &&
      typeof identity.order === 'string' &&
      validOrders.has(identity.order as SeasonOrder) &&
      cachedNames.some((value) => currentNames.has(value))
    ) {
      const stored: StoredSnapshot = await ctx.runQuery(internal.providerSnapshots.get, {
        key: guideSnapshotKey(tmdbId, identity.tvdbId, identity.order as SeasonOrder),
      });
      if (stored && stored.refreshedAt > Date.now() - GUIDE_SNAPSHOT_MS) {
        const value = (
          isTruncatedSnapshot(stored.value) ? null : stored.value
        ) as AnimeDetails | null;
        if (value?.tvdbId === identity.tvdbId && value.order === identity.order) return value;
      }
    }
  }
  return refreshAnimeSnapshot(ctx, tmdbId, titles, pinned, requestedSeason);
}

async function refreshSeasonSnapshot(
  ctx: SnapshotActionCtx,
  tvdbId: number,
  order: SeasonOrder,
  season: number,
): Promise<AnimeEpisode[]> {
  const episodes = (await fetchEpisodes(ctx, tvdbId, order, season)).map(boundedAnimeEpisode);
  await putNonFatal(ctx, {
    key: seasonSnapshotKey(tvdbId, order, season),
    value: episodes,
    metricKey: 'tvdb-season',
  });
  return episodes;
}

async function seasonSnapshot(
  ctx: SnapshotActionCtx,
  tvdbId: number,
  order: SeasonOrder,
  season: number,
): Promise<AnimeEpisode[]> {
  const key = seasonSnapshotKey(tvdbId, order, season);
  const stored: StoredSnapshot = await ctx.runQuery(internal.providerSnapshots.get, { key });
  if (stored && stored.refreshedAt > Date.now() - SEASON_SNAPSHOT_MS) {
    if (!isTruncatedSnapshot(stored.value)) return stored.value as AnimeEpisode[];
    const durable = await ctx.runQuery(internal.seasonStorage.readCanonicalSeasonByTvdb, {
      tvdbId,
      order,
      season,
    });
    if (durable) return durable.episodes as AnimeEpisode[];
    // A marker is only a cache hit when its oversized value has already been
    // committed to durable canonical chunks. Cold/title-only flows must refetch.
  }
  return refreshSeasonSnapshot(ctx, tvdbId, order, season);
}

const validateOrder = (value: string): SeasonOrder => {
  if (!validOrders.has(value as SeasonOrder)) throw new Error('Invalid TVDB season order');
  return value as SeasonOrder;
};
export const refreshAnime = internalAction({
  args: {
    tmdbId: v.number(),
    title: v.string(),
    originalTitle: v.optional(v.string()),
    force: v.optional(v.boolean()),
    requestedSeason: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<AnimeDetails | null> =>
    args.force
      ? refreshAnimeSnapshot(
          ctx,
          args.tmdbId,
          authoritativeNames(args.title, args.originalTitle),
          undefined,
          args.requestedSeason,
        )
      : animeSnapshot(
          ctx,
          args.tmdbId,
          authoritativeNames(args.title, args.originalTitle),
          undefined,
          args.requestedSeason,
        ),
});

export const refreshAnimeWithMapping = internalAction({
  args: {
    tmdbId: v.number(),
    title: v.string(),
    originalTitle: v.optional(v.string()),
    tvdbId: v.optional(v.number()),
    order: v.optional(v.string()),
    force: v.optional(v.boolean()),
    requestedSeason: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<AnimeDetails | null> => {
    const pinned =
      args.tvdbId !== undefined && args.order !== undefined
        ? { tvdbId: args.tvdbId, order: validateOrder(args.order) }
        : undefined;
    return args.force
      ? refreshAnimeSnapshot(
          ctx,
          args.tmdbId,
          authoritativeNames(args.title, args.originalTitle),
          pinned,
          args.requestedSeason,
        )
      : animeSnapshot(
          ctx,
          args.tmdbId,
          authoritativeNames(args.title, args.originalTitle),
          pinned,
          args.requestedSeason,
        );
  },
});

export const refreshSeason = internalAction({
  args: {
    tvdbId: v.number(),
    order: v.string(),
    season: v.number(),
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<AnimeEpisode[]> =>
    args.force
      ? refreshSeasonSnapshot(ctx, args.tvdbId, validateOrder(args.order), args.season)
      : seasonSnapshot(ctx, args.tvdbId, validateOrder(args.order), args.season),
});
