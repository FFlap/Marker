import { afterEach, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';

const modules = import.meta.glob('../../convex/**/*.ts');
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each([false, true])(
  'forces both season providers concurrently after a newer title refresh (title continuation: %s)',
  async (fromTitleRefresh) => {
    const t = convexTest({ schema, modules });
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'review-test');
    vi.stubEnv('TVDB_API_KEY', 'review-test');
    const now = Date.now();
    const userId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', { clerkId: 'season-review' });
      await ctx.db.insert('titleMappings', {
        tmdbId: 88,
        mediaType: 'tv',
        tvdbId: 555,
        seasonOrder: 'official',
        source: 'auto',
        orderEpoch: 0,
        updatedAt: now,
      });
      await ctx.db.insert('resolvedTitles', {
        tmdbId: 88,
        mediaType: 'tv',
        title: 'Anime',
        genres: ['Animation'],
        cast: [],
        episodeRunTime: [],
        seasons: [{ season: 1, name: 'Season 1', episodeCount: 1, episodeCountVerified: true }],
        metadataProvider: 'tvdb',
        tvdbId: 555,
        seasonOrder: 'official',
        orderEpoch: 0,
        refreshedAt: now,
        refreshAfter: now + 60_000,
      });
      await ctx.db.insert('metadataRefreshRequests', {
        key: 'season:88:1',
        state: 'inFlight',
        lastRequestedAt: now - 1,
        attemptToken: 'review',
        expiresAt: now + 60_000,
      });
      return userId;
    });
    for (const key of ['tmdb:season:88:1', 'tvdb:season:555:official:1'])
      await t.mutation(internal.providerSnapshots.put, {
        key,
        entry: { kind: 'episodes', value: [{ season: 1, episode: 1, name: 'Cached' }] },
      });
    let releaseTmdb!: () => void;
    const tmdbGate = new Promise<void>((resolve) => {
      releaseTmdb = resolve;
    });
    let tmdbStarted = false;
    let tvdbStarted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith('/login')) return Response.json({ data: { token: 'review-token' } });
        if (url.includes('/tv/88/season/1')) {
          tmdbStarted = true;
          await tmdbGate;
          return Response.json({
            episodes: [
              { episode_number: 1, season_number: 1, name: 'Fresh', air_date: '2020-01-01' },
            ],
          });
        }
        if (url.includes('/series/555/episodes/official/eng')) {
          tvdbStarted = true;
          return Response.json({
            data: {
              episodes: [{ id: 1, seasonNumber: 1, number: 1, name: 'Fresh', aired: '2020-01-01' }],
            },
            links: { next: null },
          });
        }
        throw new Error(`Unexpected request ${url}`);
      }),
    );
    const refreshing = t.action(internal.resolvedMetadata.orchestration.orchestrateSeasonRefresh, {
      userId,
      tmdbId: 88,
      season: 1,
      key: 'season:88:1',
      attemptToken: 'review',
      force: true,
      fromTitleRefresh,
    });
    try {
      await vi.waitFor(() => {
        expect(tmdbStarted).toBe(true);
        expect(tvdbStarted).toBe(true);
      });
    } finally {
      releaseTmdb();
      await refreshing;
    }
    const season = await t.query(internal.resolvedMetadata.reads.readSeason, {
      tmdbId: 88,
      season: 1,
    });
    expect(season?.episodes[0].name).toBe('Fresh');
    const request = await t.query(internal.resolvedMetadata.orchestration.readRefreshRequest, {
      key: 'season:88:1',
    });
    expect(request?.state).toBe('succeeded');
  },
);
