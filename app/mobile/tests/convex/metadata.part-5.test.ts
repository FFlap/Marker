import { afterEach, describe, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { api, internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';
import { isTruncatedSnapshot, putNonFatal } from '../../convex/providerSnapshots';
import { MAX_METADATA_MUTATION_BYTES, serializedBytes } from '../../convex/seasonStorage';
import { mapSeasonDetails } from '../../convex/tmdb';
import { commitWatchWithOneRematch } from '../../convex/sync';
import { titleWriteForCapturedTitle } from '../../convex/resolvedMetadata/seasonResolution';

const modules = import.meta.glob('../../convex/**/*.ts');

async function setup(transactionLimits = false) {
  const t = convexTest({ schema, modules, transactionLimits });
  const clerkId = 'user_metadata_test';
  const userId = await t.run((ctx) => ctx.db.insert('users', { clerkId }));
  const asUser = t.withIdentity({ subject: clerkId });
  return { t, userId, asUser };
}

const movieTitle = (overrides: Record<string, unknown> = {}) => ({
  tmdbId: 77,
  mediaType: 'movie' as const,
  title: 'Stored movie',
  episodeRunTime: [],
  genres: [],
  cast: [],
  seasons: [],
  metadataProvider: 'tmdb' as const,
  orderEpoch: 0,
  refreshedAt: Date.now(),
  refreshAfter: Date.now() + 60_000,
  ...overrides,
});

const addItem = (asUser: Awaited<ReturnType<typeof setup>>['asUser'], tmdbId = 88) =>
  asUser.mutation(api.library.items.addItem, {
    tmdbId,
    mediaType: 'tv',
    title: 'Stored show',
    status: 'watching',
  });

describe('metadata pipeline', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    [1, 2],
    [2, 1],
  ])(
    'preserves both season title patches when season %i commits before season %i',
    async (firstSeason, secondSeason) => {
      const order = [firstSeason, secondSeason];
      const { t } = await setup();
      const capturedTitle = {
        ...movieTitle({
          tmdbId: 88,
          mediaType: 'tv',
          title: 'Concurrent show',
          seasons: [
            { season: 1, name: 'Season 1', episodeCount: 1 },
            { season: 2, name: 'Season 2', episodeCount: 1 },
          ],
        }),
        mediaType: 'tv' as const,
      };
      await t.run((ctx) => ctx.db.insert('resolvedTitles', capturedTitle));

      for (const season of order) {
        const attemptToken = `season-${season}`;
        const key = `season:88:${season}`;
        const leaseToken = `lease-${season}`;
        await t.run((ctx) =>
          ctx.db.insert('metadataRefreshRequests', {
            key,
            state: 'inFlight',
            lastRequestedAt: Date.now(),
            attemptToken,
            expiresAt: Date.now() + 60_000,
          }),
        );
        await t.mutation(internal.resolvedMetadata.requests.claimRefresh, {
          key: 'metadata:tv:88',
          token: leaseToken,
          leaseMs: 60_000,
        });
        const episodeCount = season === 1 ? 2 : 3;
        const episodes = Array.from({ length: episodeCount }, (_, index) => ({
          season,
          episode: index + 1,
          name: `S${season}E${index + 1}`,
        }));
        await expect(
          t.mutation(internal.resolvedMetadata.publication.commitRefresh, {
            title: capturedTitle,
            titleWrite: 'seasonPatch',
            season: {
              tmdbId: 88,
              season,
              metadataProvider: 'tmdb',
              chunks: [episodes],
              episodeCount,
              chunkCount: 1,
              refreshedAt: Date.now(),
              refreshAfter: Date.now() + 60_000,
              orderEpoch: 0,
            },
            outcomes: [{ key, state: 'succeeded' }],
            attemptToken,
            leaseKey: 'metadata:tv:88',
            leaseToken,
          }),
        ).resolves.toBe(true);
        await t.mutation(internal.resolvedMetadata.requests.releaseRefresh, {
          key: 'metadata:tv:88',
          token: leaseToken,
        });
      }

      expect(
        await t.query(internal.resolvedMetadata.reads.readTitle, { mediaType: 'tv', tmdbId: 88 }),
      ).toMatchObject({
        seasons: [
          { season: 1, episodeCount: 2 },
          { season: 2, episodeCount: 3 },
        ],
      });
    },
  );

  it('uses authoritative TMDB names for TVDB fallback discovery, never the touch title', async () => {
    const { t, userId, asUser } = await setup();
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'tmdb-key');
    vi.stubEnv('TVDB_API_KEY', 'tvdb-key');
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.endsWith('/login'))
          return new Response(JSON.stringify({ data: { token: 'tvdb-token' } }));
        if (url.includes('api.themoviedb.org/3/tv/88/season/1'))
          return new Response(
            JSON.stringify({
              season_number: 1,
              episodes: [{ id: 1, season_number: 1, episode_number: 1, name: 'TMDB episode' }],
            }),
          );
        if (url.includes('api.themoviedb.org/3/tv/88'))
          return new Response(
            JSON.stringify({
              id: 88,
              name: 'Authoritative Show',
              original_name: 'Authoritative Original',
              genres: [],
              credits: {},
              seasons: [{ season_number: 1, name: 'Season 1', episode_count: 1 }],
            }),
          );
        if (url.includes('/search/remoteid/88')) return new Response(JSON.stringify({ data: [] }));
        if (url.includes('/search?'))
          return new Response(
            JSON.stringify({
              data: [{ id: 'series-999', type: 'series', name: 'Wrong Anime' }],
            }),
          );
        return new Response('{}', { status: 404 });
      }),
    );

    const decision = (await asUser.mutation(api.resolvedMetadata.touch.touchTitle, {
      mediaType: 'tv',
      tmdbId: 88,
      title: 'Wrong Anime',
      season: 1,
    })) as any;
    await t.action(internal.resolvedMetadata.orchestration.orchestrateRefresh, {
      userId,
      mediaType: 'tv',
      tmdbId: 88,
      title: 'Wrong Anime',
      season: 1,
      keys: ['title:tv:88', 'season:88:1'],
      attemptToken: decision.title.attemptToken,
    });

    await expect(
      t.query(internal.resolvedMetadata.reads.readTitle, { mediaType: 'tv', tmdbId: 88 }),
    ).resolves.toMatchObject({
      title: 'Authoritative Show',
      metadataProvider: 'tmdb',
    });
    await expect(
      t.query(internal.resolvedMetadata.reads.readTitleMapping, { mediaType: 'tv', tmdbId: 88 }),
    ).resolves.not.toMatchObject({ tvdbId: 999 });
    expect(requestedUrls.some((url) => url.includes('query=Wrong%20Anime'))).toBe(false);
    expect(requestedUrls.some((url) => url.includes('/series/999/extended'))).toBe(false);
    expect(requestedUrls.some((url) => url.includes('query=Authoritative%20Show'))).toBe(true);
    expect(requestedUrls.some((url) => url.includes('query=Authoritative%20Original'))).toBe(true);
  });
});
