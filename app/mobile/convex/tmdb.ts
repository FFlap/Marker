import { action, internalAction, internalMutation } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';
import { getClerkUserId } from './clerkAuth';
import { providerFetch } from './providerHttp';
import { isTruncatedSnapshot, putNonFatal, SNAPSHOT_TTL_MS } from './providerSnapshots';
import { boundedEpisode, MAX_SEASON_EPISODES } from './seasonStorage';
import { validateInteger, validateTmdbId } from './providerValidation';

type Json = Record<string, unknown>;
type SnapshotCtx = { runQuery: Function; runMutation: Function };
type ProviderRequestCtx = { runMutation: Function };
const string = (x: unknown) => (typeof x === 'string' ? x : undefined);
const number = (x: unknown) => (typeof x === 'number' ? x : undefined);
const identifier = (x: unknown) =>
  typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : undefined;
const records = (x: unknown): Json[] =>
  Array.isArray(x) ? x.filter((y): y is Json => typeof y === 'object' && y !== null) : [];
const genres = (x: unknown) =>
  records(x)
    .map((g) => string(g.name))
    .filter((x): x is string => !!x);
const withAnimeGenre = (record: Json, names: string[]) =>
  string(record.original_language) === 'ja' &&
  names.some((name) => name.toLocaleLowerCase() === 'animation') &&
  !names.some((name) => name.toLocaleLowerCase() === 'anime')
    ? [...names, 'Anime']
    : names;
const malformed = (): never => {
  throw new Error('TMDB returned malformed data');
};
const requiredNumber = (x: unknown) => number(x) ?? malformed();
const requiredString = (x: unknown) => {
  const value = string(x)?.trim();
  return value || malformed();
};

export function mapSearchResponse(payload: unknown) {
  const root = payload as Json;
  return records(root?.results)
    .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
    .flatMap((r) => {
      const id = identifier(r.id);
      const title = string(r.media_type === 'movie' ? r.title : r.name)?.trim();
      if (id === undefined || !title) return [];
      return [
        {
          id,
          title,
          originalTitle: string(r.original_title) ?? string(r.original_name),
          mediaType: r.media_type as 'movie' | 'tv',
          posterPath: string(r.poster_path),
          overview: string(r.overview),
          releaseDate: string(r.release_date) ?? string(r.first_air_date),
          voteAverage: number(r.vote_average),
        },
      ];
    });
}
export function mapMovieDetails(r: Json) {
  const genreNames = genres(r.genres);
  return {
    id: requiredNumber(r.id),
    title: requiredString(r.title),
    mediaType: 'movie' as const,
    posterPath: string(r.poster_path),
    overview: string(r.overview),
    releaseDate: string(r.release_date),
    voteAverage: number(r.vote_average),
    runtime: number(r.runtime),
    genres: withAnimeGenre(r, genreNames),
    cast: mapCast(r.credits),
  };
}
const mapCast = (credits: unknown) =>
  records((credits as Json)?.cast)
    .slice(0, 12)
    .map((c) => ({
      name: string(c.name) ?? '',
      character: string(c.character) ?? '',
      profilePath: string(c.profile_path),
    }));
export function mapTvDetails(r: Json) {
  const genreNames = genres(r.genres);
  const originalTitle = string(r.original_name)?.trim();
  return {
    id: requiredNumber(r.id),
    title: requiredString(r.name),
    ...(originalTitle && { originalTitle }),
    mediaType: 'tv' as const,
    posterPath: string(r.poster_path),
    overview: string(r.overview),
    firstAirDate: string(r.first_air_date),
    voteAverage: number(r.vote_average),
    episodeRunTime: Array.isArray(r.episode_run_time)
      ? r.episode_run_time.filter((x): x is number => typeof x === 'number')
      : [],
    genres: withAnimeGenre(r, genreNames),
    seasons: records(r.seasons).flatMap((s) => {
      const season = identifier(s.season_number);
      if (season === undefined) return [];
      return [
        {
          season,
          name: string(s.name) ?? '',
          episodeCount: number(s.episode_count) ?? 0,
        },
      ];
    }),
    cast: mapCast(r.credits),
  };
}
type TmdbSeasonEpisode = ReturnType<typeof boundedEpisode> & { stillPath?: string };

export function mapSeasonDetails(r: Json): TmdbSeasonEpisode[] {
  const parentSeason = identifier(r.season_number);
  const episodes: TmdbSeasonEpisode[] = [];
  for (const e of records(r.episodes)) {
    if (episodes.length >= MAX_SEASON_EPISODES) break;
    const season = identifier(e.season_number) ?? parentSeason;
    const episode = identifier(e.episode_number);
    if (season === undefined || episode === undefined) continue;
    const stillPath = string(e.still_path);
    episodes.push({
      ...boundedEpisode({
        season,
        episode,
        providerEpisodeId: identifier(e.id),
        name: string(e.name) ?? '',
        overview: string(e.overview),
        runtime: number(e.runtime),
        ...(stillPath && { imageUrl: `https://image.tmdb.org/t/p/w500${stillPath}` }),
        airDate: string(e.air_date),
      }),
      ...(stillPath && { stillPath: stillPath.slice(0, 500) }),
    });
  }
  return episodes;
}

async function snapshot<T>(
  ctx: SnapshotCtx,
  key: string,
  load: () => Promise<T>,
  readTruncated?: () => Promise<T | null>,
): Promise<T> {
  const stored = await ctx.runQuery(internal.providerSnapshots.get, { key });
  if (stored && stored.refreshedAt > Date.now() - SNAPSHOT_TTL_MS) {
    if (!isTruncatedSnapshot(stored.value)) return stored.value as T;
    const durable = await readTruncated?.();
    if (durable !== null && durable !== undefined) return durable;
    // A truncation marker without durable chunks is a cold cache miss.
  }
  return refreshSnapshot(ctx, key, load);
}

async function refreshSnapshot<T>(ctx: SnapshotCtx, key: string, load: () => Promise<T>) {
  const value = await load();
  await putNonFatal(ctx, { key, value, metricKey: 'tmdb' });
  return value;
}

async function request(ctx: ProviderRequestCtx, path: string, emptyOnNotFound = false) {
  const token = process.env.TMDB_API_READ_ACCESS_TOKEN;
  if (!token) throw new Error('TMDB_API_READ_ACCESS_TOKEN is not configured');
  const response = await providerFetch(
    `https://api.themoviedb.org/3${path}`,
    {
      headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
    },
    {
      provider: 'tmdb',
      operation: path.split('?')[0],
      beforeRequest: () =>
        ctx.runMutation(internal.tmdb.consumeGlobalProviderLimiter, { provider: 'tmdb' }),
    },
  );
  if (response.status === 404 && emptyOnNotFound) return {};
  if (!response.ok) throw new Error(`TMDB request failed (${response.status})`);
  return (await response.json()) as Json;
}
async function search(ctx: ProviderRequestCtx, query: string, type?: 'movie' | 'tv') {
  const raw = await request(ctx, `/search/${type ?? 'multi'}?query=${encodeURIComponent(query)}`);
  if (type) for (const result of records(raw.results)) result.media_type = type;
  return mapSearchResponse(raw);
}
async function authenticated(ctx: Parameters<typeof getClerkUserId>[0]) {
  const userId = await getClerkUserId(ctx);
  if (!userId) throw new Error('Authentication required');
  return userId;
}
export const consumeThrottle = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const now = Date.now();
    const row = await ctx.db
      .query('requestThrottle')
      .withIndex('by_key', (q) => q.eq('key', key))
      .unique();
    if (!row) {
      await ctx.db.insert('requestThrottle', { key, windowStart: now, count: 1 });
      return true;
    }
    if (now - row.windowStart >= 60_000) {
      await ctx.db.patch(row._id, { windowStart: now, count: 1 });
      return true;
    }
    if (row.count >= 60) return false;
    await ctx.db.patch(row._id, { count: row.count + 1 });
    return true;
  },
});
/** Shared provider budget consumed immediately before every outbound attempt. */
export const consumeGlobalProviderLimiter = internalMutation({
  args: { provider: v.union(v.literal('tmdb'), v.literal('tvdb')) },
  handler: async (ctx, { provider }) => {
    const key = `${provider}-global`;
    const now = Date.now();
    const row = await ctx.db
      .query('requestThrottle')
      .withIndex('by_key', (q) => q.eq('key', key))
      .unique();
    if (!row) {
      await ctx.db.insert('requestThrottle', { key, windowStart: now, count: 1 });
      return true;
    }
    if (now - row.windowStart >= 60_000) {
      await ctx.db.patch(row._id, { windowStart: now, count: 1 });
      return true;
    }
    if (row.count >= 300) return false;
    await ctx.db.patch(row._id, { count: row.count + 1 });
    return true;
  },
});
async function authorizeAction(
  ctx: Parameters<typeof getClerkUserId>[0] & { runMutation: Function },
) {
  const userId = await authenticated(ctx);
  const allowed = await ctx.runMutation(internal.tmdb.consumeThrottle, { key: `tmdb:${userId}` });
  if (!allowed) throw new Error('Too many requests — try again shortly');
}
export const searchMulti = action({
  args: { query: v.string() },
  returns: v.array(
    v.object({
      id: v.number(),
      title: v.string(),
      originalTitle: v.optional(v.string()),
      mediaType: v.union(v.literal('movie'), v.literal('tv')),
      posterPath: v.optional(v.string()),
      overview: v.optional(v.string()),
      releaseDate: v.optional(v.string()),
      voteAverage: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, { query }) => {
    await authorizeAction(ctx);
    const normalized = query.trim();
    if (normalized.length < 1 || normalized.length > 100)
      throw new Error('Search query must be between 1 and 100 characters');
    return search(ctx, normalized);
  },
});
export const internalSearchTv = internalAction({
  args: { query: v.string() },
  handler: async (ctx, { query }) => search(ctx, query, 'tv'),
});
export const refreshMovieDetails = internalAction({
  args: { tmdbId: v.number(), force: v.optional(v.boolean()) },
  handler: async (ctx, { tmdbId, force = false }) => {
    validateTmdbId(tmdbId);
    const load = async () =>
      mapMovieDetails(await request(ctx, `/movie/${tmdbId}?append_to_response=credits`));
    return force
      ? refreshSnapshot(ctx, `tmdb:movie:${tmdbId}`, load)
      : snapshot(ctx, `tmdb:movie:${tmdbId}`, load);
  },
});
export const refreshTvDetails = internalAction({
  args: { tmdbId: v.number(), force: v.optional(v.boolean()) },
  handler: async (ctx, { tmdbId, force = false }) => {
    validateTmdbId(tmdbId);
    const load = async () =>
      mapTvDetails(await request(ctx, `/tv/${tmdbId}?append_to_response=credits`));
    return force
      ? refreshSnapshot(ctx, `tmdb:tv:full:${tmdbId}`, load)
      : snapshot(ctx, `tmdb:tv:full:${tmdbId}`, load);
  },
});
export const refreshSeasonDetails = internalAction({
  args: { tmdbId: v.number(), season: v.number(), force: v.optional(v.boolean()) },
  handler: async (ctx, { force = false, ...args }): Promise<TmdbSeasonEpisode[]> => {
    validateTmdbId(args.tmdbId);
    validateInteger('season', args.season, 10_000);
    const key = `tmdb:season:${args.tmdbId}:${args.season}`;
    const load = async () =>
      mapSeasonDetails(await request(ctx, `/tv/${args.tmdbId}/season/${args.season}`, true)).map(
        boundedEpisode,
      );
    return force
      ? refreshSnapshot(ctx, key, load)
      : snapshot(ctx, key, load, async (): Promise<TmdbSeasonEpisode[] | null> => {
          const durable = (await ctx.runQuery(
            internal.seasonStorage.readCanonicalSeason,
            args,
          )) as { episodes: TmdbSeasonEpisode[] } | null;
          return durable?.episodes ?? null;
        });
  },
});
export const internalSeasonDetails = internalAction({
  args: { tmdbId: v.number(), season: v.number() },
  handler: async (ctx, a): Promise<TmdbSeasonEpisode[]> =>
    snapshot(
      ctx,
      `tmdb:season:${a.tmdbId}:${a.season}`,
      async () => mapSeasonDetails(await request(ctx, `/tv/${a.tmdbId}/season/${a.season}`, true)),
      async (): Promise<TmdbSeasonEpisode[] | null> => {
        const durable = (await ctx.runQuery(internal.seasonStorage.readCanonicalSeason, a)) as {
          episodes: TmdbSeasonEpisode[];
        } | null;
        return durable?.episodes ?? null;
      },
    ),
});
