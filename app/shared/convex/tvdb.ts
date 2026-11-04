import { Clock, Effect, Schema } from 'effect';
import { batchedProviderBudget } from './providerBudget';
import { attempt, providerOutcome, type ActionCallFailure } from './actionEffects';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction, type ActionCtx } from './_generated/server';
import {
  providerFetchEffect,
  decodeProviderObject,
  runProviderEffect,
  ProviderIntegrationFailure,
  providerRecords,
  type ProviderTransportFailure,
} from './providerHttp';
import {
  animeEpisodeValidator,
  animeGuideValidator,
  characterArtworkValidator,
} from './providerValidators';
import { mapCharacterArtwork, type CharacterArtwork } from './characterArtwork';
import { validateTmdbId } from './providerValidation';
import { mediaTypeValidator } from './publicValidators';
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
  selectTitleMatch,
  verifiedTmdbRemoteMovie,
  seriesId,
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

const TVDB_ANIME_GUIDE_VERSION = 'v12';
type SeasonPrefetch = { tvdbId: number; order: SeasonOrder; seasons: SeasonRecord[] };
type TvdbRequestCtx = Pick<ActionCtx, 'runMutation' | 'runQuery'> & {
  reserveRequest?: () => Promise<boolean>;
};

const tvdbAnimeGuideKey = (tmdbId: number, tvdbId: number, order: string, metadataOnly = false) =>
  `tvdb:anime:${metadataOnly ? 'v13' : TVDB_ANIME_GUIDE_VERSION}:${tmdbId}:${tvdbId}:${order}`;

const tvdbAnimeLookupKey = (tmdbId: number, metadataOnly = false) =>
  `tvdb:anime:${metadataOnly ? 'v13' : TVDB_ANIME_GUIDE_VERSION}:lookup:${tmdbId}`;

const API_ROOT = 'https://api4.thetvdb.com/v4';
const GUIDE_SNAPSHOT_MS = SNAPSHOT_TTL_MS;
const INCOMPLETE_GUIDE_SNAPSHOT_MS = 5 * 60 * 1000;
const SEASON_SNAPSHOT_MS = SNAPSHOT_TTL_MS;
const MAX_EPISODE_PAGES = 5;
const EPISODE_FETCH_DEADLINE_MS = 20_000;
const MAX_SEASON_COUNT_REQUESTS = 64;
const SEASON_COUNT_DEADLINE_MS = 20_000;

let credentials: { token: string; expiresAt: number; keyHash: string } | undefined;
let credentialApiKey: string | undefined;

/** Fetch TV or movie character artwork independently of anime season ordering. */
export const getCharacterArtwork = internalAction({
  args: {
    tmdbId: v.number(),
    mediaType: mediaTypeValidator,
    title: v.string(),
    originalTitle: v.optional(v.string()),
    tvdbId: v.optional(v.number()),
  },
  returns: v.array(characterArtworkValidator),
  handler: (ctx, args) =>
    runTvdbEffect(
      Effect.gen(function* () {
        validateTmdbId(args.tmdbId);
        const titles = authoritativeNames(args.title, args.originalTitle);
        let id = args.tvdbId;
        if (!id && args.mediaType === 'tv') {
          id = yield* findSeriesEffect(
            (path) => requestEffect(ctx, path, true),
            args.tmdbId,
            titles,
            new Set(),
          );
        } else if (!id) {
          const remote = yield* providerOutcome(
            requestEffect(ctx, `/search/remoteid/${encodeURIComponent(String(args.tmdbId))}`, true),
          );
          if (remote.ok) {
            const ids = new Set(
              records(remote.value.data)
                .map((entry) => verifiedTmdbRemoteMovie(entry, titles))
                .filter(
                  (candidate): candidate is number => candidate !== undefined && candidate > 0,
                ),
            );
            if (ids.size > 1) return [];
            id = ids.values().next().value;
          }
          for (const title of titles) {
            if (id) break;
            const search = yield* requestEffect(
              ctx,
              `/search?query=${encodeURIComponent(title)}&type=movie&limit=20`,
              true,
            );
            id = seriesId(
              selectTitleMatch(records(search.data), args.tmdbId, titles, 'movie') ?? {},
            );
            if (id) break;
          }
        }
        if (!id) return [];
        const payload = yield* requestEffect(
          ctx,
          `/${args.mediaType === 'tv' ? 'series' : 'movies'}/${id}/extended`,
        );
        return mapCharacterArtwork(record(payload.data));
      }),
    ),
});

class TvdbNotFoundError extends Schema.TaggedError<TvdbNotFoundError>()('TvdbNotFoundError', {
  message: Schema.String,
}) {}

const runTvdbEffect = <A, E>(effect: Effect.Effect<A, E>) =>
  runProviderEffect(
    effect.pipe(
      Effect.mapError((error) =>
        error instanceof TvdbNotFoundError
          ? new ProviderIntegrationFailure({ provider: 'tvdb', message: error.message })
          : error,
      ),
    ),
  );

const loginPayload = Schema.Struct({ data: Schema.Struct({ token: Schema.String }) });

const loginEffect = Effect.fnUntraced(function* (ctx: TvdbRequestCtx) {
  const apikey = process.env.TVDB_API_KEY;
  if (!apikey)
    return yield* Effect.fail(
      new ProviderIntegrationFailure({
        provider: 'tvdb',
        message: 'TVDB_API_KEY is not configured',
      }),
    );
  if (
    credentials &&
    credentialApiKey === apikey &&
    credentials.expiresAt > (yield* Clock.currentTimeMillis) + 60_000
  )
    return credentials.token;
  const keyHash = yield* Effect.promise(async () => {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apikey));
    return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
  });
  if (
    credentials?.keyHash === keyHash &&
    credentials.expiresAt > (yield* Clock.currentTimeMillis) + 60_000
  )
    return credentials.token;
  const cached = yield* attempt(() => ctx.runQuery(internal.providerCredentials.get, { keyHash }));
  if (cached) {
    credentials = { ...cached, keyHash };
    credentialApiKey = apikey;
    return cached.token;
  }
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
  credentials = {
    token,
    keyHash,
    expiresAt: (yield* Clock.currentTimeMillis) + 29 * 24 * 60 * 60 * 1000,
  };
  credentialApiKey = apikey;
  yield* attempt(() => ctx.runMutation(internal.providerCredentials.put, credentials!));
  return token;
});

const requestEffect = Effect.fnUntraced(function* (
  ctx: TvdbRequestCtx,
  path: string,
  emptyOnNotFound = false,
): Effect.fn.Return<
  Json,
  ProviderTransportFailure | ProviderIntegrationFailure | TvdbNotFoundError | ActionCallFailure
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
        beforeRequest:
          ctx.reserveRequest ??
          (() =>
            ctx.runMutation(internal.providerRateLimits.consumeGlobalProviderLimiter, {
              provider: 'tvdb',
            })),
      },
    );
    if (response.status === 401 && authAttempt === 0) {
      if (credentials)
        yield* attempt(() =>
          ctx.runMutation(internal.providerCredentials.invalidate, {
            keyHash: credentials!.keyHash,
            token,
          }),
        );
      credentials = undefined;
      continue;
    }
    if (response.status === 404 && emptyOnNotFound) return {};
    if (response.status === 404)
      return yield* Effect.fail(new TvdbNotFoundError({ message: 'TVDB record not found' }));
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
  ctx: TvdbRequestCtx,
  tvdbId: number,
  order: SeasonOrder,
  season?: number,
) {
  const deadline = (yield* Clock.currentTimeMillis) + EPISODE_FETCH_DEADLINE_MS;
  const loadPage = Effect.fnUntraced(function* (page: number) {
    if ((yield* Clock.currentTimeMillis) >= deadline)
      return yield* Effect.fail(
        new ProviderIntegrationFailure({
          provider: 'tvdb',
          message: 'TVDB episode pagination exceeded its deadline',
        }),
      );
    // The translated endpoint has no season filter; fetch its catalog once.
    const payload = yield* requestEffect(
      ctx,
      `/series/${tvdbId}/episodes/${order}/eng?page=${page}`,
    );
    const entries = yield* Schema.decodeUnknownEffect(providerRecords)(
      record(payload.data).episodes,
    ).pipe(
      Effect.mapError(
        () =>
          new ProviderIntegrationFailure({
            provider: 'tvdb',
            message: 'TVDB returned malformed data',
          }),
      ),
    );
    return { entries, links: record(payload.links) };
  });
  const first = yield* loadPage(0);
  const pages = [first];
  const total = integer(first.links.total_items);
  const pageSize = integer(first.links.page_size);
  const hasNext = (page: typeof first) =>
    page.links.next !== null && page.links.next !== undefined && page.links.next !== '';
  if (hasNext(first) && total !== undefined && pageSize !== undefined && pageSize > 0) {
    const pageCount = Math.ceil(total / pageSize);
    if (pageCount < 2 || pageCount > MAX_EPISODE_PAGES)
      return yield* Effect.fail(
        new ProviderIntegrationFailure({
          provider: 'tvdb',
          message: 'TVDB episode pagination exceeded the safety limit',
        }),
      );
    pages.push(
      ...(yield* Effect.forEach(
        Array.from({ length: pageCount - 1 }, (_, i) => i + 1),
        loadPage,
        { concurrency: 4 },
      )),
    );
    if (
      pages.reduce((sum, page) => sum + page.entries.length, 0) !== total ||
      hasNext(pages[pages.length - 1])
    )
      return yield* Effect.fail(
        new ProviderIntegrationFailure({
          provider: 'tvdb',
          message: 'TVDB episode pagination returned an incomplete catalog',
        }),
      );
  } else {
    while (hasNext(pages[pages.length - 1])) {
      if (pages.length >= MAX_EPISODE_PAGES || pages[pages.length - 1].entries.length === 0)
        return yield* Effect.fail(
          new ProviderIntegrationFailure({
            provider: 'tvdb',
            message: 'TVDB episode pagination exceeded the safety limit',
          }),
        );
      pages.push(yield* loadPage(pages.length));
    }
  }
  const episodes: AnimeEpisode[] = [];
  const seen = new Set<number>();
  for (const page of pages)
    for (const raw of page.entries) {
      const episode = mapEpisode(raw);
      if (!episode)
        return yield* Effect.fail(
          new ProviderIntegrationFailure({
            provider: 'tvdb',
            message: 'TVDB returned malformed episode coordinates',
          }),
        );
      if (seen.has(episode.id)) continue;
      seen.add(episode.id);
      episodes.push(boundedAnimeEpisode(episode));
    }
  if (total !== undefined && episodes.length !== total)
    return yield* Effect.fail(
      new ProviderIntegrationFailure({
        provider: 'tvdb',
        message: 'TVDB episode pagination returned an incomplete catalog',
      }),
    );
  const selected = episodesForSeason(episodes, season);
  if (season !== undefined && selected.length > MAX_SEASON_EPISODES)
    return yield* Effect.fail(
      new ProviderIntegrationFailure({
        provider: 'tvdb',
        message: 'TVDB season exceeded the safety limit',
      }),
    );
  return selected;
});

const fetchEpisodes = (ctx: TvdbRequestCtx, tvdbId: number, order: SeasonOrder, season?: number) =>
  runTvdbEffect(fetchEpisodesEffect(ctx, tvdbId, order, season));

function translatedSeasonNameEffect(ctx: TvdbRequestCtx, season: SeasonRecord, titles: string[]) {
  const localName = seasonDisplayName(season.number, season.name, season.translatedName);
  const knownName = knownAnimeSeasonName(titles, season.number);
  if (season.number === 0) return Effect.succeed('Specials');
  if (season.translatedName && !/^season\s+\d+$/i.test(season.translatedName))
    return Effect.succeed(localName);
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
  ctx: TvdbRequestCtx,
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
    { concurrency: 24 },
  ).pipe(Effect.map((entries) => new Map(entries)));
}

const resolveAnimeEffect = Effect.fnUntraced(function* (
  ctx: TvdbRequestCtx,
  tmdbId: number,
  titles: string[],
  pinned?: { tvdbId?: number; order?: SeasonOrder; hintId?: number },
  requestedSeason?: number,
  captureCharacters?: (characters: CharacterArtwork[]) => void,
  metadataOnly = false,
  prefetch?: SeasonPrefetch,
) {
  const lookup = (excluded: Set<number> = new Set()) =>
    findSeriesEffect((path) => requestEffect(ctx, path, true), tmdbId, titles, excluded);
  let tvdbId = pinned?.tvdbId ?? pinned?.hintId ?? (yield* lookup());
  if (!tvdbId) return null;
  const parallelCtx: TvdbRequestCtx = {
    runQuery: ctx.runQuery,
    runMutation: ctx.runMutation,
    reserveRequest: batchedProviderBudget(() =>
      ctx.runMutation(internal.providerRateLimits.reserveProviderBudget, { provider: 'tvdb' }),
    ),
  };
  const extendedPath = (id: number) => `/series/${id}/extended`;
  const seriesRequest = requestEffect(ctx, extendedPath(tvdbId)).pipe(
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
        return yield* requestEffect(ctx, extendedPath(tvdbId));
      }),
    ),
  );
  // Reuse only identifiers as hints. Every label and count is fetched afresh;
  // the fresh series response must confirm the entire season-ID/order set.
  if (metadataOnly && prefetch?.tvdbId === tvdbId) yield* loginEffect(ctx);
  const [response, prefetchedMetadata] = yield* Effect.all(
    [
      seriesRequest,
      metadataOnly && prefetch?.tvdbId === tvdbId
        ? resolveGuideMetadataEffect(parallelCtx, prefetch.seasons, titles)
        : Effect.succeed(undefined),
    ],
    { concurrency: 2 },
  );
  let payload = response;
  if (!pinned?.tvdbId && pinned?.hintId === tvdbId) {
    const candidate = record(payload.data);
    // An external ID is a hint, never a manually pinned mapping. Validate TVDB's
    // identity and reject contradictory remote IDs before using the response.
    const match = selectTitleMatch(
      [{ ...candidate, id: String(candidate.id), type: 'series', remote_ids: candidate.remoteIds }],
      tmdbId,
      titles,
      'series',
    );
    if (integer(candidate.id) !== tvdbId || !match) {
      tvdbId = yield* lookup(new Set([tvdbId]));
      if (!tvdbId) return null;
      payload = yield* requestEffect(ctx, extendedPath(tvdbId));
    }
  }
  const data = record(payload.data);
  captureCharacters?.(mapCharacterArtwork(data));
  const genreNames = records(data.genres).flatMap((genre) => {
    const name = text(genre.name);
    return name ? [name] : [];
  });
  // A previously matched anime can lose its Anime tag when TVDB recreates it.
  if (!isAnime(genreNames) && !(pinned?.tvdbId && genreNames.includes('Animation'))) return null;
  const rawSeasons = yield* Schema.decodeUnknownEffect(providerRecords)(data.seasons).pipe(
    Effect.mapError(
      () =>
        new ProviderIntegrationFailure({
          provider: 'tvdb',
          message: 'TVDB returned malformed data',
        }),
    ),
  );
  const seasonRecords = rawSeasons.flatMap((entry) => {
    const season = mapSeason(entry);
    return season ? [season] : [];
  });
  const order = pinned?.order ?? selectSeasonOrder(seasonRecords, integer(data.defaultSeasonType));
  const selectedSeasons = seasonRecords
    .filter((season) => season.type === order)
    .sort((left, right) => left.number - right.number);
  const selectedSeason = selectedSeasons.find((season) => season.number > 0)?.number;
  const loadSelectedEpisodes =
    !metadataOnly &&
    selectedSeason !== undefined &&
    (requestedSeason === undefined || requestedSeason === selectedSeason);
  const catalogOrder = order === 'official' && integer(data.defaultSeasonType) === 1;
  const [names, counts, catalog] = metadataOnly
    ? yield* (
        prefetchedMetadata &&
        prefetch?.tvdbId === tvdbId &&
        prefetch.order === order &&
        prefetch.seasons.length === selectedSeasons.length &&
        selectedSeasons.every((season) =>
          prefetch.seasons.some(
            (previous) => previous.id === season.id && previous.number === season.number,
          ),
        )
          ? resolveGuideMetadataEffect(
              parallelCtx,
              selectedSeasons,
              titles,
              prefetchedMetadata.responses,
            )
          : resolveGuideMetadataEffect(parallelCtx, selectedSeasons, titles)
      ).pipe(Effect.map((metadata) => [metadata.names, metadata.counts, undefined] as const))
    : yield* Effect.all(
        [
          translateSeasonNamesEffect(parallelCtx, selectedSeasons, titles),
          catalogOrder
            ? Effect.succeed(new Map<number, number>())
            : resolveSeasonCountsEffect(
                parallelCtx,
                selectedSeasons.filter(
                  (season) => !loadSelectedEpisodes || season.number !== selectedSeason,
                ),
              ),
          catalogOrder || loadSelectedEpisodes
            ? fetchEpisodesEffect(
                parallelCtx,
                tvdbId,
                order,
                catalogOrder ? undefined : selectedSeason,
              )
            : Effect.succeed(undefined),
        ],
        { concurrency: 3 },
      );
  if (catalogOrder && catalog) {
    for (const season of selectedSeasons) counts.set(season.number, 0);
    for (const episode of releasedEpisodes(catalog))
      counts.set(episode.season, (counts.get(episode.season) ?? 0) + 1);
  }
  const selectedEpisodes =
    loadSelectedEpisodes && catalog ? episodesForSeason(catalog, selectedSeason) : undefined;
  const details: AnimeDetails = {
    characters: mapCharacterArtwork(data),
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
  return {
    details,
    episodes: selectedEpisodes,
    seasonIds: selectedSeasons.map((season) => ({ id: season.id, season: season.number })),
  };
});

/** A season's English label and complete identity list share one provider response.
 * Count by the selected season ID, so alternate-order episode coordinates remain safe.
 * Episode descriptions/translations are fetched separately after metadata publication.
 */
const resolveGuideMetadataEffect = Effect.fnUntraced(function* (
  ctx: TvdbRequestCtx,
  seasons: SeasonRecord[],
  titles: string[],
  preloaded?: Map<number, Json>,
) {
  const names = new Map<number, string>();
  const counts = new Map<number, number>();
  const responses = new Map<number, Json>();
  yield* Effect.forEach(
    seasons.slice(0, MAX_SEASON_COUNT_REQUESTS),
    (season) => {
      let name = seasonDisplayName(
        season.number,
        season.name,
        season.translatedName ?? knownAnimeSeasonName(titles, season.number),
      );
      return Effect.gen(function* () {
        let data = preloaded?.get(season.id);
        if (!data) {
          let response = yield* providerOutcome(
            requestEffect(ctx, `/seasons/${season.id}/extended?meta=translations`),
          );
          if (!response.ok && response.error instanceof TvdbNotFoundError)
            response = yield* providerOutcome(requestEffect(ctx, `/seasons/${season.id}/extended`));
          data = response.ok ? record(response.value.data) : {};
        }
        responses.set(season.id, data);
        if (integer(data.id) !== season.id) {
          name = yield* translatedSeasonNameEffect(ctx, season, titles);
          return;
        }
        const translated = records(record(data.translations).nameTranslations).find(
          (entry) => text(entry.language) === 'eng',
        );
        const known = knownAnimeSeasonName(titles, season.number);
        const label = text(translated?.name) || season.translatedName;
        name =
          season.number === 0
            ? 'Specials'
            : seasonDisplayName(
                season.number,
                text(data.name) || season.name,
                known && (!label || /^season\s+\d+$/i.test(label)) ? known : label,
              );
        const raw = yield* Schema.decodeUnknownEffect(providerRecords)(data.episodes);
        const episodes: AnimeEpisode[] = [];
        for (const entry of raw) {
          const episode = mapEpisode(entry);
          if (!episode) return;
          episodes.push(episode);
        }
        counts.set(
          season.number,
          new Set(releasedEpisodes(episodes).map((episode) => episode.id)).size,
        );
      }).pipe(
        Effect.catch(() => Effect.void),
        Effect.ensuring(
          Effect.sync(() => {
            names.set(season.number, name);
          }),
        ),
      );
    },
    { concurrency: 24, discard: true },
  );
  // Preserve the full list when a provider exceeds the eager-work budget.
  for (const season of seasons)
    if (!names.has(season.number))
      names.set(
        season.number,
        seasonDisplayName(
          season.number,
          season.name,
          season.translatedName ?? knownAnimeSeasonName(titles, season.number),
        ),
      );
  return { names, counts, responses };
});

const resolveSeasonCountsEffect = Effect.fnUntraced(function* (
  ctx: TvdbRequestCtx,
  seasons: SeasonRecord[],
) {
  const counts = new Map<number, number>();
  const deadline = (yield* Clock.currentTimeMillis) + SEASON_COUNT_DEADLINE_MS;
  yield* Effect.forEach(
    seasons.slice(0, MAX_SEASON_COUNT_REQUESTS),
    (season) =>
      Effect.gen(function* () {
        if ((yield* Clock.currentTimeMillis) >= deadline) return;
        const payload = yield* requestEffect(ctx, `/seasons/${season.id}/extended`);
        const data = record(payload.data);
        if (integer(data.id) !== season.id) return;
        const rawEpisodes = yield* Schema.decodeUnknownEffect(providerRecords)(data.episodes);
        // The season ID identifies the chosen order, independently of episode coordinates.
        const episodes: AnimeEpisode[] = [];
        for (const entry of rawEpisodes) {
          const episode = mapEpisode(entry);
          // A filtered list cannot establish the season's complete episode count.
          if (!episode) return;
          episodes.push(episode);
        }
        counts.set(
          season.number,
          new Set(releasedEpisodes(episodes).map((episode) => episode.id)).size,
        );
      }).pipe(
        // Missing counts remain optional; interruption still propagates to sibling work.
        Effect.catch(() => Effect.void),
      ),
    { concurrency: 4, discard: true },
  );
  return counts;
});

type SnapshotActionCtx = Pick<ActionCtx, 'runQuery' | 'runMutation'>;
type StoredSnapshot = { value: unknown; refreshedAt: number } | null;
const guideSnapshotFresh = (refreshedAt: number, guide: AnimeDetails) =>
  refreshedAt >
  Date.now() -
    (guide.seasons.some((season) => season.episodeCountVerified === false)
      ? INCOMPLETE_GUIDE_SNAPSHOT_MS
      : GUIDE_SNAPSHOT_MS);
const guideSnapshotKey = (
  tmdbId: number,
  tvdbId: number,
  order: SeasonOrder,
  metadataOnly = false,
) => tvdbAnimeGuideKey(tmdbId, tvdbId, order, metadataOnly);
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
  pinned?: { tvdbId?: number; order?: SeasonOrder; hintId?: number },
  requestedSeason?: number,
  captureCharacters?: (characters: CharacterArtwork[]) => void,
  metadataOnly = false,
): Promise<AnimeDetails | null> {
  let prefetch: SeasonPrefetch | undefined;
  const knownId = pinned?.tvdbId ?? pinned?.hintId;
  if (metadataOnly && knownId) {
    const previous: StoredSnapshot = await ctx.runQuery(internal.providerSnapshots.get, {
      key: guideLookupKey(tmdbId, metadataOnly),
    });
    const identity = record(previous?.value);
    const previousOrder = text(identity.order) as SeasonOrder;
    if (
      integer(identity.tvdbId) === knownId &&
      validOrders.has(previousOrder) &&
      (!pinned?.order || pinned.order === previousOrder)
    ) {
      const seasons: SeasonRecord[] = records(identity.seasonIds).flatMap((entry) => {
        const id = integer(entry.id),
          number = integer(entry.season);
        return id !== undefined && id > 0 && number !== undefined && number >= 0
          ? [{ id, number, type: previousOrder, name: '' }]
          : [];
      });
      if (seasons.length) prefetch = { tvdbId: knownId, order: previousOrder, seasons };
    }
  }
  const resolution: AnimeResolution | null = await runTvdbEffect(
    resolveAnimeEffect(
      ctx,
      tmdbId,
      titles,
      pinned,
      requestedSeason,
      captureCharacters,
      metadataOnly,
      prefetch,
    ),
  );
  if (resolution) {
    await runProviderEffect(
      Effect.all(
        [
          attempt(() =>
            putNonFatal(ctx, {
              key: guideSnapshotKey(
                tmdbId,
                resolution.details.tvdbId,
                resolution.details.order,
                metadataOnly,
              ),
              value: resolution.details,
              metricKey: 'tvdb-guide',
            }),
          ),
          ...(!pinned?.order
            ? [
                attempt(() =>
                  putNonFatal(ctx, {
                    key: guideLookupKey(tmdbId, metadataOnly),
                    value: {
                      tvdbId: resolution.details.tvdbId,
                      order: resolution.details.order,
                      authoritativeNames: normalizedNames(titles),
                      ...(resolution.seasonIds && { seasonIds: resolution.seasonIds }),
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
      key: guideSnapshotKey(tmdbId, pinned.tvdbId, pinned.order, metadataOnly),
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
  pinned?: { tvdbId?: number; order?: SeasonOrder; hintId?: number },
  requestedSeason?: number,
  captureCharacters?: (characters: CharacterArtwork[]) => void,
  metadataOnly = false,
): Promise<AnimeDetails | null> {
  if (pinned?.tvdbId && pinned.order) {
    const key = guideSnapshotKey(tmdbId, pinned.tvdbId, pinned.order, metadataOnly);
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
      key: guideLookupKey(tmdbId, metadataOnly),
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
        key: guideSnapshotKey(tmdbId, identity.tvdbId, identity.order as SeasonOrder, metadataOnly),
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
  return refreshAnimeSnapshot(
    ctx,
    tmdbId,
    titles,
    pinned,
    requestedSeason,
    captureCharacters,
    metadataOnly,
  );
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

/** Return artwork from the same series response even when the show is not anime. */
export const refreshTitleExtras = internalAction({
  args: {
    metadataOnly: v.optional(v.boolean()),
    tvdbIdHint: v.optional(v.number()),
    tmdbId: v.number(),
    title: v.string(),
    originalTitle: v.optional(v.string()),
    tvdbId: v.optional(v.number()),
    order: v.optional(v.string()),
    force: v.optional(v.boolean()),
    requestedSeason: v.optional(v.number()),
  },
  returns: v.object({
    anime: v.union(v.null(), animeGuideValidator),
    characters: v.optional(v.array(characterArtworkValidator)),
  }),
  handler: async (ctx, args) => {
    let characters: CharacterArtwork[] | undefined;
    const pinned =
      args.tvdbId === undefined && args.tvdbIdHint === undefined
        ? undefined
        : {
            tvdbId: args.tvdbId,
            hintId: args.tvdbIdHint,
            ...(args.order && { order: validateOrder(args.order) }),
          };
    const titles = authoritativeNames(args.title, args.originalTitle);
    const load = args.force ? refreshAnimeSnapshot : animeSnapshot;
    const anime = await load(
      ctx,
      args.tmdbId,
      titles,
      pinned,
      args.requestedSeason,
      (value) => {
        characters = value;
      },
      args.metadataOnly ?? false,
    );
    return {
      anime,
      ...(characters !== undefined || anime?.characters !== undefined
        ? { characters: characters ?? anime?.characters }
        : {}),
    };
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
