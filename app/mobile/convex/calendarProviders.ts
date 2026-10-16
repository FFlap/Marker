import { ConvexError, type Infer } from 'convex/values';
import type { ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import { providerFetch } from './providerHttp';
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
type CacheRead = { cachedOnly: boolean; needsRefresh: boolean; refreshedAt: number };
class MissingSchedule extends Error {}
type Json = Record<string, unknown>;
const string = (value: unknown) => (typeof value === 'string' ? value : undefined);
const number = (value: unknown) => (typeof value === 'number' ? value : undefined);
const records = (value: unknown): Json[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is Json =>
          typeof entry === 'object' && entry !== null && !Array.isArray(entry),
      )
    : [];
const requiredRecords = (value: unknown, label: string): Json[] => {
  if (!Array.isArray(value) || records(value).length !== value.length)
    throw new Error(`Invalid TMDB ${label} response`);
  return value as Json[];
};
export function createRequest(ctx: ActionCtx, reservationSize = 5) {
  let budgetQueue: Promise<unknown> = Promise.resolve();
  let reserved = 0;
  const beforeRequest = () => {
    // Provider fetches can overlap, but this action must not race itself on
    // the shared rate-limit document. Other actions are covered by retries.
    const pending = budgetQueue.then(async () => {
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
      // Use the tail of a nearly exhausted window without exceeding it.
      return ctx.runMutation(internal.providerRateLimits.consumeGlobalProviderLimiter, {
        provider: 'tmdb',
      });
    });
    budgetQueue = pending.catch(() => undefined);
    return pending;
  };
  return async (path: string) => {
    const token = process.env.TMDB_API_READ_ACCESS_TOKEN;
    if (!token) throw new Error('TMDB_API_READ_ACCESS_TOKEN is not configured');
    const response = await providerFetch(
      `https://api.themoviedb.org/3${path}`,
      { headers: { Authorization: `Bearer ${token}`, accept: 'application/json' } },
      {
        provider: 'tmdb',
        operation: path.split('?')[0],
        beforeRequest,
      },
    );
    if (!response.ok) throw new Error(`TMDB calendar request failed (${response.status})`);
    return (await response.json()) as Json;
  };
}

async function cached<T>(
  ctx: ActionCtx,
  key: string,
  load: () => Promise<T>,
  onFailure: (error: unknown) => void,
  snapshots: SnapshotMap,
  read: CacheRead,
) {
  const stored = snapshots?.has(key)
    ? snapshots.get(key)
    : await ctx.runQuery(internal.providerSnapshots.get, { key });
  if (
    stored &&
    !isTruncatedSnapshot(stored.value) &&
    stored.refreshedAt > Date.now() - CALENDAR_TTL_MS
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
    throw new MissingSchedule();
  }
  try {
    const value = await load();
    await putNonFatal(ctx, { key, value, metricKey: 'calendar' });
    return value;
  } catch (error) {
    if (!stored || isTruncatedSnapshot(stored.value)) throw error;
    onFailure(error);
    read.refreshedAt = Math.min(read.refreshedAt, stored.refreshedAt);
    return stored.value as T;
  }
}

async function loadSnapshots(ctx: ActionCtx, keys: string[], snapshots: SnapshotMap) {
  await Promise.all(
    Array.from({ length: Math.ceil(keys.length / CALENDAR_SNAPSHOT_BATCH_SIZE) }, async (_, i) => {
      const batch = keys.slice(
        i * CALENDAR_SNAPSHOT_BATCH_SIZE,
        (i + 1) * CALENDAR_SNAPSHOT_BATCH_SIZE,
      );
      const stored = await ctx.runQuery(internal.providerSnapshots.getCalendarSnapshots, {
        keys: batch,
      });
      batch.forEach((key, index) => {
        const snapshot = stored[index];
        snapshots.set(
          key,
          snapshot ? { ...snapshot.entry, refreshedAt: snapshot.refreshedAt } : null,
        );
      });
    }),
  );
}

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

// Next-episode pointers move after airing and disappear between seasons.
const normalizedTvSchedule = (payload: Json) => {
  const seasons = new Map<number, { season: number; airDate?: string; lastAirDate?: string }>();
  const last = records([payload.last_episode_to_air])[0];
  for (const entry of requiredRecords(payload.seasons, 'TV seasons')) {
    const season = number(entry.season_number);
    if (season === undefined || !Number.isInteger(season) || season < 0)
      throw new Error('Invalid TMDB season number');
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
    // An episode date must not be used as a season's start date.
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
      throw new Error('Invalid TMDB episode number');
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
  request: ReturnType<typeof createRequest>,
) {
  const batches = new Map<number, number[]>();
  const pending = new Map<number, Promise<Json>>();
  for (let offset = 0; offset < missing.length; offset += 5) {
    const batch = missing.slice(offset, offset + 5);
    for (const season of batch) batches.set(season, batch);
  }
  return async (season: number) => {
    const batch = batches.get(season) ?? [season];
    if (batch.length === 1) return request(`/tv/${tmdbId}/season/${season}`);
    const key = batch[0];
    let response = pending.get(key);
    if (!response) {
      response = request(
        `/tv/${tmdbId}?append_to_response=${batch.map((number) => `season/${number}`).join(',')}`,
      );
      pending.set(key, response);
    }
    const payload = (await response)[`season/${season}`];
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('episodes' in payload) ||
      !Array.isArray(payload.episodes)
    )
      throw new Error(`TMDB did not return season ${season}`);
    return payload as Json;
  };
}

async function titleEvents(
  ctx: ActionCtx,
  item: LibraryTitle,
  startDate: string,
  endDate: string,
  region: string,
  snapshots: SnapshotMap,
  onFailure: (error: unknown) => void,
  request: ReturnType<typeof createRequest>,
  read: CacheRead,
  missingSeasons: number[],
): Promise<CalendarEvent[]> {
  if (item.mediaType === 'movie') {
    const releases = await cached(
      ctx,
      `calendar:movie:${item.tmdbId}:${region}`,
      async () =>
        normalizedMovieReleases(await request(`/movie/${item.tmdbId}/release_dates`), region),
      onFailure,
      snapshots,
      read,
    );
    const date = movieDate(releases, startDate, endDate, item.releaseDate);
    return date && inRange(date, startDate, endDate)
      ? [{ ...item, id: `movie:${item.tmdbId}:${date}`, date, kind: 'movie' }]
      : [];
  }
  const seasons = await cached(
    ctx,
    `calendar:tv:v2:${item.tmdbId}`,
    async () => normalizedTvSchedule(await request(`/tv/${item.tmdbId}`)),
    onFailure,
    snapshots,
    read,
  );
  const relevant = relevantSeasons(seasons, startDate, endDate);
  await loadSnapshots(
    ctx,
    relevant
      .map(({ season }) => `calendar:season:${item.tmdbId}:${season}`)
      .filter((key) => !snapshots.has(key)),
    snapshots,
  );
  const missing = relevant.filter(({ season }) => {
    const stored = snapshots.get(`calendar:season:${item.tmdbId}:${season}`);
    return (
      !stored ||
      isTruncatedSnapshot(stored.value) ||
      stored.refreshedAt <= Date.now() - CALENDAR_TTL_MS
    );
  });
  const loadSeason = seasonLoader(
    item.tmdbId,
    missing.map(({ season }) => season),
    request,
  );
  const seasonEpisodes = [];
  for (const season of relevant) {
    try {
      const episodes = await cached(
        ctx,
        `calendar:season:${item.tmdbId}:${season.season}`,
        async () => normalizedSeasonEpisodes(await loadSeason(season.season), season.season),
        onFailure,
        snapshots,
        read,
      );
      seasonEpisodes.push(...episodes);
    } catch (error) {
      // Only this season needs saved-release fallback.
      missingSeasons.push(season.season);
      onFailure(error);
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
}

/** Resolve only the titles selected by the date index, preserving batched provider cache reads. */
export async function loadTitleSchedules(
  ctx: ActionCtx,
  items: LibraryTitle[],
  startDate: string,
  endDate: string,
  region: string,
  cachedOnly: boolean,
) {
  const request = createRequest(ctx);
  const snapshots: SnapshotMap = new Map();
  const keys = items.map((item) =>
    item.mediaType === 'movie'
      ? `calendar:movie:${item.tmdbId}:${region}`
      : `calendar:tv:v2:${item.tmdbId}`,
  );
  await loadSnapshots(ctx, keys, snapshots);
  await loadSnapshots(
    ctx,
    [
      ...new Set(
        items.flatMap((item, index) => {
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
  let cursor = 0;
  let retryAfterMs: number | undefined;
  await Promise.all(
    Array.from({ length: Math.min(10, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        const read = { cachedOnly, needsRefresh: false, refreshedAt: Date.now() };
        let failed = false;
        const onFailure = (error: unknown) => {
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
        try {
          events = await titleEvents(
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
          );
        } catch (error) {
          unavailableTitle = true;
          onFailure(error);
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
      }
    }),
  );
  return { results, retryAfterMs };
}
