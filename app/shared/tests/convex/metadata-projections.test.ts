import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../../convex/_generated/api';
import type { ResolvedTitle } from '../../convex/resolvedMetadata/shared';
import schema from '../../convex/schema';
import { putSeason, putTitle } from './metadata-fixtures';

const modules = import.meta.glob('../../convex/**/*.ts');

afterEach(() => vi.useRealTimers());

it.each(['movie', 'tv'] as const)(
  'updates watched minutes when published %s metadata corrects the runtime',
  async (mediaType) => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert('users', { clerkId: 'runtime-correction' }));
    const viewer = t.withIdentity({ subject: 'runtime-correction' });
    const itemId = await viewer.mutation(api.library.items.addItem, {
      tmdbId: 77,
      mediaType,
      title: 'Runtime correction',
      status: mediaType === 'movie' ? 'watched' : 'watchlist',
      timesWatched: 2,
      runtime: 20,
    });
    if (mediaType === 'tv')
      await viewer.mutation(api.library.episodes.setEpisodeState, {
        itemId,
        season: 1,
        episode: 1,
        watched: true,
      });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const watchedCount = mediaType === 'movie' ? 2 : 1;
    expect((await viewer.query(api.stats.profile, {})).totalWatchMinutes).toBe(20 * watchedCount);

    await putTitle(t, {
      value: {
        tmdbId: 77,
        mediaType,
        title: 'Runtime correction',
        ...(mediaType === 'movie' && { runtime: 35 }),
        episodeRunTime: mediaType === 'tv' ? [30, 40] : [],
        genres: [],
        cast: [],
        seasons: [],
        metadataProvider: 'tmdb',
        orderEpoch: 0,
        refreshedAt: Date.now(),
        refreshAfter: Date.now() + 60_000,
      },
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    expect((await t.run((ctx) => ctx.db.get(itemId)))?.runtime).toBe(35);
    expect((await viewer.query(api.stats.profile, {})).totalWatchMinutes).toBe(35 * watchedCount);
  },
);

it.each(['/corrected.jpg', undefined])(
  'updates public and private tag previews when title metadata changes, including poster %s',
  async (posterPath) => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    const userId = await t.run((ctx) => ctx.db.insert('users', { clerkId: 'tag-preview-refresh' }));
    const viewer = t.withIdentity({ subject: 'tag-preview-refresh' });
    const tags = ['Public favorites', 'Private favorites'];
    const itemIds = [];
    for (const tmdbId of [11, 22, 33])
      itemIds.push(
        await viewer.mutation(api.library.items.addItem, {
          tmdbId,
          mediaType: 'movie',
          title: 'Original title',
          posterPath: '/original.jpg',
          status: 'watchlist',
          tags,
        }),
      );
    await viewer.mutation(api.tags.setVisibility, { tag: tags[0]!, isPublic: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const collectionsBefore = await t.run((ctx) =>
      ctx.db
        .query('tagCollections')
        .withIndex('by_user_tag', (query) => query.eq('userId', userId))
        .take(10),
    );
    const membershipsBefore = await t.run((ctx) =>
      ctx.db
        .query('tagMemberships')
        .withIndex('by_user_tag_item', (query) => query.eq('userId', userId))
        .take(10),
    );
    const title: ResolvedTitle = {
      tmdbId: 22,
      mediaType: 'movie',
      title: 'Corrected title',
      ...(posterPath !== undefined && { posterPath }),
      episodeRunTime: [],
      genres: [],
      cast: [],
      seasons: [],
      metadataProvider: 'tmdb',
      orderEpoch: 0,
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
    };
    vi.advanceTimersByTime(1_000);
    await putTitle(t, { value: title });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const collectionsAfter = await t.run((ctx) =>
      Promise.all(collectionsBefore.map((collection) => ctx.db.get(collection._id))),
    );
    for (const [index, before] of collectionsBefore.entries()) {
      const after = collectionsAfter[index]!;
      expect(after).toEqual({
        ...before,
        updatedAt: Date.now(),
        previewPosters: [
          before.previewPosters[0],
          { itemId: itemIds[1], title: 'Corrected title', ...(posterPath && { posterPath }) },
          before.previewPosters[2],
        ],
      });
    }
    const publicPreviews = await viewer.query(api.tags.myPublic, {});
    expect(publicPreviews[0]?.posters[1]).toEqual({
      title: 'Corrected title',
      ...(posterPath && { posterPath }),
    });
    const privatePreviews = await viewer.query(api.tags.mine, {
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(privatePreviews.page.find((entry) => entry.tag === tags[1])?.posters[1]).toEqual({
      itemId: itemIds[1],
      title: 'Corrected title',
      ...(posterPath && { posterPath }),
    });
    expect(
      await t.run((ctx) =>
        ctx.db
          .query('tagMemberships')
          .withIndex('by_user_tag_item', (query) => query.eq('userId', userId))
          .take(10),
      ),
    ).toEqual(membershipsBefore);

    vi.advanceTimersByTime(1_000);
    await putTitle(t, { value: { ...title, refreshedAt: Date.now() } });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(
      await t.run((ctx) =>
        Promise.all(collectionsBefore.map((collection) => ctx.db.get(collection._id))),
      ),
    ).toEqual(collectionsAfter);
  },
);

it.each([35, undefined])(
  'updates watched minutes when published episode runtime becomes %s without changing watch state',
  async (runtime) => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    await t.run((ctx) => ctx.db.insert('users', { clerkId: 'episode-runtime-correction' }));
    const viewer = t.withIdentity({ subject: 'episode-runtime-correction' });
    await putTitle(t, {
      value: {
        tmdbId: 88,
        mediaType: 'tv',
        title: 'Episode runtime correction',
        episodeRunTime: [30],
        genres: [],
        cast: [],
        seasons: [{ season: 1, name: 'Season 1', episodeCount: 1 }],
        metadataProvider: 'tmdb',
        orderEpoch: 0,
        refreshedAt: Date.now(),
        refreshAfter: Date.now() + 60_000,
      },
    });
    const episode = { season: 1, episode: 1, name: 'Premiere', providerEpisodeId: 123 };
    await putSeason(t, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: [{ ...episode, runtime: 20 }],
      orderEpoch: 0,
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
    });
    const itemId = await viewer.mutation(api.library.items.addItem, {
      tmdbId: 88,
      mediaType: 'tv',
      title: 'Episode runtime correction',
      status: 'watchlist',
      runtime: 30,
    });
    const episodeId = await viewer.mutation(api.library.episodes.setEpisodeState, {
      itemId,
      season: 1,
      episode: 1,
      watched: true,
      rating: 4,
      tags: ['Favorite'],
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect((await viewer.query(api.stats.profile, {})).totalWatchMinutes).toBe(20);
    const savedBefore = await t.run((ctx) => ctx.db.get(episodeId));

    vi.advanceTimersByTime(1_000);
    await putSeason(t, {
      tmdbId: 88,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: [{ ...episode, ...(runtime !== undefined && { runtime }) }],
      orderEpoch: 0,
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const savedAfter = await t.run((ctx) => ctx.db.get(episodeId));
    expect(savedAfter?.runtime).toBe(runtime);
    expect(savedAfter).toMatchObject({
      watched: true,
      watchedAt: savedBefore?.watchedAt,
      rating: 4,
      tags: ['Favorite'],
      metadataProvider: 'tmdb',
      providerEpisodeId: 123,
    });
    expect(await viewer.query(api.stats.profile, {})).toMatchObject({
      totalWatchMinutes: runtime ?? 30,
      episodesWatched: 1,
    });
  },
);
