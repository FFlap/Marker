import { describe, expect, it } from 'vitest';
import type { Doc } from '../../convex/_generated/dataModel';
import {
  leaseState,
  refreshRequestState,
  seasonWriteState,
  discoveryState,
  advanceDiscovery,
  transitionFollow,
  transitionRematch,
  bulkWatchState,
  cursorJobState,
} from '../../convex/lifecycles';

describe('durable workflow boundaries', () => {
  it('allows reclaim at lease expiry and fences replaced tokens', () => {
    expect(leaseState({ token: 'old', expiresAt: 10 }, 9).state).toBe('owned');
    expect(leaseState({ token: 'old', expiresAt: 10 }, 10).state).toBe('expired');
    expect(cursorJobState({ token: 'new' }, 'old').state).toBe('obsolete');
  });
  it('distinguishes an expired in-flight request from an explicit failure cooldown', () => {
    const row = {
      state: 'inFlight',
      attemptToken: 'a',
      expiresAt: 10,
    } as Doc<'metadataRefreshRequests'>;
    expect(refreshRequestState(row, 10, 5).state).toBe('expired');
    expect(refreshRequestState({ ...row, state: 'failed', completedAt: 10 }, 14, 5).state).toBe(
      'backoff',
    );
    expect(refreshRequestState({ ...row, state: 'failed', completedAt: 10 }, 15, 5).state).toBe(
      'retryable',
    );
  });
  it('never finalizes incomplete, corrupt, or replaced staging', () => {
    const row = {
      stagingVersion: 'a',
      writeAttemptToken: 'a',
      nextChunkIndex: 0,
      stagingChunkCount: 2,
      stagingEpisodeCount: 121,
      stagingMetadataProvider: 'tmdb',
      stagingRefreshedAt: 1,
      stagingOrderEpoch: 0,
    } as Doc<'resolvedSeasons'>;
    expect(seasonWriteState(row).state).toBe('writing');
    expect(seasonWriteState({ ...row, nextChunkIndex: 2 }).state).toBe('ready');
    expect(seasonWriteState({ ...row, nextChunkIndex: 3 }).state).toBe('invalid');
    expect(seasonWriteState({ ...row, writeAttemptToken: 'b' }).state).toBe('invalid');
    expect(seasonWriteState({ ...row, stagingMetadataProvider: undefined }).state).toBe('invalid');
  });
  it('retains resumable discovery progress during cooldown without claiming ownership', () => {
    const row = {
      refreshedAt: 0,
      stagingVersion: 'a',
      discoveryRetryAt: 50,
    } as Doc<'calendarMonths'>;
    expect(discoveryState(row, 40, 10)).toEqual({ state: 'cooldown', until: 50 });
    expect(discoveryState(row, 50, 10).state).toBe('stale');
    expect(advanceDiscovery(0, 2, 2, 2)).toEqual({ state: 'next', feed: 1, page: 1 });
    expect(advanceDiscovery(1, 2, 2, 2)).toEqual({ state: 'publish' });
  });
  it('does not downgrade an accepted follow or rematch a write twice', () => {
    expect(transitionFollow('accepted', 'requestPrivate')).toBe('accepted');
    expect(transitionFollow('pending', 'remove')).toBe('none');
    const rematch = transitionRematch({ state: 'initial' }, 'stale_epoch');
    expect(rematch).toEqual({ state: 'rematching', code: 'stale_epoch', refreshEpoch: true });
    expect(transitionRematch(rematch, 'stale_epoch').state).toBe('terminal');
    expect(bulkWatchState([], 4, 4).state).toBe('ready');
    expect(bulkWatchState([1], 4, 4).state).toBe('exhausted');
  });
});
