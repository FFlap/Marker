import type { Doc } from './_generated/dataModel';

/** Storage boundaries decode the existing rows into explicit lifecycle states.
 * Published data is deliberately orthogonal to an in-progress replacement.
 * No additional persisted flag can drift out of sync with the durable fields.
 */
export type LeaseState =
  | { state: 'available' }
  | { state: 'expired'; token: string; expiresAt: number }
  | { state: 'owned'; token: string; expiresAt: number };
export function leaseState(
  row: { token: string; expiresAt: number } | null,
  now: number,
): LeaseState {
  if (!row) return { state: 'available' };
  return {
    state: row.expiresAt > now ? 'owned' : 'expired',
    token: row.token,
    expiresAt: row.expiresAt,
  };
}

export type RefreshRequestState =
  | { state: 'missing' }
  | { state: 'running'; attemptToken: string; until: number }
  | { state: 'expired'; attemptToken: string; until: number }
  | { state: 'backoff'; attemptToken: string; until: number }
  | { state: 'retryable'; attemptToken: string }
  | { state: 'succeeded'; attemptToken: string }
  | { state: 'notFound'; attemptToken: string };
export function refreshRequestState(
  row: Doc<'metadataRefreshRequests'> | null,
  now: number,
  backoff: number,
): RefreshRequestState {
  if (!row) return { state: 'missing' };
  const attemptToken = row.attemptToken;
  switch (row.state) {
    case 'inFlight':
      return {
        state: row.expiresAt > now ? 'running' : 'expired',
        attemptToken,
        until: row.expiresAt,
      };
    case 'failed': {
      const until = row.retryAt ?? (row.completedAt ?? row.lastRequestedAt) + backoff;
      return until > now
        ? { state: 'backoff', attemptToken, until }
        : { state: 'retryable', attemptToken };
    }
    case 'succeeded':
      return { state: 'succeeded', attemptToken };
    case 'notFound':
      return { state: 'notFound', attemptToken };
  }
}

type StagedSeason = {
  token: string;
  nextChunk: number;
  chunkCount: number;
  episodeCount: number;
  metadataProvider: 'tmdb' | 'tvdb';
  refreshedAt: number;
  orderEpoch: number;
};
export type SeasonWriteState =
  { state: 'idle' } | { state: 'invalid' } | ({ state: 'writing' | 'ready' } & StagedSeason);
export function seasonWriteState(row: Doc<'resolvedSeasons'> | null): SeasonWriteState {
  if (!row || row.stagingVersion === undefined) return { state: 'idle' };
  if (
    row.writeAttemptToken !== row.stagingVersion ||
    row.nextChunkIndex === undefined ||
    row.stagingChunkCount === undefined ||
    row.stagingEpisodeCount === undefined ||
    row.stagingMetadataProvider === undefined ||
    row.stagingRefreshedAt === undefined ||
    row.stagingOrderEpoch === undefined ||
    row.nextChunkIndex > row.stagingChunkCount
  )
    return { state: 'invalid' };
  return {
    state: row.nextChunkIndex === row.stagingChunkCount ? 'ready' : 'writing',
    token: row.stagingVersion,
    nextChunk: row.nextChunkIndex,
    chunkCount: row.stagingChunkCount,
    episodeCount: row.stagingEpisodeCount,
    metadataProvider: row.stagingMetadataProvider,
    refreshedAt: row.stagingRefreshedAt,
    orderEpoch: row.stagingOrderEpoch,
  };
}

export type DiscoveryState =
  | { state: 'missing' }
  | { state: 'fresh' }
  | { state: 'cooldown'; until: number }
  | {
      state: 'discovering' | 'abandoned';
      token: string;
      version: string;
      feed: number;
      page: number;
    }
  | { state: 'stale' };
export function discoveryState(
  row: Doc<'calendarMonths'> | null,
  now: number,
  ttl: number,
): DiscoveryState {
  if (!row) return { state: 'missing' };
  if (row.refreshedAt > now - ttl) return { state: 'fresh' };
  // A failure cooldown can retain resumable staging after releasing ownership.
  if ((row.discoveryRetryAt ?? 0) > now) return { state: 'cooldown', until: row.discoveryRetryAt! };
  if (row.leaseToken && row.stagingVersion)
    return {
      state: (row.leaseExpiresAt ?? 0) > now ? 'discovering' : 'abandoned',
      token: row.leaseToken,
      version: row.stagingVersion,
      feed: row.discoveryFeed ?? 0,
      page: row.discoveryPage ?? 1,
    };
  return { state: 'stale' };
}

export type ScheduleWriteState =
  | { state: 'idle' }
  | { state: 'writing'; token: string; nextChunk: number; refreshedAt: number; expiresAt: number };
export function scheduleWriteState(row: Doc<'calendarSchedules'> | null): ScheduleWriteState {
  return row?.stagingVersion !== undefined &&
    row.stagingNextChunk !== undefined &&
    row.stagingRefreshedAt !== undefined
    ? {
        state: 'writing',
        token: row.stagingVersion,
        nextChunk: row.stagingNextChunk,
        refreshedAt: row.stagingRefreshedAt,
        expiresAt: row.stagingExpiresAt ?? 0,
      }
    : { state: 'idle' };
}

export type ItemLifecycle =
  { state: 'missing' } | { state: 'active' } | { state: 'deleting'; since: number };
export function itemLifecycle(row: { deletingAt?: number } | null): ItemLifecycle {
  if (!row) return { state: 'missing' };
  return row.deletingAt === undefined
    ? { state: 'active' }
    : { state: 'deleting', since: row.deletingAt };
}

export type CursorJobState = { state: 'idle' } | { state: 'obsolete' } | { state: 'running' };
export function cursorJobState(row: { token: string } | null, token: string): CursorJobState {
  return !row ? { state: 'idle' } : { state: row.token === token ? 'running' : 'obsolete' };
}

export type SummaryRebuildState =
  | { state: 'idle' }
  | { state: 'obsolete' }
  | { state: 'rebuilding'; identity: string; version?: string; offset: number; revision: number };
export function summaryRebuildState(
  row: Doc<'episodeSummaries'> | null,
  revision?: number,
): SummaryRebuildState {
  if (!row || row.rebuildIdentityKey === undefined) return { state: 'idle' };
  if (revision !== undefined && row.rebuildRevision !== revision) return { state: 'obsolete' };
  return {
    state: 'rebuilding',
    identity: row.rebuildIdentityKey,
    version: row.rebuildSeasonVersion,
    offset: row.rebuildOffset ?? 0,
    revision: row.rebuildRevision ?? 0,
  };
}

export type StatsRefreshState =
  | { state: 'idle' }
  | { state: 'abandoned' }
  | { state: 'queued' }
  | { state: 'items' | 'summaries'; restart: boolean };
export function statsRefreshState(
  row: Doc<'profileStatsRefreshes'> | null,
  now: number,
  abandonedAfter: number,
): StatsRefreshState {
  if (!row) return { state: 'idle' };
  if (row.lastProgressAt === undefined || now - row.lastProgressAt > abandonedAfter)
    return { state: 'abandoned' };
  if (row.hasStarted === false) return { state: 'queued' };
  return { state: row.phase, restart: row.restartRequested };
}

export type AvatarState =
  | { state: 'missing' }
  | { state: 'expired' }
  | { state: 'reserved' }
  | { state: 'uploaded'; storageId: Doc<'avatarUploads'>['storageId'] }
  | { state: 'active'; storageId: Doc<'avatarUploads'>['storageId'] };
export function avatarState(
  row: Doc<'avatarUploads'> | null,
  now: number,
  ttl: number,
): AvatarState {
  if (!row) return { state: 'missing' };
  if (row.status === 'active') return { state: 'active', storageId: row.storageId };
  if (now - row.createdAt > ttl) return { state: 'expired' };
  return row.storageId === undefined
    ? { state: 'reserved' }
    : { state: 'uploaded', storageId: row.storageId };
}

export type FollowState = 'none' | 'pending' | 'accepted';
export function transitionFollow(
  current: FollowState,
  event: 'requestPublic' | 'requestPrivate' | 'accept' | 'remove',
): FollowState {
  switch (event) {
    case 'remove':
      return 'none';
    case 'accept':
      return current === 'pending' ? 'accepted' : current;
    case 'requestPublic':
      return 'accepted';
    case 'requestPrivate':
      return current === 'accepted' ? current : 'pending';
  }
}

export type CredentialState =
  | { state: 'missing' }
  | { state: 'expired' }
  | { state: 'usable'; token: string; expiresAt: number };
export function credentialState(
  row: { token: string; expiresAt: number } | null,
  now: number,
): CredentialState {
  if (!row) return { state: 'missing' };
  return row.expiresAt > now + 60_000
    ? { state: 'usable', token: row.token, expiresAt: row.expiresAt }
    : { state: 'expired' };
}

export type MappingState =
  | { state: 'automatic' }
  | { state: 'manualTmdb' }
  | {
      state: 'manualTvdb';
      mapping: Doc<'titleMappings'> & { tvdbId: number; seasonOrder: string };
    };
export function mappingState(mapping: Doc<'titleMappings'> | null): MappingState {
  if (mapping?.source !== 'manual') return { state: 'automatic' };
  if (mapping.tvdbId === undefined || mapping.seasonOrder === undefined)
    return { state: 'manualTmdb' };
  return {
    state: 'manualTvdb',
    mapping: { ...mapping, tvdbId: mapping.tvdbId, seasonOrder: mapping.seasonOrder },
  };
}

export type PublicationState =
  { state: 'missing' } | { state: 'superseded' } | { state: 'current' };
export function publicationState(
  title: { orderEpoch: number; refreshedAt: number } | null,
  mapping: { orderEpoch: number } | null,
  expected?: { orderEpoch: number; refreshedAt: number },
): PublicationState {
  if (!title) return { state: 'missing' };
  if (
    (mapping && title.orderEpoch !== mapping.orderEpoch) ||
    (expected &&
      (title.orderEpoch !== expected.orderEpoch || title.refreshedAt !== expected.refreshedAt))
  )
    return { state: 'superseded' };
  return { state: 'current' };
}

export type DiscoveryCursor = { state: 'next'; feed: number; page: number } | { state: 'publish' };
export function advanceDiscovery(
  feed: number,
  page: number,
  totalPages: number,
  feeds: number,
): DiscoveryCursor {
  const nextFeed = page >= totalPages ? feed + 1 : feed;
  return nextFeed >= feeds
    ? { state: 'publish' }
    : { state: 'next', feed: nextFeed, page: nextFeed === feed ? page + 1 : 1 };
}

export type RematchState =
  | { state: 'initial' }
  | { state: 'rematching'; code: 'stale_epoch' | 'stale_season_version'; refreshEpoch: boolean }
  | { state: 'terminal' };
export function transitionRematch(current: RematchState, staleCode: unknown): RematchState {
  return current.state === 'initial' &&
    (staleCode === 'stale_epoch' || staleCode === 'stale_season_version')
    ? { state: 'rematching', code: staleCode, refreshEpoch: staleCode === 'stale_epoch' }
    : { state: 'terminal' };
}

export type BulkWatchState =
  | { state: 'marking'; pass: number; seasons: number[] }
  | { state: 'ready' }
  | { state: 'exhausted' };
export function bulkWatchState(seasons: number[], pass: number, maxPasses: number): BulkWatchState {
  return seasons.length === 0
    ? { state: 'ready' }
    : pass >= maxPasses
      ? { state: 'exhausted' }
      : { state: 'marking', pass, seasons };
}
