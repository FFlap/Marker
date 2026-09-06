import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import schema from '../../convex/schema';
import { api, internal } from '../../convex/_generated/api';
import { seasonSummaryIdentityKey } from '../../convex/episodeSummaries';

const modules = import.meta.glob('../../convex/**/*.ts');

async function setup() {
  const t = convexTest(schema, modules);
  const clerkId = 'review_regression_user';
  const userId = await t.run((ctx) => ctx.db.insert('users', { clerkId }));
  return { t, userId, asUser: t.withIdentity({ subject: clerkId }) };
}

describe('review regressions', () => {
  it('does not rebuild an episode summary that already uses the current identity', async () => {
    const { t, userId } = await setup();
    const { itemId, identityKey } = await t.run(async (ctx) => {
      const itemId = await ctx.db.insert('items', {
        userId,
        tmdbId: 501,
        mediaType: 'tv',
        title: 'Current Summary',
        normalizedTitle: 'current summary',
        isAnime: false,
        status: 'watching',
        timesWatched: 0,
        tags: [],
        rank: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert('titleMappings', {
        tmdbId: 501,
        mediaType: 'tv',
        source: 'auto',
        orderEpoch: 0,
        updatedAt: 1,
      });
      const season = {
        tmdbId: 501,
        season: 1,
        metadataProvider: 'tmdb' as const,
        episodeCount: 12,
        chunkCount: 1,
        chunksComplete: true,
        seasonVersion: 'current-summary',
        refreshedAt: 1,
        refreshAfter: 2,
        orderEpoch: 0,
      };
      await ctx.db.insert('resolvedSeasons', season);
      const identityKey = seasonSummaryIdentityKey(season);
      await ctx.db.insert('episodeSummaries', {
        userId,
        itemId,
        season: 1,
        total: 12,
        watchedCount: 3,
        watchedRuntimeMinutes: 72,
        watchedRuntimeFallbackCount: 0,
        tagCounts: [],
        currentIdentityKey: identityKey,
        currentSeasonVersion: season.seasonVersion,
        currentTotal: 12,
        currentWatchedCount: 3,
      });
      return { itemId, identityKey };
    });

    await expect(
      t.mutation(internal.episodeSummaries.reconcileSeasonSummaries, {
        tmdbId: 501,
        season: 1,
      }),
    ).resolves.toEqual({ work: 0, isDone: true });

    const summary = await t.run((ctx) =>
      ctx.db
        .query('episodeSummaries')
        .withIndex('by_item', (query) => query.eq('itemId', itemId).eq('season', 1))
        .unique(),
    );
    expect(summary).toMatchObject({ currentIdentityKey: identityKey });
    expect(summary?.rebuildIdentityKey).toBeUndefined();
  });

  it('can change visibility after the final item leaves a tag', async () => {
    const { asUser } = await setup();
    const itemId = await asUser.mutation(api.library.items.addItem, {
      tmdbId: 502,
      mediaType: 'movie',
      title: 'Temporary Tag',
      status: 'watchlist',
      tags: ['Archive'],
    });
    await asUser.mutation(api.library.items.updateItem, { itemId, tags: [] });

    await expect(
      asUser.mutation(api.tags.setVisibility, { tag: 'Archive', isPublic: true }),
    ).resolves.toBeDefined();
    await expect(asUser.query(api.tags.visibility, { tag: 'archive' })).resolves.toEqual({
      isPublic: true,
    });
  });

  it('restarts public tag pagination when the cursor is malformed', async () => {
    const { asUser } = await setup();
    await asUser.mutation(api.library.items.addItem, {
      tmdbId: 503,
      mediaType: 'movie',
      title: 'Cursor Recovery',
      status: 'watchlist',
      tags: ['Public'],
    });
    await asUser.mutation(api.tags.setVisibility, { tag: 'Public', isPublic: true });

    const details = await asUser.query(api.tags.publicDetails, {
      tag: 'Public',
      cursor: '{not-json',
    });
    expect(details?.titles).toMatchObject([{ title: 'Cursor Recovery' }]);
  });
});

it.each(['changed', 'missing'])(
  'does not stamp TMDB metadata with a %s mapping',
  async (mappingState) => {
    const { t, userId, asUser } = await setup();
    const itemId = await asUser.mutation(api.library.items.addItem, {
      tmdbId: 505,
      mediaType: 'tv',
      title: 'Changed order',
      status: 'watching',
    });
    await t.run(async (ctx) => {
      if (mappingState === 'changed')
        await ctx.db.insert('titleMappings', {
          tmdbId: 505,
          mediaType: 'tv',
          tvdbId: 500,
          seasonOrder: 'official',
          source: 'manual',
          orderEpoch: 2,
          updatedAt: 2,
        });
      await ctx.db.insert('resolvedSeasons', {
        tmdbId: 505,
        season: 1,
        metadataProvider: 'tmdb',
        orderEpoch: 1,
        episodeCount: 1,
        chunkCount: 1,
        chunksComplete: true,
        seasonVersion: 'old-order',
        refreshedAt: 1,
        refreshAfter: 9999999999999,
      });
      await ctx.db.insert('resolvedSeasonChunks', {
        tmdbId: 505,
        season: 1,
        orderEpoch: 1,
        seasonVersion: 'old-order',
        chunkIndex: 0,
        refreshedAt: 1,
        episodes: [{ season: 1, episode: 1, name: 'Obsolete title', providerEpisodeId: 99 }],
      });
    });
    const episodeId = await asUser.mutation(api.library.episodes.setEpisodeState, {
      itemId,
      season: 1,
      episode: 1,
      watched: true,
      name: 'Current title',
    });
    const episode = await t.run((ctx) => ctx.db.get(episodeId));
    expect(episode?.name).toBe('Current title');
    expect(episode?.providerEpisodeId).toBeUndefined();

    await t.mutation(internal.sync.recordWatchInternal, {
      userId,
      itemId,
      season: 1,
      episode: 1,
      name: 'Current title',
    });
    expect((await t.run((ctx) => ctx.db.get(episodeId)))?.providerEpisodeId).toBeUndefined();
  },
);
