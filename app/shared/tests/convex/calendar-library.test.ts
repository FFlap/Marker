import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';

const modules = import.meta.glob('../../convex/**/*.ts');

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert('users', { clerkId: 'calendar-owner' }));
  await t.run((ctx) => ctx.db.insert('users', { clerkId: 'other-owner' }));
  return {
    t,
    userId,
    viewer: t.withIdentity({ subject: 'calendar-owner' }),
    other: t.withIdentity({ subject: 'other-owner' }),
  };
}

const movie = {
  tmdbId: 77,
  mediaType: 'movie' as const,
  title: 'Upcoming movie',
  status: 'watchlist' as const,
};

describe('calendar library revision', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('requires authentication and scopes invalidation to the current user', async () => {
    const { t, viewer, other } = await setup();
    await expect(t.query(api.calendarLibrary.revision, {})).rejects.toThrow(
      'Authentication required',
    );
    expect(await viewer.query(api.calendarLibrary.revision, {})).toBe(0);
    await viewer.mutation(api.library.items.addItem, movie);
    expect(await viewer.query(api.calendarLibrary.revision, {})).toBe(1);
    expect(await other.query(api.calendarLibrary.revision, {})).toBe(0);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  });

  it('invalidates add, drop, restore, and immediate removal but ignores unrelated edits', async () => {
    const { t, viewer } = await setup();
    const itemId = await viewer.mutation(api.library.items.addItem, movie);
    await viewer.mutation(api.library.items.updateItem, { itemId, status: 'dropped' });
    expect(await viewer.query(api.calendarLibrary.revision, {})).toBe(2);
    await viewer.mutation(api.library.items.updateItem, {
      itemId,
      status: 'dropped',
      rating: 4,
      tags: ['Favorite'],
    });
    expect(await viewer.query(api.calendarLibrary.revision, {})).toBe(2);
    await viewer.mutation(api.library.ordering.reorderItem, { itemId, status: 'watchlist' });
    expect(await viewer.query(api.calendarLibrary.revision, {})).toBe(3);
    await viewer.mutation(api.library.ordering.reorderItem, { itemId });
    expect(await viewer.query(api.calendarLibrary.revision, {})).toBe(3);
    await viewer.mutation(api.library.items.removeItem, { itemId });
    expect(await viewer.query(api.calendarLibrary.revision, {})).toBe(4);
    await viewer.mutation(api.library.items.removeItem, { itemId });
    expect(await viewer.query(api.calendarLibrary.revision, {})).toBe(4);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  });

  it('invalidates extension imports and status changes, but not repeated episode watches', async () => {
    const { t, viewer, userId } = await setup();
    const candidate = { userId, tmdbId: 88, title: 'Synced show' };
    const { itemId } = await t.mutation(internal.sync.finalizeResolvedTvWatch, { candidate });
    expect(await viewer.query(api.calendarLibrary.revision, {})).toBe(1);
    await t.mutation(internal.sync.finalizeResolvedTvWatch, { candidate });
    expect(await viewer.query(api.calendarLibrary.revision, {})).toBe(1);
    await viewer.mutation(api.library.items.updateItem, { itemId, status: 'dropped' });
    await t.mutation(internal.sync.recordWatchInternal, { userId, itemId, season: 1, episode: 1 });
    expect(await viewer.query(api.calendarLibrary.revision, {})).toBe(3);
    await t.mutation(internal.sync.recordWatchInternal, { userId, itemId, season: 1, episode: 2 });
    expect(await viewer.query(api.calendarLibrary.revision, {})).toBe(3);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  });

  it('invalidates rolled-back additions when watched import fails', async () => {
    const { t, viewer, userId } = await setup();
    const itemId = await t.mutation(internal.library.items.addItemInternal, { userId, ...movie });
    expect(await viewer.query(api.calendarLibrary.revision, {})).toBe(1);
    await t.mutation(internal.library.seasonWatched.discardAddedItem, { userId, itemId });
    expect(await viewer.query(api.calendarLibrary.revision, {})).toBe(2);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  });

  it('invalidates corrected release dates and display metadata, but not runtime-only refreshes', async () => {
    const { t, viewer } = await setup();
    await viewer.mutation(api.library.items.addItem, movie);
    const titleId = await t.run((ctx) =>
      ctx.db.insert('resolvedTitles', {
        tmdbId: movie.tmdbId,
        mediaType: movie.mediaType,
        title: movie.title,
        releaseDate: '2026-10-15',
        episodeRunTime: [],
        genres: [],
        cast: [],
        seasons: [],
        metadataProvider: 'tmdb',
        orderEpoch: 0,
        refreshedAt: Date.now(),
        refreshAfter: Date.now() + 60_000,
      }),
    );
    const refresh = () =>
      t.mutation(internal.resolvedMetadata.publication.refreshItemProjections, {
        tmdbId: movie.tmdbId,
        mediaType: movie.mediaType,
      });
    await refresh();
    expect(await viewer.query(api.calendarLibrary.revision, {})).toBe(2);
    await t.run((ctx) => ctx.db.patch(titleId, { title: 'Renamed movie', posterPath: '/new.jpg' }));
    await refresh();
    expect(await viewer.query(api.calendarLibrary.revision, {})).toBe(3);
    await t.run((ctx) => ctx.db.patch(titleId, { runtime: 120 }));
    await refresh();
    expect(await viewer.query(api.calendarLibrary.revision, {})).toBe(3);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  });
});
