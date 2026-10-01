import { v } from 'convex/values';
import {
  castMemberValidator,
  resolvedEpisodeValidator,
  resolvedSeasonValidator,
} from './publicValidators';

// Shared by persisted snapshots and their write boundary.
const castMember = castMemberValidator;
const season = resolvedSeasonValidator;
const episode = resolvedEpisodeValidator;
const animeEpisode = v.object({ id: v.number(), ...episode.fields });
export const providerSearchResultsValidator = v.array(
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
);
const movie = v.object({
  id: v.number(),
  title: v.string(),
  mediaType: v.literal('movie'),
  posterPath: v.optional(v.string()),
  overview: v.optional(v.string()),
  releaseDate: v.optional(v.string()),
  voteAverage: v.optional(v.number()),
  runtime: v.optional(v.number()),
  genres: v.array(v.string()),
  cast: v.array(castMember),
});
const tv = v.object({
  id: v.number(),
  title: v.string(),
  originalTitle: v.optional(v.string()),
  mediaType: v.literal('tv'),
  posterPath: v.optional(v.string()),
  overview: v.optional(v.string()),
  firstAirDate: v.optional(v.string()),
  voteAverage: v.optional(v.number()),
  episodeRunTime: v.array(v.number()),
  genres: v.array(v.string()),
  seasons: v.array(season),
  cast: v.array(castMember),
});
const animeGuide = v.object({
  tvdbId: v.number(),
  title: v.string(),
  firstAirDate: v.optional(v.string()),
  episodeRunTime: v.array(v.number()),
  genres: v.array(v.string()),
  order: v.string(),
  seasons: v.array(season),
  selectedSeason: v.optional(v.number()),
  selectedEpisodes: v.optional(v.array(animeEpisode)),
});
const lookup = v.object({
  tvdbId: v.number(),
  order: v.string(),
  authoritativeNames: v.array(v.string()),
});
const calendarMovie = v.array(v.object({ date: v.string(), priority: v.number() }));
const calendarTv = v.object({ airDate: v.string(), season: v.number() });
const calendarSeason = v.array(
  v.object({
    date: v.string(),
    season: v.number(),
    episode: v.number(),
    name: v.optional(v.string()),
  }),
);
const truncated = v.object({
  __truncatedProviderSnapshot: v.literal(true),
  originalBytes: v.number(),
});
export const providerSnapshotEntryValidator = v.union(
  v.object({ kind: v.literal('tmdbSearch'), value: providerSearchResultsValidator }),
  v.object({ kind: v.literal('tmdbMovie'), value: movie }),
  v.object({ kind: v.literal('tmdbTv'), value: tv }),
  v.object({
    kind: v.literal('episodes'),
    value: v.union(v.array(episode), v.array(animeEpisode)),
  }),
  v.object({ kind: v.literal('tvdbGuide'), value: v.union(v.null(), animeGuide) }),
  v.object({ kind: v.literal('tvdbLookup'), value: lookup }),
  v.object({ kind: v.literal('calendarMovie'), value: calendarMovie }),
  v.object({ kind: v.literal('calendarTv'), value: v.union(v.null(), calendarTv) }),
  v.object({ kind: v.literal('calendarSeason'), value: calendarSeason }),
  v.object({ kind: v.literal('truncated'), value: truncated }),
);
