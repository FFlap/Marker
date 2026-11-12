import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { internal } from '../_generated/api';
import { ownedItem } from './shared';
import { readFreshCatalogSnapshot } from '../tvdbCatalog';
import { SNAPSHOT_TTL_MS } from '../providerSnapshots';
import { isEpisodeReleased, releasedEpisodes } from '../episodeAvailability';
import { cleanEpisode, mergeEpisodes, SEASON_FRESH_MS } from '../resolvedMetadata/shared';
import { nextReleaseBoundary } from '../resolvedMetadata/seasonSummaries';
import { refreshLeaseKey, requestKey, seasonRequestKey } from '../resolvedMetadata/requests';
import {
  beginPrechunkedSeasonWrite,
  appendPrechunkedSeasonChunk,
  finalizePrechunkedSeasonWrite,
  episodeChunks,
  type ResolvedEpisode,
} from '../seasonStorage';

const MAX_WATCH_METADATA_SEASONS = 40;
const MAX_WATCH_METADATA_EPISODES = 2_000;
const MAX_TMDB_SNAPSHOT_BYTES = 2 * 1024 * 1024;

/**
 * Publish a bounded series from fresh, validated provider snapshots in one transaction.
 * No network work occurs here. A live publication lease or pending touch retains
 * the existing coordinator path. Reading those rows also detects concurrent claims
 * through OCC, so a mapping change or another publisher cannot be overwritten.
 */
export async function publishWatchMetadataFromSnapshots(
  ctx: MutationCtx,
  { userId, itemId }: { userId: Id<'users'>; itemId: Id<'items'> },
): Promise<boolean> {
  const item = await ownedItem(ctx, itemId, userId);
  if (item.mediaType !== 'tv') return false;
  const now = Date.now();
  const [title, mapping, lease] = await Promise.all([
    ctx.db
      .query('resolvedTitles')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', 'tv').eq('tmdbId', item.tmdbId))
      .unique(),
    ctx.db
      .query('titleMappings')
      .withIndex('by_tmdb', (q) => q.eq('mediaType', 'tv').eq('tmdbId', item.tmdbId))
      .unique(),
    ctx.db
      .query('metadataRefreshLeases')
      .withIndex('by_key', (q) => q.eq('key', refreshLeaseKey('tv', item.tmdbId)))
      .unique(),
  ]);
  if (
    !title ||
    !mapping ||
    title.orderEpoch !== mapping.orderEpoch ||
    title.refreshAfter <= now ||
    title.seasons.length > MAX_WATCH_METADATA_SEASONS ||
    (lease && lease.expiresAt > now)
  )
    return false;
  if (
    title.metadataProvider === 'tvdb' &&
    (!title.tvdbId ||
      !title.seasonOrder ||
      title.tvdbId !== mapping.tvdbId ||
      title.seasonOrder !== mapping.seasonOrder)
  )
    return false;
  if (title.metadataProvider === 'tmdb' && mapping.tvdbId !== undefined) return false;
  const seasons = title.seasons.filter((season) => season.season >= 0);
  const requests = await Promise.all(
    [
      requestKey('tv', item.tmdbId),
      ...seasons.map((season) => seasonRequestKey(item.tmdbId, season.season)),
    ].map((key) =>
      ctx.db
        .query('metadataRefreshRequests')
        .withIndex('by_key', (q) => q.eq('key', key))
        .unique(),
    ),
  );
  if (requests.some((request) => request && request.state !== 'succeeded')) return false;
  const current = await Promise.all(
    seasons.map((season) =>
      ctx.db
        .query('resolvedSeasons')
        .withIndex('by_tmdb_season', (q) => q.eq('tmdbId', item.tmdbId).eq('season', season.season))
        .unique(),
    ),
  );
  // Bound replacement work as well as new payloads. Abandoned staging and
  // oversized old generations remain with the restartable coordinator.
  if (
    current.some((season) => season?.stagingVersion !== undefined) ||
    current.reduce((sum, season) => sum + (season?.episodeCount ?? 0), 0) >
      MAX_WATCH_METADATA_EPISODES ||
    current.reduce((sum, season) => sum + (season?.chunkCount ?? 0), 0) > 40 ||
    new TextEncoder().encode(JSON.stringify(current)).byteLength > 512 * 1024
  )
    return false;
  const fresh = current.map(
    (season) =>
      !!season &&
      season.orderEpoch === title.orderEpoch &&
      season.metadataProvider === title.metadataProvider &&
      season.chunksComplete === true &&
      season.seasonVersion !== undefined &&
      season.chunkCount !== undefined &&
      season.episodeCount !== undefined &&
      season.refreshAfter > now,
  );
  if (fresh.every(Boolean)) return true;
  const catalog =
    title.metadataProvider === 'tvdb'
      ? await readFreshCatalogSnapshot(ctx, { id: title.tvdbId!, order: title.seasonOrder! })
      : null;
  if (title.metadataProvider === 'tvdb' && catalog === null) return false;
  const seasonNumbers = new Set(seasons.map((season) => season.season));
  if (
    catalog?.some(
      (episode) =>
        episode.season >= 0 &&
        isEpisodeReleased(episode, now) &&
        !seasonNumbers.has(episode.season),
    )
  )
    return false;
  if (catalog && new TextEncoder().encode(JSON.stringify(catalog)).byteLength > 2 * 1024 * 1024)
    return false;
  const updates: { season: number; episodes: ResolvedEpisode[] }[] = [];
  let total = 0;
  let snapshotBytes = 0;
  for (const [index, season] of seasons.entries()) {
    if (fresh[index]) {
      total += current[index]!.episodeCount!;
    } else {
      const snapshot = await ctx.db
        .query('providerSnapshots')
        .withIndex('by_key', (q) => q.eq('key', `tmdb:season:${item.tmdbId}:${season.season}`))
        .unique();
      if (
        !snapshot ||
        snapshot.entry.kind !== 'episodes' ||
        snapshot.refreshedAt <= now - SNAPSHOT_TTL_MS
      )
        return false;
      snapshotBytes += new TextEncoder().encode(JSON.stringify(snapshot.entry.value)).byteLength;
      if (snapshotBytes > MAX_TMDB_SNAPSHOT_BYTES) return false;
      const episodes =
        catalog === null
          ? releasedEpisodes(snapshot.entry.value).map(cleanEpisode)
          : mergeEpisodes(
              catalog.filter((episode) => episode.season === season.season),
              snapshot.entry.value,
            );
      if (episodes.length === 0 && season.episodeCount > 0) return false;
      total += episodes.length;
      updates.push({ season: season.season, episodes });
    }
    if (total > MAX_WATCH_METADATA_EPISODES) return false;
  }
  // All fallback checks precede writes. Every published season is complete and
  // shares the mapping read above; no partial generation is externally visible.
  const generation = `watch:${item._id}:${crypto.randomUUID()}`;
  for (const update of updates) {
    const chunks = episodeChunks(update.episodes);
    const attemptToken = `${generation}:${update.season}`;
    await beginPrechunkedSeasonWrite(
      ctx,
      {
        tmdbId: item.tmdbId,
        season: update.season,
        metadataProvider: title.metadataProvider,
        chunks: chunks.slice(0, 1),
        chunkCount: chunks.length,
        episodeCount: update.episodes.length,
        refreshedAt: now,
        refreshAfter: Math.min(nextReleaseBoundary(now), now + SEASON_FRESH_MS),
        orderEpoch: mapping.orderEpoch,
      },
      attemptToken,
    );
    for (let chunkIndex = 1; chunkIndex < chunks.length; chunkIndex += 1) {
      const appended = await appendPrechunkedSeasonChunk(ctx, {
        tmdbId: item.tmdbId,
        season: update.season,
        orderEpoch: mapping.orderEpoch,
        chunkIndex,
        episodes: chunks[chunkIndex]!,
        attemptToken,
      });
      if (!appended) throw new Error('Bulk season publication was superseded');
    }
    if (
      !(await finalizePrechunkedSeasonWrite(ctx, {
        tmdbId: item.tmdbId,
        season: update.season,
        attemptToken,
      }))
    )
      throw new Error('Bulk season publication was incomplete');
    await ctx.scheduler.runAfter(0, internal.episodeSummaries.reconcileSeasonSummaries, {
      tmdbId: item.tmdbId,
      season: update.season,
    });
  }
  const counts = new Map(updates.map((update) => [update.season, update.episodes.length]));
  await ctx.db.patch(title._id, {
    seasons: title.seasons.map((season) =>
      counts.has(season.season)
        ? { ...season, episodeCount: counts.get(season.season)!, episodeCountVerified: true }
        : season,
    ),
  });
  await ctx.db.patch(mapping._id, { updatedAt: now });
  return true;
}
