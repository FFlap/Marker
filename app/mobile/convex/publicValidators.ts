import { v } from 'convex/values';

export const mediaTypeValidator = v.union(v.literal('movie'), v.literal('tv'));
export const statusValidator = v.union(
  v.literal('watched'),
  v.literal('watching'),
  v.literal('watchlist'),
  v.literal('dropped'),
);
export const metadataProviderValidator = v.union(v.literal('tmdb'), v.literal('tvdb'));
export const castMemberValidator = v.object({
  name: v.string(),
  character: v.string(),
  profilePath: v.optional(v.string()),
});
export const resolvedEpisodeValidator = v.object({
  season: v.number(),
  episode: v.number(),
  name: v.string(),
  overview: v.optional(v.string()),
  runtime: v.optional(v.number()),
  imageUrl: v.optional(v.string()),
  stillPath: v.optional(v.string()),
  airDate: v.optional(v.string()),
  providerEpisodeId: v.optional(v.number()),
});
export const resolvedSeasonValidator = v.object({
  season: v.number(),
  name: v.string(),
  episodeCount: v.number(),
});
export const nextEpisodeValidator = v.object({
  season: v.number(),
  episode: v.number(),
  chunkIndex: v.optional(v.number()),
  seasonName: v.optional(v.string()),
  name: v.optional(v.string()),
  overview: v.optional(v.string()),
  airDate: v.optional(v.string()),
  undatedReleased: v.optional(v.boolean()),
  runtime: v.optional(v.number()),
  imageUrl: v.optional(v.string()),
  providerEpisodeId: v.optional(v.number()),
});
export const resolvedTitleValidator = v.object({
  _id: v.id('resolvedTitles'),
  _creationTime: v.number(),
  tmdbId: v.number(),
  mediaType: mediaTypeValidator,
  title: v.string(),
  posterPath: v.optional(v.string()),
  overview: v.optional(v.string()),
  releaseDate: v.optional(v.string()),
  firstAirDate: v.optional(v.string()),
  voteAverage: v.optional(v.number()),
  runtime: v.optional(v.number()),
  episodeRunTime: v.array(v.number()),
  genres: v.array(v.string()),
  cast: v.array(castMemberValidator),
  seasons: v.array(resolvedSeasonValidator),
  metadataProvider: metadataProviderValidator,
  tvdbId: v.optional(v.number()),
  seasonOrder: v.optional(v.string()),
  refreshedAt: v.number(),
  refreshAfter: v.number(),
  orderEpoch: v.number(),
});
export const itemValidator = v.object({
  _id: v.id('items'),
  _creationTime: v.number(),
  userId: v.id('users'),
  tmdbId: v.number(),
  mediaType: mediaTypeValidator,
  title: v.string(),
  normalizedTitle: v.string(),
  posterPath: v.optional(v.string()),
  overview: v.optional(v.string()),
  releaseDate: v.optional(v.string()),
  runtime: v.optional(v.number()),
  genres: v.optional(v.array(v.string())),
  isAnime: v.boolean(),
  status: statusValidator,
  rating: v.optional(v.number()),
  timesWatched: v.number(),
  tags: v.array(v.string()),
  rank: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  deletingAt: v.optional(v.number()),
  nextEpisode: v.optional(nextEpisodeValidator),
});
export const episodeValidator = v.object({
  _id: v.id('episodes'),
  _creationTime: v.number(),
  userId: v.id('users'),
  itemId: v.id('items'),
  season: v.number(),
  episode: v.number(),
  seasonName: v.optional(v.string()),
  name: v.optional(v.string()),
  overview: v.optional(v.string()),
  runtime: v.optional(v.number()),
  imageUrl: v.optional(v.string()),
  airDate: v.optional(v.string()),
  unverified: v.optional(v.boolean()),
  watched: v.boolean(),
  rating: v.optional(v.number()),
  tags: v.array(v.string()),
  watchedAt: v.optional(v.number()),
  metadataProvider: metadataProviderValidator,
  seasonOrder: v.optional(v.string()),
  providerEpisodeId: v.optional(v.number()),
});
export const favoriteValidator = v.object({
  _id: v.id('items'),
  title: v.string(),
  mediaType: mediaTypeValidator,
  isAnime: v.boolean(),
  posterPath: v.optional(v.string()),
  rank: v.number(),
});
export const eligibleFavoriteValidator = v.object({
  _id: v.id('items'),
  title: v.string(),
  mediaType: mediaTypeValidator,
  isAnime: v.boolean(),
  posterPath: v.optional(v.string()),
});
export const statsValidator = v.object({
  favorites: v.array(favoriteValidator),
  totalWatchMinutes: v.number(),
  episodesWatched: v.number(),
  moviesWatched: v.number(),
  showsWatched: v.number(),
  totalItems: v.number(),
  avgRating: v.number(),
  topTags: v.array(v.object({ tag: v.string(), count: v.number() })),
});
export const publicTagPreviewValidator = v.object({
  tag: v.string(),
  count: v.number(),
  posters: v.array(v.object({ title: v.string(), posterPath: v.optional(v.string()) })),
});
export const identityValidator = v.object({
  isPublic: v.boolean(),
  followerCount: v.number(),
  followingCount: v.number(),
  username: v.optional(v.string()),
  avatarUrl: v.optional(v.string()),
});
export const relationshipValidator = v.union(
  v.literal('self'),
  v.literal('none'),
  v.literal('pending'),
  v.literal('accepted'),
);
export const requestStateValidator = v.union(
  v.null(),
  v.object({
    state: v.union(
      v.literal('inFlight'),
      v.literal('succeeded'),
      v.literal('failed'),
      v.literal('notFound'),
    ),
    lastRequestedAt: v.number(),
    completedAt: v.optional(v.number()),
    errorCode: v.optional(v.string()),
    retryAt: v.optional(v.number()),
    expiresAt: v.number(),
    delayMs: v.optional(v.number()),
  }),
);
const refreshDecision = v.object({
  scheduled: v.boolean(),
  attemptToken: v.optional(v.string()),
  reason: v.optional(
    v.union(
      v.literal('notFound'),
      v.literal('inFlight'),
      v.literal('backoff'),
      v.literal('debounced'),
    ),
  ),
  expiresAt: v.number(),
  retryAt: v.optional(v.number()),
  delayMs: v.number(),
});
export const refreshResultValidator = v.union(
  refreshDecision,
  v.object({
    scheduled: v.boolean(),
    title: refreshDecision,
    season: refreshDecision,
    expiresAt: v.number(),
    delayMs: v.number(),
  }),
);
