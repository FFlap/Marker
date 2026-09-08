import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction } from './_generated/server';
import { providerFetch } from './providerHttp';
import { isAnime } from './mergePolicy';
import { isTruncatedSnapshot, putNonFatal, SNAPSHOT_TTL_MS } from './providerSnapshots';
import { MAX_SEASON_EPISODES } from './seasonStorage';
import {
  authoritativeNames,
  boundedAnimeEpisode,
  episodesForSeason,
  integer,
  knownAnimeSeasonName,
  mapEpisode,
  mapSeason,
  normalizedNames,
  record,
  records,
  seasonDisplayName,
  seasonTranslationLimit,
  selectSeasonOrder,
  selectSeriesMatch,
  seriesId,
  text,
  validateOrder,
  validOrders,
  verifiedTmdbRemoteSeries,
  type AnimeDetails,
  type AnimeEpisode,
  type AnimeResolution,
  type Json,
  type SeasonOrder,
  type SeasonRecord,
} from './tvdbParsing';

export {
  episodesForSeason,
  knownAnimeSeasonName,
  mapEpisode,
  seasonDisplayName,
  seasonTranslationLimit,
  selectSeasonOrder,
} from './tvdbParsing';
export type { AnimeDetails, AnimeEpisode, SeasonRecord } from './tvdbParsing';

const TVDB_ANIME_GUIDE_VERSION = 'v8';

const tvdbAnimeGuideKey = (tmdbId: number, tvdbId: number, order: string) =>
  `tvdb:anime:${TVDB_ANIME_GUIDE_VERSION}:${tmdbId}:${tvdbId}:${order}`;

const tvdbAnimeLookupKey = (tmdbId: number) =>
  `tvdb:anime:${TVDB_ANIME_GUIDE_VERSION}:lookup:${tmdbId}`;

const API_ROOT = 'https://api4.thetvdb.com/v4';
const GUIDE_SNAPSHOT_MS = SNAPSHOT_TTL_MS;
const SEASON_SNAPSHOT_MS = SNAPSHOT_TTL_MS;
const MAX_EPISODE_PAGES = 5;
const EPISODE_FETCH_DEADLINE_MS = 20_000;

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
    const rawEpisodes = records(record(payload.data).episodes);
    const mapped = rawEpisodes.flatMap((entry) => {
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
    hasNextPage = next !== null && next !== undefined && next !== '' && rawEpisodes.length > 0;
    if (!hasNextPage) break;
  }
  if (hasNextPage) throw new Error('TVDB episode pagination exceeded the safety limit');
  return episodesForSeason(episodes, season);
}

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
    const exact = selectSeriesMatch(records(search.data), tmdbId, titles);
    const id = seriesId(exact ?? {});
    if (id) return id;
  }
  return undefined;
}

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
