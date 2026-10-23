import { Clock, Effect, Schema } from 'effect';
import { attempt } from './actionEffects';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction, type ActionCtx } from './_generated/server';
import {
  providerFetchEffect,
  decodeProviderObject,
  runProviderEffect,
  ProviderIntegrationFailure,
  type ProviderTransportFailure,
} from './providerHttp';
import { animeEpisodeValidator, animeGuideValidator } from './providerValidators';
import { findSeriesEffect } from './tvdbSeriesLookup';
import { isAnime } from './mergePolicy';
import { releasedEpisodes } from './episodeAvailability';
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
  text,
  validateOrder,
  validOrders,
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

const TVDB_ANIME_GUIDE_VERSION = 'v10';

const tvdbAnimeGuideKey = (tmdbId: number, tvdbId: number, order: string) =>
  `tvdb:anime:${TVDB_ANIME_GUIDE_VERSION}:${tmdbId}:${tvdbId}:${order}`;

const tvdbAnimeLookupKey = (tmdbId: number) =>
  `tvdb:anime:${TVDB_ANIME_GUIDE_VERSION}:lookup:${tmdbId}`;

const API_ROOT = 'https://api4.thetvdb.com/v4';
const GUIDE_SNAPSHOT_MS = SNAPSHOT_TTL_MS;
const INCOMPLETE_GUIDE_SNAPSHOT_MS = 5 * 60 * 1000;
const SEASON_SNAPSHOT_MS = SNAPSHOT_TTL_MS;
const MAX_EPISODE_PAGES = 5;
const EPISODE_FETCH_DEADLINE_MS = 20_000;
const MAX_SEASON_COUNT_REQUESTS = 64;
const SEASON_COUNT_DEADLINE_MS = 20_000;

let credentials: { token: string; expiresAt: number } | undefined;

class TvdbNotFoundError extends Error {}

const loginPayload = Schema.Struct({ data: Schema.Struct({ token: Schema.String }) });

const loginEffect = Effect.fnUntraced(function* (ctx: Pick<ActionCtx, 'runMutation'>) {
  const apikey = process.env.TVDB_API_KEY;
  if (!apikey)
    return yield* Effect.fail(
      new ProviderIntegrationFailure({
        provider: 'tvdb',
        message: 'TVDB_API_KEY is not configured',
      }),
    );
  if (credentials && credentials.expiresAt > (yield* Clock.currentTimeMillis) + 60_000)
    return credentials.token;
  const response = yield* providerFetchEffect(
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
        ctx.runMutation(internal.providerRateLimits.consumeGlobalProviderLimiter, {
          provider: 'tvdb',
        }),
    },
  );
  if (!response.ok)
    return yield* Effect.fail(
      new ProviderIntegrationFailure({
        provider: 'tvdb',
        message: `TVDB login failed (${response.status})`,
      }),
    );
  const payload = yield* decodeProviderObject(response, 'tvdb').pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(loginPayload)),
    Effect.mapError(
      () =>
        new ProviderIntegrationFailure({
          provider: 'tvdb',
          message: 'TVDB login returned malformed data',
        }),
    ),
  );
  const token = payload.data.token.trim();
  if (!token)
    return yield* Effect.fail(
      new ProviderIntegrationFailure({
        provider: 'tvdb',
        message: 'TVDB login returned malformed data',
      }),
    );
  credentials = { token, expiresAt: (yield* Clock.currentTimeMillis) + 29 * 24 * 60 * 60 * 1000 };
  return token;
});

const requestEffect = Effect.fnUntraced(function* (
  ctx: Pick<ActionCtx, 'runMutation'>,
  path: string,
  emptyOnNotFound = false,
): Effect.fn.Return<
  Json,
  ProviderTransportFailure | ProviderIntegrationFailure | TvdbNotFoundError
> {
  // Authentication gets one refresh, independently of idempotent transport retries.
  for (let authAttempt = 0; authAttempt < 2; authAttempt++) {
    const token = yield* loginEffect(ctx);
    const response = yield* providerFetchEffect(
      `${API_ROOT}${path}`,
      {
        headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
      },
      {
        provider: 'tvdb',
        operation: path.split('?')[0],
        beforeRequest: () =>
          ctx.runMutation(internal.providerRateLimits.consumeGlobalProviderLimiter, {
            provider: 'tvdb',
          }),
      },
    );
    if (response.status === 401 && authAttempt === 0) {
      credentials = undefined;
      continue;
    }
    if (response.status === 404 && emptyOnNotFound) return {};
    if (response.status === 404)
      return yield* Effect.fail(new TvdbNotFoundError('TVDB record not found'));
    if (!response.ok)
      return yield* Effect.fail(
        new ProviderIntegrationFailure({
          provider: 'tvdb',
          message: `TVDB request failed (${response.status})`,
        }),
      );
    return yield* decodeProviderObject(response, 'tvdb');
  }
  return yield* Effect.fail(
    new ProviderIntegrationFailure({ provider: 'tvdb', message: 'TVDB authentication failed' }),
  );
});

const fetchEpisodesEffect = Effect.fnUntraced(function* (
  ctx: Pick<ActionCtx, 'runMutation'>,
  tvdbId: number,
  order: SeasonOrder,
  season?: number,
) {
  const episodes: AnimeEpisode[] = [];
  const seen = new Set<number>();
  let hasNextPage = false;
  const deadline = (yield* Clock.currentTimeMillis) + EPISODE_FETCH_DEADLINE_MS;
  for (let page = 0; page < MAX_EPISODE_PAGES; page += 1) {
    if ((yield* Clock.currentTimeMillis) >= deadline)
      return yield* Effect.fail(
        new ProviderIntegrationFailure({
          provider: 'tvdb',
          message: 'TVDB episode pagination exceeded its deadline',
        }),
      );
    const query = new URLSearchParams({ page: String(page) });
    if (season !== undefined) query.set('season', String(season));
    const payload = yield* requestEffect(
      ctx,
      `/series/${tvdbId}/episodes/${order}/eng?${query.toString()}`,
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
  if (hasNextPage)
    return yield* Effect.fail(
      new ProviderIntegrationFailure({
        provider: 'tvdb',
        message: 'TVDB episode pagination exceeded the safety limit',
      }),
    );
  return episodesForSeason(episodes, season);
});

const fetchEpisodes = (
  ctx: Pick<ActionCtx, 'runMutation'>,
  tvdbId: number,
  order: SeasonOrder,
  season?: number,
) => runProviderEffect(fetchEpisodesEffect(ctx, tvdbId, order, season));

function translatedSeasonNameEffect(
  ctx: Pick<ActionCtx, 'runMutation'>,
  season: SeasonRecord,
  titles: string[],
) {
  const localName = seasonDisplayName(season.number, season.name, season.translatedName);
  const knownName = knownAnimeSeasonName(titles, season.number);
  if (season.number === 0) return Effect.succeed('Specials');
  if (knownName && (!season.translatedName || /^season\s+\d+$/i.test(season.translatedName)))
    return Effect.succeed(knownName);
  return requestEffect(ctx, `/seasons/${season.id}/translations/eng`, true).pipe(
    Effect.map((payload) => {
      const translated = seasonDisplayName(
        season.number,
        season.name,
        text(record(payload.data).name),
      );
      return knownName && /^season\s+\d+$/i.test(translated) ? knownName : translated;
    }),
    Effect.catch(() =>
      Effect.succeed(knownName && /^season\s+\d+$/i.test(localName) ? knownName : localName),
    ),
  );
}

function translateSeasonNamesEffect(
  ctx: Pick<ActionCtx, 'runMutation'>,
  seasons: SeasonRecord[],
  titles: string[],
) {
  let translationsRequested = 0;
  const translationLimit = seasonTranslationLimit(seasons.length);
  const work = seasons.map((season) => {
    const translate = season.number > 0 && translationsRequested < translationLimit;
    if (translate) translationsRequested++;
    return { season, translate };
  });
  return Effect.forEach(
    work,
    ({ season, translate }) =>
      (translate
        ? translatedSeasonNameEffect(ctx, season, titles)
        : Effect.succeed(
            seasonDisplayName(
              season.number,
              season.name,
              season.translatedName ?? knownAnimeSeasonName(titles, season.number),
            ),
          )
      ).pipe(Effect.map((name) => [season.number, name] as const)),
    { concurrency: 6 },
  ).pipe(Effect.map((entries) => new Map(entries)));
}

const resolveAnimeEffect = Effect.fnUntraced(function* (
  ctx: Pick<ActionCtx, 'runMutation'>,
  tmdbId: number,
  titles: string[],
  pinned?: { tvdbId?: number; order?: SeasonOrder },
  requestedSeason?: number,
) {
  const lookup = (excluded: Set<number> = new Set()) =>
    findSeriesEffect((path) => requestEffect(ctx, path, true), tmdbId, titles, excluded);
  let tvdbId = pinned?.tvdbId ?? (yield* lookup());
  if (!tvdbId) return null;
  const payload = yield* requestEffect(ctx, `/series/${tvdbId}/extended?meta=translations`).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        if (!(error instanceof TvdbNotFoundError) || pinned?.order)
          return yield* Effect.fail(error);
        const replacement = yield* lookup(new Set([tvdbId!]));
        if (!replacement)
          return yield* Effect.fail(
            new ProviderIntegrationFailure({
              provider: 'tvdb',
              message: 'No unambiguous replacement TVDB series found',
            }),
          );
        tvdbId = replacement;
        return yield* requestEffect(ctx, `/series/${tvdbId}/extended?meta=translations`);
      }),
    ),
  );
  const data = record(payload.data);
  const genreNames = records(data.genres).flatMap((genre) => {
    const name = text(genre.name);
    return name ? [name] : [];
  });
  // A previously matched anime can lose its Anime tag when TVDB recreates it.
  if (!isAnime(genreNames) && !(pinned?.tvdbId && genreNames.includes('Animation'))) return null;
  const seasonRecords = records(data.seasons).flatMap((entry) => {
    const season = mapSeason(entry);
    return season ? [season] : [];
  });
  const order = pinned?.order ?? selectSeasonOrder(seasonRecords, integer(data.defaultSeasonType));
  const selectedSeasons = seasonRecords
    .filter((season) => season.type === order)
    .sort((left, right) => left.number - right.number);
  const selectedSeason = selectedSeasons.find((season) => season.number > 0)?.number;
  const loadSelectedEpisodes =
    selectedSeason !== undefined &&
    (requestedSeason === undefined || requestedSeason === selectedSeason);
  const [names, counts, selectedEpisodes] = yield* Effect.all(
    [
      translateSeasonNamesEffect(ctx, selectedSeasons, titles),
      resolveSeasonCountsEffect(
        ctx,
        selectedSeasons.filter(
          (season) => !loadSelectedEpisodes || season.number !== selectedSeason,
        ),
      ),
      loadSelectedEpisodes
        ? fetchEpisodesEffect(ctx, tvdbId, order, selectedSeason)
        : Effect.succeed(undefined),
    ],
    { concurrency: 3 },
  );
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
          ? releasedEpisodes(selectedEpisodes).length
          : (counts.get(season.number) ?? 0),
      episodeCountVerified:
        (season.number === selectedSeason && selectedEpisodes !== undefined) ||
        counts.has(season.number),
    })),
    ...(selectedSeason !== undefined && {
      selectedSeason,
      ...(selectedEpisodes !== undefined && { selectedEpisodes }),
    }),
  };
  return { details, episodes: selectedEpisodes };
});

function resolveSeasonCountsEffect(ctx: Pick<ActionCtx, 'runMutation'>, seasons: SeasonRecord[]) {
  return Effect.suspend(() => {
    const counts = new Map<number, number>();
    const deadline = Date.now() + SEASON_COUNT_DEADLINE_MS;
    return Effect.forEach(
      seasons.slice(0, MAX_SEASON_COUNT_REQUESTS),
      (season) =>
        Effect.suspend(() => {
          if (Date.now() >= deadline) return Effect.void;
          return requestEffect(ctx, `/seasons/${season.id}/extended`).pipe(
            Effect.map((payload) => {
              const data = record(payload.data);
              if (integer(data.id) !== season.id || !Array.isArray(data.episodes)) return;
              // The season ID identifies the chosen order, independently of episode coordinates.
              const episodes = records(data.episodes).flatMap((entry) => {
                const episode = mapEpisode(entry);
                return episode ? [episode] : [];
              });
              counts.set(
                season.number,
                new Set(releasedEpisodes(episodes).map((episode) => episode.id)).size,
              );
            }),
            // Missing counts remain optional; interruption still propagates to sibling work.
            Effect.catch(() => Effect.void),
          );
        }),
      { concurrency: 4, discard: true },
    ).pipe(Effect.as(counts));
  });
}

type SnapshotActionCtx = Pick<ActionCtx, 'runQuery' | 'runMutation'>;
type StoredSnapshot = { value: unknown; refreshedAt: number } | null;
const guideSnapshotFresh = (refreshedAt: number, guide: AnimeDetails) =>
  refreshedAt >
  Date.now() -
    (guide.seasons.some((season) => season.episodeCountVerified === false)
      ? INCOMPLETE_GUIDE_SNAPSHOT_MS
      : GUIDE_SNAPSHOT_MS);
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
  const resolution: AnimeResolution | null = await runProviderEffect(
    resolveAnimeEffect(ctx, tmdbId, titles, pinned, requestedSeason),
  );
  if (resolution) {
    await runProviderEffect(
      Effect.all(
        [
          attempt(() =>
            putNonFatal(ctx, {
              key: guideSnapshotKey(tmdbId, resolution.details.tvdbId, resolution.details.order),
              value: resolution.details,
              metricKey: 'tvdb-guide',
            }),
          ),
          ...(!pinned?.order
            ? [
                attempt(() =>
                  putNonFatal(ctx, {
                    key: guideLookupKey(tmdbId),
                    value: {
                      tvdbId: resolution.details.tvdbId,
                      order: resolution.details.order,
                      authoritativeNames: normalizedNames(titles),
                    },
                    metricKey: 'tvdb-guide-lookup',
                  }),
                ),
              ]
            : []),
        ],
        { concurrency: 2 },
      ),
    );
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
      if (
        value?.tvdbId === pinned.tvdbId &&
        value.order === pinned.order &&
        guideSnapshotFresh(stored.refreshedAt, value)
      )
        return value;
    }
  } else if (!pinned?.order) {
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
      (pinned?.tvdbId === undefined || pinned.tvdbId === identity.tvdbId) &&
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
        if (
          value?.tvdbId === identity.tvdbId &&
          value.order === identity.order &&
          guideSnapshotFresh(stored.refreshedAt, value)
        )
          return value;
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
  returns: v.union(v.null(), animeGuideValidator),
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
  returns: v.union(v.null(), animeGuideValidator),
  handler: async (ctx, args): Promise<AnimeDetails | null> => {
    const pinned =
      args.tvdbId !== undefined
        ? {
            tvdbId: args.tvdbId,
            ...(args.order !== undefined && { order: validateOrder(args.order) }),
          }
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
  returns: v.array(animeEpisodeValidator),
  handler: async (ctx, args): Promise<AnimeEpisode[]> =>
    args.force
      ? refreshSeasonSnapshot(ctx, args.tvdbId, validateOrder(args.order), args.season)
      : seasonSnapshot(ctx, args.tvdbId, validateOrder(args.order), args.season),
});
