import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

const users = defineTable({
  clerkId: v.string(),
  name: v.optional(v.string()),
  image: v.optional(v.string()),
  email: v.optional(v.string()),
  username: v.optional(v.string()),
  normalizedUsername: v.optional(v.string()),
  isPublic: v.optional(v.boolean()),
  avatarStorageId: v.optional(v.id('_storage')),
  profileCreatedAt: v.optional(v.number()),
  profileUpdatedAt: v.optional(v.number()),
  followerCount: v.optional(v.number()),
  followingCount: v.optional(v.number()),
})
  .index('by_clerk_id', ['clerkId'])
  .index('email', ['email'])
  .index('by_username', ['normalizedUsername'])
  .searchIndex('search_username', { searchField: 'normalizedUsername' });

const resolvedEpisode = v.object({
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

const resolvedSeason = v.object({
  season: v.number(),
  name: v.string(),
  episodeCount: v.number(),
});

const nextEpisode = v.object({
  season: v.number(),
  episode: v.number(),
  chunkIndex: v.optional(v.number()),
  seasonName: v.optional(v.string()),
  name: v.optional(v.string()),
  airDate: v.optional(v.string()),
  undatedReleased: v.optional(v.boolean()),
  runtime: v.optional(v.number()),
  imageUrl: v.optional(v.string()),
  providerEpisodeId: v.optional(v.number()),
});

const castMember = v.object({
  name: v.string(),
  character: v.string(),
  profilePath: v.optional(v.string()),
});

const resolvedTitle = v.object({
  tmdbId: v.number(),
  mediaType: v.union(v.literal('movie'), v.literal('tv')),
  title: v.string(),
  posterPath: v.optional(v.string()),
  overview: v.optional(v.string()),
  releaseDate: v.optional(v.string()),
  firstAirDate: v.optional(v.string()),
  voteAverage: v.optional(v.number()),
  runtime: v.optional(v.number()),
  episodeRunTime: v.array(v.number()),
  genres: v.array(v.string()),
  cast: v.array(castMember),
  seasons: v.array(resolvedSeason),
  metadataProvider: v.union(v.literal('tmdb'), v.literal('tvdb')),
  tvdbId: v.optional(v.number()),
  seasonOrder: v.optional(v.string()),
  refreshedAt: v.number(),
  refreshAfter: v.number(),
  orderEpoch: v.number(),
});

const mappingWrite = v.object({
  tmdbId: v.number(),
  mediaType: v.union(v.literal('movie'), v.literal('tv')),
  tvdbId: v.optional(v.number()),
  seasonOrder: v.optional(v.string()),
  source: v.union(v.literal('auto'), v.literal('manual')),
  orderEpoch: v.number(),
  updatedAt: v.number(),
});

const mappingIdentity = v.object({
  tvdbId: v.optional(v.number()),
  seasonOrder: v.optional(v.string()),
  source: v.union(v.literal('auto'), v.literal('manual')),
  orderEpoch: v.number(),
});

const watchedTagCount = v.object({ tag: v.string(), count: v.number() });

const providerCastMember = castMember;
const providerSearchResult = v.object({
  id: v.number(),
  title: v.string(),
  originalTitle: v.optional(v.string()),
  mediaType: v.union(v.literal('movie'), v.literal('tv')),
  posterPath: v.optional(v.string()),
  overview: v.optional(v.string()),
  releaseDate: v.optional(v.string()),
  voteAverage: v.optional(v.number()),
});
const providerMovie = v.object({
  id: v.number(),
  title: v.string(),
  mediaType: v.literal('movie'),
  posterPath: v.optional(v.string()),
  overview: v.optional(v.string()),
  releaseDate: v.optional(v.string()),
  voteAverage: v.optional(v.number()),
  runtime: v.optional(v.number()),
  genres: v.array(v.string()),
  cast: v.array(providerCastMember),
});
const providerTv = v.object({
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
  seasons: v.array(resolvedSeason),
  cast: v.array(providerCastMember),
});
const providerAnimeEpisode = v.object({
  id: v.number(),
  providerEpisodeId: v.optional(v.number()),
  season: v.number(),
  episode: v.number(),
  name: v.string(),
  overview: v.optional(v.string()),
  runtime: v.optional(v.number()),
  imageUrl: v.optional(v.string()),
  airDate: v.optional(v.string()),
});
const providerAnimeGuide = v.object({
  tvdbId: v.number(),
  title: v.string(),
  firstAirDate: v.optional(v.string()),
  episodeRunTime: v.array(v.number()),
  genres: v.array(v.string()),
  order: v.string(),
  seasons: v.array(resolvedSeason),
  selectedSeason: v.optional(v.number()),
  selectedEpisodes: v.optional(v.array(providerAnimeEpisode)),
});
const calendarMovieRelease = v.object({ date: v.string(), priority: v.number() });
const calendarTvNext = v.object({ airDate: v.string(), season: v.number() });
const calendarSeasonEpisode = v.object({
  date: v.string(),
  season: v.number(),
  episode: v.number(),
  name: v.optional(v.string()),
});
const providerSnapshotEntry = v.union(
  v.object({ kind: v.literal('tmdbSearch'), value: v.array(providerSearchResult) }),
  v.object({ kind: v.literal('tmdbMovie'), value: providerMovie }),
  v.object({ kind: v.literal('tmdbTv'), value: providerTv }),
  v.object({
    kind: v.literal('episodes'),
    value: v.union(v.array(resolvedEpisode), v.array(providerAnimeEpisode)),
  }),
  v.object({
    kind: v.literal('tvdbGuide'),
    value: v.union(v.null(), providerAnimeGuide),
  }),
  v.object({
    kind: v.literal('tvdbLookup'),
    value: v.object({
      tvdbId: v.number(),
      order: v.string(),
      authoritativeNames: v.array(v.string()),
    }),
  }),
  v.object({ kind: v.literal('calendarMovie'), value: v.array(calendarMovieRelease) }),
  v.object({ kind: v.literal('calendarTv'), value: v.union(v.null(), calendarTvNext) }),
  v.object({
    kind: v.literal('calendarSeason'),
    value: v.array(calendarSeasonEpisode),
  }),
  v.object({
    kind: v.literal('truncated'),
    value: v.object({
      __truncatedProviderSnapshot: v.literal(true),
      originalBytes: v.number(),
    }),
  }),
);

export default defineSchema({
  users,
  items: defineTable({
    userId: v.id('users'),
    tmdbId: v.number(),
    mediaType: v.union(v.literal('movie'), v.literal('tv')),
    title: v.string(),
    normalizedTitle: v.string(),
    posterPath: v.optional(v.string()),
    overview: v.optional(v.string()),
    releaseDate: v.optional(v.string()),
    runtime: v.optional(v.number()),
    genres: v.optional(v.array(v.string())),
    isAnime: v.boolean(),
    status: v.union(
      v.literal('watched'),
      v.literal('watching'),
      v.literal('watchlist'),
      v.literal('dropped'),
    ),
    rating: v.optional(v.number()),
    timesWatched: v.number(),
    tags: v.array(v.string()),
    rank: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    deletingAt: v.optional(v.number()),
    nextEpisode: v.optional(nextEpisode),
  })
    .index('by_user', ['userId'])
    .index('by_user_updated_at', ['userId', 'updatedAt'])
    .index('by_user_status', ['userId', 'status', 'rank'])
    .index('by_user_normalized', ['userId', 'normalizedTitle'])
    .index('by_user_tmdb', ['userId', 'mediaType', 'tmdbId'])
    .index('by_media_tmdb', ['mediaType', 'tmdbId']),
  profileFavorites: defineTable({
    userId: v.id('users'),
    itemId: v.id('items'),
    rank: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user_rank', ['userId', 'rank'])
    .index('by_user_item', ['userId', 'itemId'])
    .index('by_item', ['itemId']),
  tagCollections: defineTable({
    userId: v.id('users'),
    tagKey: v.string(),
    label: v.string(),
    isPublic: v.boolean(),
    memberCount: v.number(),
    previewPosters: v.array(v.object({ title: v.string(), posterPath: v.optional(v.string()) })),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_user_tag', ['userId', 'tagKey'])
    .index('by_public_tag', ['isPublic', 'tagKey'])
    .searchIndex('search_tag', {
      searchField: 'tagKey',
      filterFields: ['isPublic'],
    }),
  tagMemberships: defineTable({
    collectionId: v.id('tagCollections'),
    userId: v.id('users'),
    itemId: v.id('items'),
    tagKey: v.string(),
    rank: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_collection_rank', ['collectionId', 'rank'])
    .index('by_user_tag_rank', ['userId', 'tagKey', 'rank'])
    .index('by_user_tag_item', ['userId', 'tagKey', 'itemId'])
    .index('by_item', ['itemId']),
  episodes: defineTable({
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
    metadataProvider: v.union(v.literal('tmdb'), v.literal('tvdb')),
    seasonOrder: v.optional(v.string()),
    providerEpisodeId: v.optional(v.number()),
  })
    .index('by_item', ['itemId', 'season', 'episode'])
    .index('by_item_identity', ['itemId', 'season', 'metadataProvider', 'seasonOrder', 'episode'])
    .index('by_user', ['userId'])
    .index('by_user_watched_at', ['userId', 'watchedAt'])
    .index('by_user_watched_rating', ['userId', 'watched', 'rating']),
  episodeSummaries: defineTable({
    userId: v.id('users'),
    itemId: v.id('items'),
    season: v.number(),
    total: v.number(),
    watchedCount: v.number(),
    watchedRuntimeMinutes: v.number(),
    watchedRuntimeFallbackCount: v.number(),
    tagCounts: v.array(watchedTagCount),
    currentIdentityKey: v.optional(v.string()),
    currentTotal: v.optional(v.number()),
    currentWatchedCount: v.optional(v.number()),
    rebuildIdentityKey: v.optional(v.string()),
    rebuildOffset: v.optional(v.number()),
    rebuildTotal: v.optional(v.number()),
    rebuildWatchedCount: v.optional(v.number()),
    rebuildRevision: v.optional(v.number()),
    rebuildAttempts: v.optional(v.number()),
  })
    .index('by_item', ['itemId', 'season'])
    .index('by_user', ['userId']),
  nextEpisodeRefreshes: defineTable({
    itemId: v.id('items'),
    token: v.string(),
    season: v.number(),
    chunkIndex: v.number(),
  }).index('by_item', ['itemId']),
  episodeProjectionRepairs: defineTable({
    itemId: v.id('items'),
    token: v.string(),
    season: v.number(),
    chunkIndex: v.number(),
    afterEpisode: v.optional(v.number()),
  }).index('by_item', ['itemId']),
  settings: defineTable({
    userId: v.id('users'),
    defaultView: v.union(v.literal('list'), v.literal('posters')),
    gridColumns: v.optional(v.union(v.literal(3), v.literal(4), v.literal(5))),
    listTextSize: v.optional(v.union(v.literal('small'), v.literal('medium'), v.literal('large'))),
    listColumns: v.optional(v.union(v.literal(1), v.literal(2))),
    activityRatings: v.optional(v.boolean()),
    activityWatching: v.optional(v.boolean()),
    activityWatched: v.optional(v.boolean()),
  }).index('by_user', ['userId']),
  follows: defineTable({
    followerId: v.id('users'),
    followingId: v.id('users'),
    status: v.union(v.literal('pending'), v.literal('accepted')),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_pair', ['followerId', 'followingId'])
    .index('by_follower_status', ['followerId', 'status'])
    .index('by_following_status', ['followingId', 'status']),
  activityEvents: defineTable({
    userId: v.id('users'),
    kind: v.union(
      v.literal('rating'),
      v.literal('status'),
      v.literal('finished'),
      v.literal('episode'),
    ),
    itemId: v.id('items'),
    title: v.string(),
    posterPath: v.optional(v.string()),
    season: v.optional(v.number()),
    episode: v.optional(v.number()),
    rating: v.optional(v.number()),
    status: v.optional(
      v.union(
        v.literal('watched'),
        v.literal('watching'),
        v.literal('watchlist'),
        v.literal('dropped'),
      ),
    ),
    createdAt: v.number(),
  }).index('by_actor_time', ['userId', 'createdAt']),
  requestThrottle: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index('by_key', ['key']),
  providerSnapshots: defineTable({
    key: v.string(),
    entry: providerSnapshotEntry,
    refreshedAt: v.number(),
  })
    .index('by_key', ['key'])
    .index('by_refreshed_at', ['refreshedAt']),
  resolvedTitles: defineTable(resolvedTitle.fields)
    .index('by_tmdb', ['mediaType', 'tmdbId'])
    .index('by_refreshed_at', ['refreshedAt']),
  resolvedSeasons: defineTable({
    tmdbId: v.number(),
    season: v.number(),
    metadataProvider: v.union(v.literal('tmdb'), v.literal('tvdb')),
    episodeCount: v.optional(v.number()),
    chunkCount: v.optional(v.number()),
    chunksComplete: v.optional(v.boolean()),
    // The visible chunk version. Staged writes use separate fields so readers
    // continue to see this complete version until the final atomic flip.
    seasonVersion: v.optional(v.string()),
    writeAttemptToken: v.optional(v.string()),
    nextChunkIndex: v.optional(v.number()),
    stagingVersion: v.optional(v.string()),
    stagingMetadataProvider: v.optional(v.union(v.literal('tmdb'), v.literal('tvdb'))),
    stagingEpisodeCount: v.optional(v.number()),
    stagingChunkCount: v.optional(v.number()),
    stagingRefreshedAt: v.optional(v.number()),
    stagingRefreshAfter: v.optional(v.number()),
    stagingOrderEpoch: v.optional(v.number()),
    // Multi-chunk refreshes keep the entire replacement commit here until every
    // season chunk is durable. These values are validated by commitRefresh
    // before being staged and are cleared by the single atomic publish.
    stagingTitle: v.optional(resolvedTitle),
    stagingTitleWrite: v.optional(v.union(v.literal('replace'), v.literal('seasonPatch'))),
    stagingMapping: v.optional(v.union(v.null(), mappingWrite)),
    stagingExpectedMapping: v.optional(v.union(v.null(), mappingIdentity)),
    refreshedAt: v.number(),
    refreshAfter: v.number(),
    orderEpoch: v.number(),
  })
    .index('by_tmdb_season', ['tmdbId', 'season'])
    .index('by_tmdb_refreshed_at', ['tmdbId', 'refreshedAt'])
    .index('by_refreshed_at', ['refreshedAt']),
  resolvedSeasonChunks: defineTable({
    tmdbId: v.number(),
    season: v.number(),
    orderEpoch: v.number(),
    seasonVersion: v.string(),
    chunkIndex: v.number(),
    refreshedAt: v.number(),
    episodes: v.array(resolvedEpisode),
  })
    .index('by_tmdb_season_epoch_chunk', ['tmdbId', 'season', 'orderEpoch', 'chunkIndex'])
    .index('by_tmdb_season_version_chunk', ['tmdbId', 'season', 'seasonVersion', 'chunkIndex'])
    .index('by_refreshed_at', ['refreshedAt']),
  metadataRefreshLeases: defineTable({
    key: v.string(),
    token: v.string(),
    expiresAt: v.number(),
  })
    .index('by_key', ['key'])
    .index('by_expires', ['expiresAt']),
  titleMappings: defineTable({
    tmdbId: v.number(),
    mediaType: v.union(v.literal('movie'), v.literal('tv')),
    tvdbId: v.optional(v.number()),
    seasonOrder: v.optional(v.string()),
    source: v.union(v.literal('auto'), v.literal('manual')),
    orderEpoch: v.number(),
    updatedAt: v.number(),
  })
    .index('by_tmdb', ['mediaType', 'tmdbId'])
    .index('by_tvdb', ['tvdbId'])
    .index('by_updated_at', ['updatedAt']),
  metadataRefreshRequests: defineTable({
    key: v.string(),
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
    attemptToken: v.string(),
    expiresAt: v.number(),
  })
    .index('by_key', ['key'])
    .index('by_attempt_token', ['attemptToken'])
    .index('by_expires', ['expiresAt']),
});
