import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import {
  episodeValidator,
  itemValidator,
  mediaTypeValidator,
  metadataProviderValidator,
  resolvedEpisodeValidator,
  resolvedTitleValidator,
  statusValidator,
} from './publicValidators';
import { providerSnapshotEntryValidator } from './providerValidators';

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

const resolvedEpisode = resolvedEpisodeValidator;

const resolvedTitle = resolvedTitleValidator.omit('_id', '_creationTime');

const mappingWrite = v.object({
  tmdbId: v.number(),
  mediaType: mediaTypeValidator,
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

export default defineSchema({
  users,
  avatarUploads: defineTable({
    userId: v.id('users'),
    storageId: v.optional(v.id('_storage')),
    status: v.union(v.literal('pending'), v.literal('active')),
    createdAt: v.number(),
  })
    .index('by_storage', ['storageId'])
    .index('by_status_created', ['status', 'createdAt']),
  items: defineTable(itemValidator.omit('_id', '_creationTime'))
    .index('by_user', ['userId'])
    .index('by_user_status', ['userId', 'status', 'rank'])
    .index('by_user_status_title', ['userId', 'status', 'normalizedTitle'])
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
  profileStats: defineTable({
    userId: v.id('users'),
    totalWatchMinutes: v.number(),
    episodesWatched: v.number(),
    moviesWatched: v.number(),
    showsWatched: v.number(),
    totalItems: v.number(),
    ratingTotal: v.number(),
    ratingCount: v.number(),
    topTags: v.array(watchedTagCount),
    updatedAt: v.number(),
  }).index('by_user', ['userId']),
  profileStatsRefreshes: defineTable({
    userId: v.id('users'),
    phase: v.union(v.literal('items'), v.literal('summaries')),
    cursor: v.optional(v.string()),
    totalWatchMinutes: v.number(),
    episodesWatched: v.number(),
    moviesWatched: v.number(),
    showsWatched: v.number(),
    totalItems: v.number(),
    ratingTotal: v.number(),
    ratingCount: v.number(),
    tagCounts: v.array(watchedTagCount),
    restartRequested: v.boolean(),
    lastProgressAt: v.optional(v.number()),
  }).index('by_user', ['userId']),
  tagCollections: defineTable({
    userId: v.id('users'),
    tagKey: v.string(),
    label: v.string(),
    isPublic: v.boolean(),
    memberCount: v.number(),
    previewPosters: v.array(
      v.object({
        itemId: v.optional(v.id('items')),
        title: v.string(),
        posterPath: v.optional(v.string()),
      }),
    ),
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
    .index('by_user_tag_item', ['userId', 'tagKey', 'itemId'])
    .index('by_item', ['itemId']),
  episodes: defineTable(episodeValidator.omit('_id', '_creationTime'))
    .index('by_item', ['itemId', 'season', 'episode'])
    .index('by_item_identity', ['itemId', 'season', 'metadataProvider', 'seasonOrder', 'episode'])
    .index('by_user', ['userId'])
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
    currentSeasonVersion: v.optional(v.string()),
    currentTotal: v.optional(v.number()),
    currentWatchedCount: v.optional(v.number()),
    rebuildIdentityKey: v.optional(v.string()),
    rebuildSeasonVersion: v.optional(v.string()),
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
    ratingScale: v.optional(v.literal(5)),
    status: v.optional(statusValidator),
    createdAt: v.number(),
  }).index('by_actor_time', ['userId', 'createdAt']),
  requestThrottle: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index('by_key', ['key']),
  providerSnapshots: defineTable({
    key: v.string(),
    entry: providerSnapshotEntryValidator,
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
    metadataProvider: metadataProviderValidator,
    episodeCount: v.optional(v.number()),
    chunkCount: v.optional(v.number()),
    chunksComplete: v.optional(v.boolean()),
    // The visible chunk version. Staged writes use separate fields so readers
    // continue to see this complete version until the final atomic flip.
    seasonVersion: v.optional(v.string()),
    writeAttemptToken: v.optional(v.string()),
    nextChunkIndex: v.optional(v.number()),
    stagingVersion: v.optional(v.string()),
    stagingMetadataProvider: v.optional(metadataProviderValidator),
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
  titleMappings: defineTable(mappingWrite)
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
