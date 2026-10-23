import { Clock, Effect, Predicate } from 'effect';
import { ActionCallFailure, actionFailureCause, attempt, providerOutcome } from './actionEffects';
import { ConvexError, type Infer } from 'convex/values';
import type { ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import {
  providerFetchEffect,
  decodeProviderObject,
  runProviderEffect,
  providerBoundaryFailure,
  ProviderIntegrationFailure,
} from './providerHttp';
import {
  CALENDAR_SNAPSHOT_BATCH_SIZE,
  isTruncatedSnapshot,
  putNonFatal,
} from './providerSnapshots';
import type { providerSnapshotEntryValidator } from './providerValidators';
import {
  CALENDAR_TTL_MS,
  isDate,
  inRange,
  type LibraryTitle,
  type CalendarEvent,
} from './calendarTypes';
type Snapshot = Infer<typeof providerSnapshotEntryValidator> & { refreshedAt: number };
type SnapshotMap = Map<string, Snapshot | null>;
type CacheRead = {
  cachedOnly: boolean;
  hasSavedSchedule: boolean;
  needsRefresh: boolean;
  refreshedAt: number;
};
class MissingSchedule extends Error {}
type Json = Record<string, unknown>;
const string = (value: unknown) => (typeof value === 'string' ? value : undefined);
const number = (value: unknown) => (typeof value === 'number' ? value : undefined);
const records = (value: unknown): Json[] =>
  Array.isArray(value) ? value.filter((entry): entry is Json => Predicate.isObject(entry)) : [];
const requiredRecords = (value: unknown, label: string): Json[] => {
  if (!Array.isArray(value) || records(value).length !== value.length)
    throw new ProviderIntegrationFailure({
      provider: 'tmdb',
      message: `Invalid TMDB ${label} response`,
    });
  return value as Json[];
};
export function createRequestEffect(ctx: ActionCtx, reservationSize = 5) {
  let budgetQueue: Promise<unknown> = Promise.resolve();
  let reserved = 0;
  let limitedUntil = 0;
  const beforeRequest = () => {
    // Provider fetches can overlap, but this action must not race itself on
    // the shared rate-limit document. Other actions are covered by retries.
    const pending = budgetQueue.then(async () => {
      if (Date.now() < limitedUntil) return false;
      if (reserved > 0) {
        reserved--;
        return true;
      }
      const granted = await ctx.runMutation(
        internal.providerRateLimits.consumeGlobalProviderLimiter,
        {
          provider: 'tmdb',
          amount: reservationSize,
        },
      );
      if (granted) {
        reserved = reservationSize - 1;
        return true;
      }
      if (
        reservationSize > 1 &&
        (await ctx.runMutation(internal.providerRateLimits.consumeGlobalProviderLimiter, {
          provider: 'tmdb',
        }))
      )
        return true;
      limitedUntil = Date.now() + 60_000;
      return false;
    });
    budgetQueue = pending.catch(() => undefined);
    return pending;
  };
  return Effect.fnUntraced(function* (path: string) {
    const token = process.env.TMDB_API_READ_ACCESS_TOKEN;
    if (!token)
      return yield* Effect.fail(
        new ProviderIntegrationFailure({
          provider: 'tmdb',
          message: 'TMDB_API_READ_ACCESS_TOKEN is not configured',
        }),
      );
    const response = yield* providerFetchEffect(
      `https://api.themoviedb.org/3${path}`,
      { headers: { Authorization: `Bearer ${token}`, accept: 'application/json' } },
      { provider: 'tmdb', operation: path.split('?')[0], beforeRequest },
    );
    if (!response.ok)
      return yield* Effect.fail(
        new ProviderIntegrationFailure({
          provider: 'tmdb',
          message: `TMDB calendar request failed (${response.status})`,
        }),
      );
    return yield* decodeProviderObject(response, 'tmdb');
  });
}

// Kept for existing Promise callers; internal calendar composition uses the effect factory.
export function createRequest(ctx: ActionCtx, reservationSize = 5) {
  const request = createRequestEffect(ctx, reservationSize);
  return (path: string) => runProviderEffect(request(path));
}

const cached = Effect.fnUntraced(function* <T, E>(
  ctx: ActionCtx,
  key: string,
  load: () => Effect.Effect<T, E>,
  onFailure: (error: unknown) => void,
  snapshots: SnapshotMap,
  read: CacheRead,
): Effect.fn.Return<T, E | ActionCallFailure | MissingSchedule> {
  const stored: Snapshot | null | undefined = snapshots.has(key)
    ? snapshots.get(key)
    : yield* attempt(() => ctx.runQuery(internal.providerSnapshots.get, { key }));
  if (
    stored &&
    !isTruncatedSnapshot(stored.value) &&
    stored.refreshedAt > (yield* Clock.currentTimeMillis) - CALENDAR_TTL_MS
  ) {
    read.refreshedAt = Math.min(read.refreshedAt, stored.refreshedAt);
    return stored.value as T;
  }
  if (read.cachedOnly) {
    read.needsRefresh = true;
    if (stored && !isTruncatedSnapshot(stored.value)) {
      read.refreshedAt = Math.min(read.refreshedAt, stored.refreshedAt);
      return stored.value as T;
    }
    return yield* Effect.fail(new MissingSchedule());
  }
  return yield* Effect.gen(function* () {
    const value = yield* load();
    yield* attempt(() => putNonFatal(ctx, { key, value, metricKey: 'calendar' }));
    return value;
  }).pipe(
    Effect.catch((error) => {
      if (read.hasSavedSchedule || !stored || isTruncatedSnapshot(stored.value))
        return Effect.fail(error);
      onFailure(error);
      read.refreshedAt = Math.min(read.refreshedAt, stored.refreshedAt);
      return Effect.succeed(stored.value as T);
    }),
  );
});

function loadSnapshots(
  ctx: ActionCtx,
  keys: string[],
  snapshots: SnapshotMap,
): Effect.Effect<void, ActionCallFailure> {
  return Effect.forEach(
    Array.from({ length: Math.ceil(keys.length / CALENDAR_SNAPSHOT_BATCH_SIZE) }, (_, i) =>
      keys.slice(i * CALENDAR_SNAPSHOT_BATCH_SIZE, (i + 1) * CALENDAR_SNAPSHOT_BATCH_SIZE),
    ),
    (batch) =>
      attempt(() =>
        ctx.runQuery(internal.providerSnapshots.getCalendarSnapshots, { keys: batch }),
      ).pipe(
        Effect.map((stored) =>
          batch.forEach((key, index) => {
            const snapshot = stored[index];
            snapshots.set(
              key,
              snapshot ? { ...snapshot.entry, refreshedAt: snapshot.refreshedAt } : null,
            );
          }),
        ),
      ),
    { concurrency: 4, discard: true },
  );
}

/** Only explicit provider-validation failures enter the optional fallback channel. */
const parseCalendar = <A>(parse: () => A) =>
  Effect.try({ try: parse, catch: (error) => error }).pipe(
    Effect.catch((error) =>
      error instanceof ProviderIntegrationFailure ? Effect.fail(error) : Effect.die(error),
    ),
  );

function movieDate(
  candidates: { date: string; priority: number }[],
  startDate: string,
  endDate: string,
  fallback?: string,
) {
  const inWindow = candidates
    .filter(({ date }) => inRange(date, startDate, endDate))
    .sort((left, right) => left.priority - right.priority || left.date.localeCompare(right.date));
  return (
    inWindow[0]?.date ??
    (!candidates.length && fallback && isDate(fallback) && inRange(fallback, startDate, endDate)
      ? fallback
      : undefined)
  );
}

const normalizedMovieReleases = (payload: Json, region: string) => {
  const regional = requiredRecords(payload.results, 'movie release dates').find(
    (result) => string(result.iso_3166_1)?.toUpperCase() === region,
  );
  return (
    regional ? requiredRecords(regional.release_dates, 'regional release dates') : []
  ).flatMap((release) => {
    const date = string(release.release_date)?.slice(0, 10);
    const type = number(release.type);
    return date && isDate(date)
      ? [{ date, priority: type === 3 ? 0 : type === 2 ? 1 : type === 4 ? 2 : 3 }]
      : [];
  });
};

const normalizedTvSchedule = (payload: Json) => {
  const seasons = new Map<number, { season: number; airDate?: string; lastAirDate?: string }>();
  const last = records([payload.last_episode_to_air])[0];
  for (const entry of requiredRecords(payload.seasons, 'TV seasons')) {
    const season = number(entry.season_number);
    if (season === undefined || !Number.isInteger(season) || season < 0)
      throw new ProviderIntegrationFailure({
        provider: 'tmdb',
        message: 'Invalid TMDB season number',
      });
    const date = string(entry.air_date);
    const lastDate = string(last?.air_date);
    const completed =
      season !== 0 &&
      season === number(last?.season_number) &&
      number(entry.episode_count) === number(last?.episode_number) &&
      number(entry.episode_count) !== undefined &&
      lastDate &&
      isDate(lastDate);
    if (season !== undefined)
      seasons.set(season, {
        season,
        ...(date && isDate(date) ? { airDate: date } : {}),
        ...(completed ? { lastAirDate: lastDate } : {}),
      });
  }
  for (const entry of records([payload.last_episode_to_air, payload.next_episode_to_air])) {
    const season = number(entry.season_number);
    if (season !== undefined && !seasons.has(season)) seasons.set(season, { season });
  }
  return [...seasons.values()].sort((a, b) => a.season - b.season);
};

const relevantSeasons = (
  seasons: ReturnType<typeof normalizedTvSchedule>,
  startDate: string,
  endDate: string,
) =>
  seasons.filter((season) => {
    if (season.airDate && season.airDate > endDate) return false;
    if (season.lastAirDate && season.lastAirDate < startDate) return false;
    // A later season's premiere is not an end date for this season. Episodes
    // can air out of order or overlap; only an observed final air date excludes it.
    return true;
  });

const normalizedSeasonEpisodes = (payload: Json, fallbackSeason: number) =>
  requiredRecords(payload.episodes, 'season episodes').flatMap((episode) => {
    const date = string(episode.air_date);
    const episodeNumber = number(episode.episode_number);
    const season = number(episode.season_number) ?? fallbackSeason;
    if (!date || !isDate(date)) return [];
    if (
      episodeNumber === undefined ||
      !Number.isInteger(episodeNumber) ||
      episodeNumber < 0 ||
      !Number.isInteger(season) ||
      season < 0
    )
      throw new ProviderIntegrationFailure({
        provider: 'tmdb',
        message: 'Invalid TMDB episode number',
      });
    return [
      {
        date,
        season,
        episode: episodeNumber,
        ...(string(episode.name) && { name: string(episode.name) }),
      },
    ];
  });

function seasonLoader(
  tmdbId: number,
  missing: number[],
  request: ReturnType<typeof createRequestEffect>,
) {
  const batches = new Map<number, number[]>();
  // Memoize successes and expected failures without leaving the calling fiber.
  const completed = new Map<number, ReturnType<ReturnType<typeof createRequestEffect>>>();
  for (let offset = 0; offset < missing.length; offset += 5) {
    const batch = missing.slice(offset, offset + 5);
    for (const season of batch) batches.set(season, batch);
  }
  return (season: number) =>
    Effect.gen(function* () {
      const batch = batches.get(season) ?? [season];
      if (batch.length === 1) return yield* request(`/tv/${tmdbId}/season/${season}`);
      const key = batch[0];
      let response = completed.get(key);
      if (!response) {
        response = yield* Effect.cached(
          request(
            `/tv/${tmdbId}?append_to_response=${batch.map((number) => `season/${number}`).join(',')}`,
          ),
        );
        completed.set(key, response);
      }
      const payload = (yield* response)[`season/${season}`];
      if (
        !payload ||
        typeof payload !== 'object' ||
        !('episodes' in payload) ||
        !Array.isArray(payload.episodes)
      )
        return yield* Effect.fail(
          new ProviderIntegrationFailure({
            provider: 'tmdb',
            message: `TMDB did not return season ${season}`,
          }),
        );
      return payload as Json;
    });
}

const titleEvents = Effect.fnUntraced(function* (
  ctx: ActionCtx,
  item: LibraryTitle,
  startDate: string,
  endDate: string,
  region: string,
  snapshots: SnapshotMap,
  onFailure: (error: unknown) => void,
  request: ReturnType<typeof createRequestEffect>,
  read: CacheRead,
  missingSeasons: number[],
) {
  if (item.mediaType === 'movie') {
    const releases = yield* cached(
      ctx,
      `calendar:movie:${item.tmdbId}:${region}`,
      () =>
        request(`/movie/${item.tmdbId}/release_dates`).pipe(
          Effect.flatMap((payload) =>
            parseCalendar(() => normalizedMovieReleases(payload, region)),
          ),
        ),
      onFailure,
      snapshots,
      read,
    );
    const date = movieDate(releases, startDate, endDate, item.releaseDate);
    return date && inRange(date, startDate, endDate)
      ? [{ ...item, id: `movie:${item.tmdbId}:${date}`, date, kind: 'movie' as const }]
      : [];
  }
  const seasons = yield* cached(
    ctx,
    `calendar:tv:v2:${item.tmdbId}`,
    () =>
      request(`/tv/${item.tmdbId}`).pipe(
        Effect.flatMap((payload) => parseCalendar(() => normalizedTvSchedule(payload))),
      ),
    onFailure,
    snapshots,
    read,
  );
  const relevant = relevantSeasons(seasons, startDate, endDate);
  yield* loadSnapshots(
    ctx,
    relevant
      .map(({ season }) => `calendar:season:${item.tmdbId}:${season}`)
      .filter((key) => !snapshots.has(key)),
    snapshots,
  );
  const now = yield* Clock.currentTimeMillis;
  const missing = relevant.filter(({ season }) => {
    const stored = snapshots.get(`calendar:season:${item.tmdbId}:${season}`);
    return (
      !stored || isTruncatedSnapshot(stored.value) || stored.refreshedAt <= now - CALENDAR_TTL_MS
    );
  });
  const loadSeason = seasonLoader(
    item.tmdbId,
    missing.map(({ season }) => season),
    request,
  );
  const seasonEpisodes = [];
  for (const season of relevant) {
    const outcome = yield* providerOutcome(
      cached(
        ctx,
        `calendar:season:${item.tmdbId}:${season.season}`,
        () =>
          loadSeason(season.season).pipe(
            Effect.flatMap((payload) =>
              parseCalendar(() => normalizedSeasonEpisodes(payload, season.season)),
            ),
          ),
        onFailure,
        snapshots,
        read,
      ),
    );
    if (outcome.ok) seasonEpisodes.push(...outcome.value);
    else {
      missingSeasons.push(season.season);
      onFailure(outcome.error);
    }
  }
  return seasonEpisodes.flatMap((episode) => {
    if (!inRange(episode.date, startDate, endDate)) return [];
    return [
      {
        ...item,
        id: `episode:${item.tmdbId}:${episode.season}:${episode.episode}:${episode.date}`,
        date: episode.date,
        kind: 'episode' as const,
        season: episode.season,
        episode: episode.episode,
        ...(episode.name && { episodeName: episode.name }),
      },
    ];
  });
});

export async function loadTitleSchedules(
  ctx: ActionCtx,
  items: { item: LibraryTitle; hasSavedSchedule: boolean }[],
  startDate: string,
  endDate: string,
  region: string,
  cachedOnly: boolean,
) {
  return runProviderEffect(
    loadTitleSchedulesEffect(ctx, items, startDate, endDate, region, cachedOnly),
  );
}

export const loadTitleSchedulesEffect = Effect.fnUntraced(function* (
  ctx: ActionCtx,
  items: { item: LibraryTitle; hasSavedSchedule: boolean }[],
  startDate: string,
  endDate: string,
  region: string,
  cachedOnly: boolean,
) {
  const request = createRequestEffect(ctx, Math.min(5, items.length) || 1);
  const snapshots: SnapshotMap = new Map();
  const keys = items.map(({ item }) =>
    item.mediaType === 'movie'
      ? `calendar:movie:${item.tmdbId}:${region}`
      : `calendar:tv:v2:${item.tmdbId}`,
  );
  yield* loadSnapshots(ctx, keys, snapshots);
  yield* loadSnapshots(
    ctx,
    [
      ...new Set(
        items.flatMap(({ item }, index) => {
          const snapshot = snapshots.get(keys[index]);
          return snapshot?.kind === 'calendarTvSchedule'
            ? relevantSeasons(snapshot.value, startDate, endDate).map(
                ({ season }) => `calendar:season:${item.tmdbId}:${season}`,
              )
            : [];
        }),
      ),
    ],
    snapshots,
  );
  const results: {
    item: LibraryTitle;
    events: CalendarEvent[];
    failed: boolean;
    missingSeasons: number[];
    unavailableTitle: boolean;
    needsRefresh: boolean;
    refreshedAt: number;
  }[] = [];
  let retryAfterMs: number | undefined;
  yield* Effect.forEach(
    items,
    ({ item, hasSavedSchedule }) =>
      Effect.gen(function* () {
        const read = {
          cachedOnly,
          hasSavedSchedule,
          needsRefresh: false,
          refreshedAt: yield* Clock.currentTimeMillis,
        };
        let failed = false;
        const onFailure = (failure: unknown) => {
          const error = providerBoundaryFailure(actionFailureCause(failure));
          if (error instanceof MissingSchedule) return;
          failed = true;
          if (
            error instanceof ConvexError &&
            typeof error.data === 'object' &&
            error.data?.code === 'provider_global_limiter'
          )
            retryAfterMs = 60_000;
        };
        let events: CalendarEvent[] = [];
        const missingSeasons: number[] = [];
        let unavailableTitle = false;
        const outcome = yield* providerOutcome(
          titleEvents(
            ctx,
            item,
            startDate,
            endDate,
            region,
            snapshots,
            onFailure,
            request,
            read,
            missingSeasons,
          ),
        );
        if (outcome.ok) events = outcome.value;
        else {
          unavailableTitle = true;
          onFailure(outcome.error);
        }
        results.push({
          item,
          events,
          failed,
          missingSeasons,
          unavailableTitle,
          needsRefresh: read.needsRefresh,
          refreshedAt: read.refreshedAt,
        });
      }),
    { concurrency: 10, discard: true },
  );
  return { results, retryAfterMs };
});
