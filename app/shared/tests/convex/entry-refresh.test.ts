import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import schema from '../../convex/schema';
import { api } from '../../convex/_generated/api';
import { truncateProse } from '../../convex/seasonStorage';

const modules = import.meta.glob('../../convex/**/*.ts');

async function setup() {
  const t = convexTest(schema, modules);
  const clerkId = 'entry_refresh_user';
  const userId = await t.run((ctx) => ctx.db.insert('users', { clerkId }));
  return { t, userId, asUser: t.withIdentity({ subject: clerkId }) };
}

afterEach(() => vi.useRealTimers());

describe('entry refresh', () => {
  it('keeps "also in Watching" only on a watched show', async () => {
    const { t, asUser } = await setup();
    const itemId = await asUser.mutation(api.library.items.addItem, {
      tmdbId: 11,
      mediaType: 'tv',
      title: 'Airing Show',
      status: 'watched',
      timesWatched: 1,
    });
    const stored = async () => (await t.run((ctx) => ctx.db.get(itemId)))?.alsoWatching;

    await asUser.mutation(api.library.items.updateItem, { itemId, alsoWatching: true });
    expect(await stored()).toBe(true);
    await asUser.mutation(api.library.items.updateItem, { itemId, alsoWatching: false });
    expect(await stored()).toBeUndefined();

    await asUser.mutation(api.library.items.updateItem, { itemId, alsoWatching: true });
    await asUser.mutation(api.library.items.updateItem, { itemId, status: 'dropped' });
    expect(await stored()).toBeUndefined();
    await asUser.mutation(api.library.items.updateItem, { itemId, alsoWatching: true });
    expect(await stored()).toBeUndefined();
  });

  it('clears "also in Watching" when the show is dragged out of Watched', async () => {
    const { t, asUser } = await setup();
    const itemId = await asUser.mutation(api.library.items.addItem, {
      tmdbId: 12,
      mediaType: 'tv',
      title: 'Weekly Show',
      status: 'watched',
      timesWatched: 1,
    });
    await asUser.mutation(api.library.items.updateItem, { itemId, alsoWatching: true });
    await asUser.mutation(api.library.ordering.reorderItem, { itemId, status: 'watchlist' });
    const moved = await t.run((ctx) => ctx.db.get(itemId));
    expect(moved?.status).toBe('watchlist');
    expect(moved?.alsoWatching).toBeUndefined();
  });

  it('puts a watched show in Up next when a new episode is out', async () => {
    const { t, asUser } = await setup();
    const today = new Date().toISOString().slice(0, 10);
    const itemId = await asUser.mutation(api.library.items.addItem, {
      tmdbId: 13,
      mediaType: 'tv',
      title: 'Caught Up Show',
      status: 'watched',
      timesWatched: 1,
    });
    const upNext = async () =>
      (await asUser.query(api.episodeHub.overview, { today })).watching.map((card) => card.title);

    // Caught up: nothing new yet.
    expect(await upNext()).toEqual([]);
    // A new episode airs.
    await t.run((ctx) =>
      ctx.db.patch(itemId, {
        nextEpisode: { season: 1, episode: 9, chunkIndex: 0, name: 'New', airDate: today },
      }),
    );
    expect(await upNext()).toEqual(['Caught Up Show']);

    // With the automatic setting off, only shows set by hand join (the airing show carries
    // over when switching).
    await asUser.mutation(api.settings.setSettings, { airingInWatching: false, today });
    expect(await upNext()).toEqual(['Caught Up Show']);
    await asUser.mutation(api.library.items.updateItem, { itemId, alsoWatching: false });
    expect(await upNext()).toEqual([]);
    const scheduled = () =>
      t.run(async (ctx) => (await ctx.db.system.query('_scheduled_functions').collect()).length);
    const before = await scheduled();
    await asUser.mutation(api.library.items.updateItem, { itemId, alsoWatching: true });
    // Turning it on looks up the next episode again (here: fetches the missing metadata).
    expect(await scheduled()).toBeGreaterThan(before);
    await t.run((ctx) =>
      ctx.db.patch(itemId, {
        nextEpisode: { season: 1, episode: 9, chunkIndex: 0, name: 'New', airDate: today },
      }),
    );
    expect(await upNext()).toEqual(['Caught Up Show']);
  });

  it('keeps airing shows in Watching when switching to manual', async () => {
    const { t, asUser } = await setup();
    const today = '2026-11-20';
    const add = (tmdbId: number, title: string) =>
      asUser.mutation(api.library.items.addItem, {
        tmdbId,
        mediaType: 'tv',
        title,
        status: 'watched',
        timesWatched: 1,
      });
    const airing = await add(31, 'Airing');
    const caughtUp = await add(32, 'Caught Up');
    const later = await add(33, 'Next Week');
    await t.run(async (ctx) => {
      await ctx.db.patch(airing, {
        nextEpisode: { season: 1, episode: 5, chunkIndex: 0, airDate: '2026-11-19' },
      });
      await ctx.db.patch(later, {
        nextEpisode: { season: 1, episode: 6, chunkIndex: 0, airDate: '2026-11-27' },
      });
      // A choice made in an earlier manual period.
      await ctx.db.patch(caughtUp, { alsoWatching: true });
    });

    await asUser.mutation(api.settings.setSettings, { airingInWatching: false, today });

    const flags = await t.run(async (ctx) =>
      Promise.all(
        [airing, caughtUp, later].map(async (id) => (await ctx.db.get(id))?.alsoWatching ?? false),
      ),
    );
    expect(flags).toEqual([true, false, false]);
    const upNext = await asUser.query(api.episodeHub.overview, { today });
    expect(upNext.watching.map((card) => card.title)).toEqual(['Airing']);

    // Back to automatic: watched shows are checked for episodes missed while it was off.
    await asUser.mutation(api.settings.setSettings, { airingInWatching: true, today });
    const jobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect());
    expect(jobs.some((job) => job.name.includes('continueWatchingRefresh'))).toBe(true);
  });

  it('takes a just-ticked episode back out of the activity feed when it is unticked', async () => {
    const { t, userId, asUser } = await setup();
    const itemId = await asUser.mutation(api.library.items.addItem, {
      tmdbId: 41,
      mediaType: 'tv',
      title: 'Weekly',
      status: 'watching',
    });
    const episodeEvents = () =>
      t.run(
        async (ctx) =>
          (
            await ctx.db
              .query('activityEvents')
              .withIndex('by_actor_time', (q) => q.eq('userId', userId))
              .collect()
          ).filter((event) => event.kind === 'episode').length,
      );
    const tick = (watched: boolean) =>
      asUser.mutation(api.library.episodes.setEpisodeState, {
        itemId,
        season: 1,
        episode: 3,
        name: 'Episode 3',
        watched,
      });

    await tick(true);
    expect(await episodeEvents()).toBe(1);
    await tick(false);
    expect(await episodeEvents()).toBe(0);

    // A watch from long ago is history and stays.
    vi.useFakeTimers();
    await tick(true);
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    await tick(false);
    expect(await episodeEvents()).toBe(1);
  });

  it('removes a tag from several titles and leaves other tags alone', async () => {
    const { t, asUser } = await setup();
    const first = await asUser.mutation(api.library.items.addItem, {
      tmdbId: 21,
      mediaType: 'movie',
      title: 'First',
      status: 'watchlist',
      tags: ['Cozy', 'Rainy day'],
    });
    const second = await asUser.mutation(api.library.items.addItem, {
      tmdbId: 22,
      mediaType: 'movie',
      title: 'Second',
      status: 'watchlist',
      tags: ['cozy'],
    });
    const third = await asUser.mutation(api.library.items.addItem, {
      tmdbId: 23,
      mediaType: 'movie',
      title: 'Third',
      status: 'watchlist',
      tags: ['Rainy day'],
    });

    const result = await asUser.mutation(api.library.items.removeTagFromItems, {
      tag: 'Cozy',
      itemIds: [first, second, third],
    });

    expect(result).toEqual({ updated: 2 });
    const tags = await t.run(async (ctx) =>
      Promise.all([first, second, third].map(async (id) => (await ctx.db.get(id))?.tags)),
    );
    expect(tags).toEqual([['Rainy day'], [], ['Rainy day']]);
    const memberships = await t.run((ctx) =>
      ctx.db
        .query('tagMemberships')
        .filter((query) => query.eq(query.field('tagKey'), 'cozy'))
        .collect(),
    );
    expect(memberships).toHaveLength(0);
  });

  it('records how many times an episode was watched and keeps it when unwatched', async () => {
    const { t, asUser } = await setup();
    const itemId = await asUser.mutation(api.library.items.addItem, {
      tmdbId: 31,
      mediaType: 'tv',
      title: 'Show',
      status: 'watching',
    });
    const episode = { itemId, season: 1, episode: 1, name: 'Pilot' };
    await asUser.mutation(api.library.episodes.setEpisodeState, { ...episode, watched: true });
    await asUser.mutation(api.library.episodes.setEpisodeState, { ...episode, timesWatched: 3 });
    const saved = () =>
      t.run((ctx) =>
        ctx.db
          .query('episodes')
          .withIndex('by_item', (query) =>
            query.eq('itemId', itemId).eq('season', 1).eq('episode', 1),
          )
          .unique(),
      );
    expect(await saved()).toMatchObject({ watched: true, timesWatched: 3 });

    await expect(
      asUser.mutation(api.library.episodes.setEpisodeState, { ...episode, timesWatched: 0 }),
    ).rejects.toThrow(/timesWatched/);

    await asUser.mutation(api.library.episodes.setEpisodeState, { ...episode, watched: false });
    const unwatched = await saved();
    expect(unwatched?.watched).toBe(false);
    // Unticking by mistake must not lose the count; it returns when re-watched.
    expect(unwatched?.timesWatched).toBe(3);
    await asUser.mutation(api.library.episodes.setEpisodeState, { ...episode, watched: true });
    expect(await saved()).toMatchObject({ watched: true, timesWatched: 3 });
  });

  it('cuts long synopses at a whole word', () => {
    const text = `${'word '.repeat(100)}end`;
    const cut = truncateProse(text, 400);
    expect(cut.length).toBeLessThanOrEqual(400);
    expect(cut.endsWith('word…')).toBe(true);
    expect(truncateProse('Short.', 400)).toBe('Short.');
  });

  it('saves the ask-before-marking-watched preference, on by default', async () => {
    const { asUser } = await setup();
    expect(await asUser.query(api.settings.getSettings, {})).toMatchObject({
      confirmWatchedMove: true,
      airingInWatching: true,
    });
    await asUser.mutation(api.settings.setSettings, { confirmWatchedMove: false });
    expect(await asUser.query(api.settings.getSettings, {})).toMatchObject({
      confirmWatchedMove: false,
    });
  });
});
