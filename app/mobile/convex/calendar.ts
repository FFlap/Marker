import { getClerkUserId } from './clerkAuth';
import { type Infer, v } from 'convex/values';
import { action, internalQuery, type ActionCtx } from './_generated/server';
import { internal } from './_generated/api';
import { providerFetch } from './providerHttp';
import {
  CALENDAR_SNAPSHOT_BATCH_SIZE,
  isTruncatedSnapshot,
  putNonFatal,
} from './providerSnapshots';
import type { providerSnapshotEntryValidator } from './providerValidators';

type Snapshot = Infer<typeof providerSnapshotEntryValidator> & { refreshedAt: number };
type SnapshotMap = Map<string, Snapshot | null>;

type Json = Record<string, unknown>;
type LibraryTitle = {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath?: string;
  releaseDate?: string;
  status: 'watched' | 'watching' | 'watchlist';
};
type CalendarEvent = LibraryTitle & {
  id: string;
  date: string;
  kind: 'movie' | 'episode';
  season?: number;
  episode?: number;
  episodeName?: string;
};

const CALENDAR_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_TITLES = 100;
const string = (value: unknown) => (typeof value === 'string' ? value : undefined);
const number = (value: unknown) => (typeof value === 'number' ? value : undefined);
const records = (value: unknown): Json[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is Json => typeof entry === 'object' && entry !== null)
    : [];
const isDate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
};
const inRange = (date: string, startDate: string, endDate: string) =>
  date >= startDate && date <= endDate;

const libraryTitleValidator = v.object({
  tmdbId: v.number(),
  mediaType: v.union(v.literal('movie'), v.literal('tv')),
  title: v.string(),
  posterPath: v.optional(v.string()),
  releaseDate: v.optional(v.string()),
  status: v.union(v.literal('watched'), v.literal('watching'), v.literal('watchlist')),
});

export const libraryTitles = internalQuery({
  args: { userId: v.id('users') },
  returns: v.array(libraryTitleValidator),
  handler: async (ctx, { userId }) => {
    const groups = await Promise.all(
      (['watching', 'watchlist', 'watched'] as const).map((status) =>
        ctx.db
          .query('items')
          .withIndex('by_user_status_active', (q) =>
            q.eq('userId', userId).eq('status', status).eq('deletingAt', undefined),
          )
          .take(MAX_TITLES + 1),
      ),
    );
    const rows = groups.flat().slice(0, MAX_TITLES + 1);
    return rows.map((item) => ({
      tmdbId: item.tmdbId,
      mediaType: item.mediaType,
      title: item.title,
      ...(item.posterPath && { posterPath: item.posterPath }),
      ...(item.releaseDate && { releaseDate: item.releaseDate }),
      status: item.status as LibraryTitle['status'],
    }));
  },
});

async function request(ctx: ActionCtx, path: string) {
  const token = process.env.TMDB_API_READ_ACCESS_TOKEN;
  if (!token) throw new Error('TMDB_API_READ_ACCESS_TOKEN is not configured');
  const response = await providerFetch(
    `https://api.themoviedb.org/3${path}`,
    { headers: { Authorization: `Bearer ${token}`, accept: 'application/json' } },
    {
      provider: 'tmdb',
      operation: path.split('?')[0],
      beforeRequest: () =>
        ctx.runMutation(internal.providerRateLimits.consumeGlobalProviderLimiter, {
          provider: 'tmdb',
        }),
    },
  );
  if (!response.ok) throw new Error(`TMDB calendar request failed (${response.status})`);
  return (await response.json()) as Json;
}

async function cached<T>(
  ctx: ActionCtx,
  key: string,
  load: () => Promise<T>,
  onFailure: () => void,
  snapshots?: SnapshotMap,
) {
  const stored = snapshots?.has(key)
    ? snapshots.get(key)
    : await ctx.runQuery(internal.providerSnapshots.get, { key });
  if (
    stored &&
    !isTruncatedSnapshot(stored.value) &&
    stored.refreshedAt > Date.now() - CALENDAR_TTL_MS
  )
    return stored.value as T;
  try {
    const value = await load();
    await putNonFatal(ctx, { key, value, metricKey: 'calendar' });
    return value;
  } catch (error) {
    if (!stored || isTruncatedSnapshot(stored.value)) throw error;
    onFailure();
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
    (fallback && isDate(fallback) && inRange(fallback, startDate, endDate) ? fallback : undefined)
  );
}

const normalizedMovieReleases = (payload: Json, region: string) => {
  const regional = records(payload.results).find(
    (result) => string(result.iso_3166_1)?.toUpperCase() === region,
  );
  return records(regional?.release_dates).flatMap((release) => {
    const date = string(release.release_date)?.slice(0, 10);
    const type = number(release.type);
    return date && isDate(date)
      ? [{ date, priority: type === 3 ? 0 : type === 2 ? 1 : type === 4 ? 2 : 3 }]
      : [];
  });
};

// Next-episode pointers move after airing and disappear between seasons.
const normalizedTvSchedule = (payload: Json) => {
  const seasons = new Map<number, { season: number; airDate?: string }>();
  for (const entry of records(payload.seasons)) {
    const season = number(entry.season_number);
    const date = string(entry.air_date);
    if (season !== undefined)
      seasons.set(season, {
        season,
        ...(date && isDate(date) ? { airDate: date } : {}),
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
  seasons.filter((season, index) => {
    if (season.airDate && season.airDate > endDate) return false;
    const next = seasons[index + 1];
    // Specials and undated seasons can span regular season boundaries.
    return season.season === 0 || !season.airDate || !next?.airDate || next.airDate >= startDate;
  });

const normalizedSeasonEpisodes = (payload: Json, fallbackSeason: number) =>
  records(payload.episodes).flatMap((episode) => {
    const date = string(episode.air_date);
    const episodeNumber = number(episode.episode_number);
    const season = number(episode.season_number) ?? fallbackSeason;
    if (!date || !isDate(date) || episodeNumber === undefined) return [];
    return [
      {
        date,
        season,
        episode: episodeNumber,
        ...(string(episode.name) && { name: string(episode.name) }),
      },
    ];
  });

async function titleEvents(
  ctx: ActionCtx,
  item: LibraryTitle,
  startDate: string,
  endDate: string,
  region: string,
  snapshots: SnapshotMap,
  onFailure: () => void,
): Promise<CalendarEvent[]> {
  if (item.mediaType === 'movie') {
    const releases = await cached(
      ctx,
      `calendar:movie:${item.tmdbId}:${region}`,
      async () =>
        normalizedMovieReleases(await request(ctx, `/movie/${item.tmdbId}/release_dates`), region),
      onFailure,
      snapshots,
    );
    const date = movieDate(releases, startDate, endDate, item.releaseDate);
    return date && inRange(date, startDate, endDate)
      ? [{ ...item, id: `movie:${item.tmdbId}:${date}`, date, kind: 'movie' }]
      : [];
  }
  const seasons = await cached(
    ctx,
    `calendar:tv:v2:${item.tmdbId}`,
    async () => normalizedTvSchedule(await request(ctx, `/tv/${item.tmdbId}`)),
    onFailure,
    snapshots,
  );
  const relevant = relevantSeasons(seasons, startDate, endDate);
  const seasonEpisodes = [];
  for (const season of relevant) {
    try {
      const episodes = await cached(
        ctx,
        `calendar:season:${item.tmdbId}:${season.season}`,
        async () =>
          normalizedSeasonEpisodes(
            await request(ctx, `/tv/${item.tmdbId}/season/${season.season}`),
            season.season,
          ),
        onFailure,
        snapshots,
      );
      seasonEpisodes.push(...episodes);
    } catch {
      // A broken season (including specials) must not hide the rest of a show.
      onFailure();
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

export const upcoming = action({
  args: {
    startDate: v.string(),
    endDate: v.string(),
    region: v.optional(v.string()),
  },
  returns: v.object({
    events: v.array(
      v.object({
        id: v.string(),
        date: v.string(),
        kind: v.union(v.literal('movie'), v.literal('episode')),
        tmdbId: v.number(),
        mediaType: v.union(v.literal('movie'), v.literal('tv')),
        title: v.string(),
        posterPath: v.optional(v.string()),
        releaseDate: v.optional(v.string()),
        status: v.union(v.literal('watched'), v.literal('watching'), v.literal('watchlist')),
        season: v.optional(v.number()),
        episode: v.optional(v.number()),
        episodeName: v.optional(v.string()),
      }),
    ),
    truncated: v.boolean(),
    failedTitles: v.object({ count: v.number(), names: v.array(v.string()) }),
    region: v.string(),
  }),
  handler: async (ctx, { startDate, endDate, region: rawRegion }) => {
    const userId = await getClerkUserId(ctx);
    if (!userId) throw new Error('Authentication required');
    if (!isDate(startDate) || !isDate(endDate) || startDate > endDate)
      throw new Error('Invalid calendar date range');
    const rangeDays =
      (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000;
    if (rangeDays > 93) throw new Error('Calendar ranges are limited to 93 days');
    const region = /^[A-Za-z]{2}$/.test(rawRegion ?? '') ? rawRegion!.toUpperCase() : 'US';
    const loaded = (await ctx.runQuery(internal.calendar.libraryTitles, {
      userId,
    })) as LibraryTitle[];
    const items = loaded.slice(0, MAX_TITLES);
    const keys = items.map((item) =>
      item.mediaType === 'movie'
        ? `calendar:movie:${item.tmdbId}:${region}`
        : `calendar:tv:v2:${item.tmdbId}`,
    );
    const snapshots: SnapshotMap = new Map();
    await loadSnapshots(ctx, keys, snapshots);
    // Repeat visits can read all known season schedules in batches instead of
    // paying one action/query round trip per show and season.
    const seasonKeys = items.flatMap((item, index) => {
      const snapshot = snapshots.get(keys[index]);
      return snapshot?.kind === 'calendarTvSchedule'
        ? relevantSeasons(snapshot.value, startDate, endDate).map(
            ({ season }) => `calendar:season:${item.tmdbId}:${season}`,
          )
        : [];
    });
    await loadSnapshots(ctx, [...new Set(seasonKeys)], snapshots);
    const events: CalendarEvent[] = [];
    const failedNames: string[] = [];
    let failedCount = 0;
    let cursor = 0;
    // A slow title must not hold up the next batch of otherwise independent work.
    await Promise.all(
      Array.from({ length: Math.min(5, items.length) }, async () => {
        while (cursor < items.length) {
          const item = items[cursor++];
          let failed = false;
          try {
            events.push(
              ...(await titleEvents(ctx, item, startDate, endDate, region, snapshots, () => {
                failed = true;
              })),
            );
          } catch {
            failed = true;
          }
          if (failed) {
            failedCount += 1;
            if (failedNames.length < 5) failedNames.push(item.title);
          }
        }
      }),
    );
    return {
      events: events.sort(
        (left, right) =>
          left.date.localeCompare(right.date) || left.title.localeCompare(right.title),
      ),
      truncated: loaded.length > MAX_TITLES,
      failedTitles: { count: failedCount, names: failedNames },
      region,
    };
  },
});
