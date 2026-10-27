import { DateTime, Effect, Option, Schema, flow } from 'effect';
import { attempt } from './actionEffects';
import { action, internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { v } from 'convex/values';
import { requireUser } from './clerkAuth';
import {
  providerFetchEffect,
  decodeProviderObject,
  runProviderEffect,
  ProviderIntegrationFailure,
  providerObject,
  providerRecords,
} from './providerHttp';
import { isTruncatedSnapshot, putNonFatal, SNAPSHOT_TTL_MS } from './providerSnapshots';
import { boundedEpisode, MAX_SEASON_EPISODES } from './seasonStorage';
import { validateInteger, validateTmdbId } from './providerValidation';
import {
  providerMovieValidator,
  providerTvValidator,
  providerSearchResultsValidator,
} from './providerValidators';
import { resolvedEpisodeValidator } from './publicValidators';

type Json = Record<string, unknown>;
type SnapshotCtx = { runQuery: Function; runMutation: Function };
type ProviderRequestCtx = { runMutation: Function };
const string = flow(Schema.decodeUnknownOption(Schema.String), Option.getOrUndefined);
const number = flow(Schema.decodeUnknownOption(Schema.Finite), Option.getOrUndefined);
const identifier = flow(
  Schema.decodeUnknownOption(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  Option.getOrUndefined,
);
const record = flow(Schema.decodeUnknownOption(providerObject), Option.getOrUndefined);
const array = flow(Schema.decodeUnknownOption(Schema.Array(Schema.Unknown)), Option.getOrUndefined);
const records = (x: unknown): Json[] =>
  (array(x) ?? []).flatMap((entry) => {
    const value = record(entry);
    return value ? [value] : [];
  });
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
  throw new ProviderIntegrationFailure({
    provider: 'tmdb',
    message: 'TMDB returned malformed data',
  });
};
const requiredNumber = (x: unknown) => identifier(x) ?? malformed();
const requiredString = flow(
  Schema.decodeUnknownOption(Schema.Trim.check(Schema.isNonEmpty())),
  Option.getOrElse(malformed),
);
const requiredRecords = flow(
  Schema.decodeUnknownOption(providerRecords),
  Option.getOrElse(malformed),
);

export function mapSearchResponse(payload: unknown) {
  const root = record(payload) ?? malformed();
  return requiredRecords(root.results)
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
  records(record(credits)?.cast)
    .slice(0, 12)
    .map((c) => ({
      name: string(c.name) ?? '',
      character: string(c.character) ?? '',
      profilePath: string(c.profile_path),
    }));
export function mapTvDetails(r: Json) {
  const genreNames = genres(r.genres);
  const originalTitle = string(r.original_name)?.trim();
  const today = DateTime.formatIsoDateUtc(DateTime.nowUnsafe());
  return {
    id: requiredNumber(r.id),
    title: requiredString(r.name),
    ...(originalTitle && { originalTitle }),
    mediaType: 'tv' as const,
    posterPath: string(r.poster_path),
    overview: string(r.overview),
    firstAirDate: string(r.first_air_date),
    voteAverage: number(r.vote_average),
    episodeRunTime: (array(r.episode_run_time) ?? []).flatMap((value) => {
      const runtime = number(value);
      return runtime === undefined ? [] : [runtime];
    }),
    genres: withAnimeGenre(r, genreNames),
    seasons: records(r.seasons).flatMap((s) => {
      const season = identifier(s.season_number);
      if (season === undefined) return [];
      return [
        {
          season,
          name: string(s.name) ?? '',
          episodeCountVerified: true,
          episodeCount: (string(s.air_date) ?? '') > today ? 0 : (number(s.episode_count) ?? 0),
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
  for (const e of requiredRecords(r.episodes)) {
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

const parseProvider = <A>(parse: () => A) =>
  Effect.try({ try: parse, catch: (error) => error }).pipe(
    Effect.catch((error) =>
      error instanceof ProviderIntegrationFailure ? Effect.fail(error) : Effect.die(error),
    ),
  );

async function snapshot<T, E>(
  ctx: SnapshotCtx,
  key: string,
  load: () => Effect.Effect<T, E>,
  readTruncated?: () => Promise<T | null>,
): Promise<T> {
  const stored = await ctx.runQuery(internal.providerSnapshots.get, { key });
  if (stored && stored.refreshedAt > Date.now() - SNAPSHOT_TTL_MS) {
    if (!isTruncatedSnapshot(stored.value)) return stored.value as T;
    const durable = await readTruncated?.();
    if (durable !== null && durable !== undefined) return durable;
  }
  return refreshSnapshot(ctx, key, load);
}

function refreshSnapshot<T, E>(ctx: SnapshotCtx, key: string, load: () => Effect.Effect<T, E>) {
  return runProviderEffect(
    Effect.gen(function* () {
      const value = yield* load();
      yield* attempt(() => putNonFatal(ctx, { key, value, metricKey: 'tmdb' }));
      return value;
    }),
  );
}

const requestEffect = Effect.fnUntraced(function* (
  ctx: ProviderRequestCtx,
  path: string,
  emptyOnNotFound = false,
) {
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
    {
      provider: 'tmdb',
      operation: path.split('?')[0],
      beforeRequest: (): Promise<boolean> =>
        ctx.runMutation(internal.providerRateLimits.consumeGlobalProviderLimiter, {
          provider: 'tmdb',
        }),
    },
  );
  if (response.status === 404 && emptyOnNotFound) return { episodes: [] };
  if (!response.ok)
    return yield* Effect.fail(
      new ProviderIntegrationFailure({
        provider: 'tmdb',
        message: `TMDB request failed (${response.status})`,
      }),
    );
  return yield* decodeProviderObject(response, 'tmdb');
});
const searchEffect = Effect.fnUntraced(function* (
  ctx: ProviderRequestCtx,
  query: string,
  type?: 'movie' | 'tv',
) {
  const raw = yield* requestEffect(
    ctx,
    `/search/${type ?? 'multi'}?query=${encodeURIComponent(query)}`,
  );
  return yield* parseProvider(() =>
    mapSearchResponse(
      type
        ? {
            ...raw,
            results: requiredRecords(raw.results).map((result) => ({
              ...result,
              media_type: type,
            })),
          }
        : raw,
    ),
  );
});
const search = (...args: Parameters<typeof searchEffect>) =>
  runProviderEffect(searchEffect(...args));
async function authorizeAction(ctx: Parameters<typeof requireUser>[0] & { runMutation: Function }) {
  const userId = await requireUser(ctx);
  const allowed = await ctx.runMutation(internal.providerRateLimits.consumeThrottle, {
    key: `tmdb:${userId}`,
  });
  if (!allowed) throw new Error('Too many requests — try again shortly');
}
export const searchMulti = action({
  args: { query: v.string() },
  returns: providerSearchResultsValidator,
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
  returns: providerSearchResultsValidator,
  handler: async (ctx, { query }) => search(ctx, query, 'tv'),
});
export const refreshMovieDetails = internalAction({
  args: { tmdbId: v.number(), force: v.optional(v.boolean()) },
  returns: providerMovieValidator,
  handler: async (ctx, { tmdbId, force = false }) => {
    validateTmdbId(tmdbId);
    const load = () =>
      requestEffect(ctx, `/movie/${tmdbId}?append_to_response=credits`).pipe(
        Effect.flatMap((payload) => parseProvider(() => mapMovieDetails(payload))),
      );
    return force
      ? refreshSnapshot(ctx, `tmdb:movie:${tmdbId}`, load)
      : snapshot(ctx, `tmdb:movie:${tmdbId}`, load);
  },
});
export const refreshTvDetails = internalAction({
  args: { tmdbId: v.number(), force: v.optional(v.boolean()) },
  returns: providerTvValidator,
  handler: async (ctx, { tmdbId, force = false }) => {
    validateTmdbId(tmdbId);
    const load = () =>
      requestEffect(ctx, `/tv/${tmdbId}?append_to_response=credits`).pipe(
        Effect.flatMap((payload) => parseProvider(() => mapTvDetails(payload))),
      );
    return force
      ? refreshSnapshot(ctx, `tmdb:tv:full:v2:${tmdbId}`, load)
      : snapshot(ctx, `tmdb:tv:full:v2:${tmdbId}`, load);
  },
});
export const refreshSeasonDetails = internalAction({
  args: { tmdbId: v.number(), season: v.number(), force: v.optional(v.boolean()) },
  returns: v.array(resolvedEpisodeValidator),
  handler: async (ctx, { force = false, ...args }): Promise<TmdbSeasonEpisode[]> => {
    validateTmdbId(args.tmdbId);
    validateInteger('season', args.season, 10_000);
    const key = `tmdb:season:${args.tmdbId}:${args.season}`;
    const load = () =>
      requestEffect(ctx, `/tv/${args.tmdbId}/season/${args.season}`, true).pipe(
        Effect.flatMap((payload) =>
          parseProvider(() => mapSeasonDetails(payload).map(boundedEpisode)),
        ),
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
