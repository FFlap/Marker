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
import { mediaTypeValidator, resolvedSeasonValidator } from './publicValidators';
import { findSeriesEffect } from './tvdbSeriesLookup';
import { isAnime } from './mergePolicy';
import { releasedEpisodes } from './episodeAvailability';
import { isTruncatedSnapshot, putNonFatal, SNAPSHOT_TTL_MS } from './providerSnapshots';
import { reusableCatalog } from './tvdbCatalog';
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

const TVDB_ANIME_GUIDE_VERSION = 'v15';
type TvdbRequestCtx = Pick<ActionCtx, 'runMutation' | 'runQuery'> & {
  reserveRequest?: () => Promise<boolean>;
};

const tvdbAnimeGuideKey = (tmdbId: number, tvdbId: number, order: string) =>
  `tvdb:anime:${TVDB_ANIME_GUIDE_VERSION}:${tmdbId}:${tvdbId}:${order}`;
const tvdbAnimeLookupKey = (tmdbId: number) =>
  `tvdb:anime:${TVDB_ANIME_GUIDE_VERSION}:lookup:${tmdbId}`;

const API_ROOT = 'https://api4.thetvdb.com/v4';
const GUIDE_SNAPSHOT_MS = SNAPSHOT_TTL_MS;
// This endpoint returns the whole series, not a single season. Allow long-running
// catalogs while retaining a hard request bound and the traversal deadline.
const MAX_EPISODE_CATALOG_PAGES = 100;
const EPISODE_FETCH_DEADLINE_MS = 20_000;

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

const downloadEpisodesEffect = Effect.fnUntraced(function* (
  ctx: TvdbRequestCtx,
  tvdbId: number,
  order: SeasonOrder,
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
    if (pageCount < 2 || pageCount > MAX_EPISODE_CATALOG_PAGES)
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
      if (pages.length >= MAX_EPISODE_CATALOG_PAGES || pages[pages.length - 1].entries.length === 0)
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
  return episodes;
});

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
  captureCharacters?: (characters: CharacterArtwork[]) => void,
) {
  const lookup = (excluded: Set<number> = new Set()) =>
    findSeriesEffect((path) => requestEffect(ctx, path, true), tmdbId, titles, excluded);
  let tvdbId = pinned?.tvdbId ?? pinned?.hintId ?? (yield* lookup());
  if (!tvdbId) return null;
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
  let payload = yield* seriesRequest;
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
  const details: AnimeDetails = {
    seasonRecords: selectedSeasons.map(({ id, number, name, translatedName }) => ({
      id,
      number,
      name,
      ...(translatedName && { translatedName }),
    })),
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
      name: seasonDisplayName(
        season.number,
        season.name,
        season.translatedName ?? knownAnimeSeasonName(titles, season.number),
      ),
      episodeCount: 0,
      episodeCountVerified: false,
    })),
    ...(selectedSeason !== undefined && { selectedSeason }),
  };
  return details;
});

type SnapshotActionCtx = TvdbRequestCtx;
type StoredSnapshot = { value: unknown; refreshedAt: number } | null;
const guideSnapshotKey = tvdbAnimeGuideKey;
const guideLookupKey = tvdbAnimeLookupKey;
async function refreshAnimeSnapshot(
  ctx: SnapshotActionCtx,
  tmdbId: number,
  titles: string[],
  pinned?: { tvdbId?: number; order?: SeasonOrder; hintId?: number },
  captureCharacters?: (characters: CharacterArtwork[]) => void,
): Promise<AnimeDetails | null> {
  const details: AnimeDetails | null = await runTvdbEffect(
    resolveAnimeEffect(ctx, tmdbId, titles, pinned, captureCharacters),
  );
  if (details) {
    await runProviderEffect(
      Effect.all(
        [
          attempt(() =>
            putNonFatal(ctx, {
              key: guideSnapshotKey(tmdbId, details.tvdbId, details.order),
              value: details,
              metricKey: 'tvdb-guide',
            }),
          ),
          ...(!pinned?.order
            ? [
                attempt(() =>
                  putNonFatal(ctx, {
                    key: guideLookupKey(tmdbId),
                    value: {
                      tvdbId: details.tvdbId,
                      order: details.order,
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
  return details;
}

async function animeSnapshot(
  ctx: SnapshotActionCtx,
  tmdbId: number,
  titles: string[],
  pinned?: { tvdbId?: number; order?: SeasonOrder; hintId?: number },
  captureCharacters?: (characters: CharacterArtwork[]) => void,
): Promise<AnimeDetails | null> {
  if (pinned?.tvdbId && pinned.order) {
    const key = guideSnapshotKey(tmdbId, pinned.tvdbId, pinned.order);
    const stored: StoredSnapshot = await ctx.runQuery(internal.providerSnapshots.get, { key });
    if (stored && stored.refreshedAt > Date.now() - GUIDE_SNAPSHOT_MS) {
      const value = (
        isTruncatedSnapshot(stored.value) ? null : stored.value
      ) as AnimeDetails | null;
      if (stored.value === null) return null;
      if (value?.tvdbId === pinned.tvdbId && value.order === pinned.order) return value;
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
        if (value?.tvdbId === identity.tvdbId && value.order === identity.order) return value;
      }
    }
  }
  return refreshAnimeSnapshot(ctx, tmdbId, titles, pinned, captureCharacters);
}

async function loadSeasonCatalog(
  ctx: SnapshotActionCtx,
  tvdbId: number,
  order: SeasonOrder,
  season: number,
  force = false,
): Promise<AnimeEpisode[]> {
  const catalog = await reusableCatalog(
    ctx,
    tvdbId,
    order,
    () => runTvdbEffect(downloadEpisodesEffect(ctx, tvdbId, order)),
    force,
  );
  const episodes = episodesForSeason(catalog, season);
  if (episodes.length > MAX_SEASON_EPISODES)
    throw new Error('TVDB season exceeded the safety limit');
  return episodes;
}

/** Return artwork from the same series response even when the show is not anime. */
export const refreshTitleExtras = internalAction({
  args: {
    tvdbIdHint: v.optional(v.number()),
    tmdbId: v.number(),
    title: v.string(),
    originalTitle: v.optional(v.string()),
    tvdbId: v.optional(v.number()),
    order: v.optional(v.string()),
    force: v.optional(v.boolean()),
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
    // A definitive guide miss says nothing about character artwork availability.
    const missKey = `tvdb:miss:guide:v1:${args.tmdbId}:${args.tvdbId ?? args.tvdbIdHint ?? 0}:${args.order ?? 'auto'}`;
    if (!args.force) {
      const miss = await ctx.runQuery(internal.providerSnapshots.get, { key: missKey });
      if (
        miss?.kind === 'tvdbMiss' &&
        miss.refreshedAt > Date.now() - SNAPSHOT_TTL_MS &&
        miss.value.some((name) => normalizedNames(titles).includes(name))
      )
        return { anime: null };
    }
    const load = args.force ? refreshAnimeSnapshot : animeSnapshot;
    const anime = await load(
      {
        runQuery: ctx.runQuery,
        runMutation: ctx.runMutation,
      },
      args.tmdbId,
      titles,
      pinned,
      (value) => {
        characters = value;
      },
    );
    if (!anime)
      await putNonFatal(ctx, {
        key: missKey,
        value: normalizedNames(titles),
        metricKey: 'tvdb-guide-miss',
      });
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
    loadSeasonCatalog(
      ctx,
      args.tvdbId,
      validateOrder(args.order),
      args.season,
      args.force ?? false,
    ),
});

/** Reuse title identity and the catalog loaded by episode requests; never re-resolve the title. */
export const loadSeasonSummaries = internalAction({
  args: {
    tmdbId: v.number(),
    tvdbId: v.number(),
    order: v.string(),
    title: v.string(),
    seasons: v.array(resolvedSeasonValidator),
    forceCatalog: v.optional(v.boolean()),
  },
  returns: v.array(resolvedSeasonValidator),
  handler: async (ctx, args): Promise<AnimeDetails['seasons']> => {
    const order = validateOrder(args.order);
    const [catalog, stored] = await Promise.all([
      reusableCatalog(
        ctx,
        args.tvdbId,
        order,
        () => runTvdbEffect(downloadEpisodesEffect(ctx, args.tvdbId, order)),
        args.forceCatalog ?? false,
      ),
      ctx.runQuery(internal.providerSnapshots.get, {
        key: guideSnapshotKey(args.tmdbId, args.tvdbId, order),
      }),
    ]);
    const guide = stored?.kind === 'tvdbGuide' ? stored.value : null;
    const seasons = new Set(args.seasons.map((season) => season.season));
    // The initial series response provides IDs and names, including for manual mappings.
    // If its optional cache write failed, keep the already-published names.
    const records = (guide?.seasonRecords ?? [])
      .filter((season) => seasons.has(season.number))
      .map((season) => ({ ...season, type: order }));
    const names = await runTvdbEffect(
      translateSeasonNamesEffect(
        {
          runQuery: ctx.runQuery,
          runMutation: ctx.runMutation,
          reserveRequest: batchedProviderBudget(() =>
            ctx.runMutation(internal.providerRateLimits.reserveProviderBudget, {
              provider: 'tvdb',
            }),
          ),
        },
        records,
        [args.title],
      ),
    );
    const counts = new Map<number, number>();
    for (const episode of releasedEpisodes(catalog))
      counts.set(episode.season, (counts.get(episode.season) ?? 0) + 1);
    return args.seasons.map((season) => ({
      ...season,
      name: names.get(season.season) ?? season.name,
      episodeCount: counts.get(season.season) ?? 0,
      episodeCountVerified: true,
    }));
  },
});
