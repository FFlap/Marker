import { getClerkUserId } from './clerkAuth';
import { v } from 'convex/values';
import { action, internalQuery } from './_generated/server';
import { internal } from './_generated/api';
import { providerFetch } from './providerHttp';
import { putNonFatal } from './providerSnapshots';

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
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const inRange = (date: string, startDate: string, endDate: string) =>
  date >= startDate && date <= endDate;

export const libraryTitles = internalQuery({
  args: { userId: v.id('users') },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query('items')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .filter((q) =>
        q.and(q.eq(q.field('deletingAt'), undefined), q.neq(q.field('status'), 'dropped')),
      )
      .take(MAX_TITLES + 1);
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

async function request(ctx: { runMutation: Function }, path: string) {
  const token = process.env.TMDB_API_READ_ACCESS_TOKEN;
  if (!token) throw new Error('TMDB_API_READ_ACCESS_TOKEN is not configured');
  const response = await providerFetch(
    `https://api.themoviedb.org/3${path}`,
    { headers: { Authorization: `Bearer ${token}`, accept: 'application/json' } },
    {
      provider: 'tmdb',
      operation: path.split('?')[0],
      beforeRequest: () =>
        ctx.runMutation(internal.tmdb.consumeGlobalProviderLimiter, { provider: 'tmdb' }),
    },
  );
  if (!response.ok) throw new Error(`TMDB calendar request failed (${response.status})`);
  return (await response.json()) as Json;
}

async function cached<T>(
  ctx: { runQuery: Function; runMutation: Function },
  key: string,
  load: () => Promise<T>,
) {
  const stored = await ctx.runQuery(internal.providerSnapshots.get, { key });
  if (stored && stored.refreshedAt > Date.now() - CALENDAR_TTL_MS) return stored.value as T;
  const value = await load();
  await putNonFatal(ctx, { key, value, metricKey: 'calendar' });
  return value;
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

const normalizedTvNext = (payload: Json) => {
  const next = payload.next_episode_to_air as Json | undefined;
  const airDate = string(next?.air_date);
  const season = number(next?.season_number);
  return airDate && isDate(airDate) && season !== undefined ? { airDate, season } : null;
};

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
  ctx: { runQuery: Function; runMutation: Function },
  item: LibraryTitle,
  startDate: string,
  endDate: string,
  region: string,
): Promise<CalendarEvent[]> {
  if (item.mediaType === 'movie') {
    const releases = await cached(ctx, `calendar:movie:${item.tmdbId}:${region}`, async () =>
      normalizedMovieReleases(await request(ctx, `/movie/${item.tmdbId}/release_dates`), region),
    );
    const date = movieDate(releases, startDate, endDate, item.releaseDate);
    return date && inRange(date, startDate, endDate)
      ? [{ ...item, id: `movie:${item.tmdbId}:${date}`, date, kind: 'movie' }]
      : [];
  }
  const next = await cached(ctx, `calendar:tv:${item.tmdbId}`, async () =>
    normalizedTvNext(await request(ctx, `/tv/${item.tmdbId}`)),
  );
  if (!next || next.airDate > endDate) return [];
  const seasonEpisodes = await cached(
    ctx,
    `calendar:season:${item.tmdbId}:${next.season}`,
    async () =>
      normalizedSeasonEpisodes(
        await request(ctx, `/tv/${item.tmdbId}/season/${next.season}`),
        next.season,
      ),
  );
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
    const events: CalendarEvent[] = [];
    const failedNames: string[] = [];
    let failedCount = 0;
    for (let index = 0; index < items.length; index += 5) {
      const batch = await Promise.all(
        items.slice(index, index + 5).map(async (item) => {
          try {
            return await titleEvents(ctx, item, startDate, endDate, region);
          } catch {
            failedCount += 1;
            if (failedNames.length < 5) failedNames.push(item.title);
            return [];
          }
        }),
      );
      events.push(...batch.flat());
    }
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
