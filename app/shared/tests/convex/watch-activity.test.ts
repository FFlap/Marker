import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import schema from '../../convex/schema';
import { api, internal } from '../../convex/_generated/api';
import { resolveActivityDate } from '../../convex/watchActivity';
import { putSeason } from './metadata-fixtures';

const modules = import.meta.glob('../../convex/**/*.ts');

afterEach(() => vi.useRealTimers());

async function setup() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-10T02:00:00Z'));
  const t = convexTest({ schema, modules, transactionLimits: true });
  const clerkId = 'user_watch_activity';
  const userId = await t.run((ctx) => ctx.db.insert('users', { clerkId }));
  const asUser = t.withIdentity({ subject: clerkId });
  const itemId = await asUser.mutation(api.library.items.addItem, {
    title: 'Frieren',
    tmdbId: 209867,
    mediaType: 'tv',
    status: 'watching',
    timesWatched: 0,
  });
  return { t, userId, asUser, itemId };
}

describe('watch activity', () => {
  it('logs in-app marks on the viewer local day and reverses them on unmark', async () => {
    const { t, asUser, itemId } = await setup();
    const mark = (episode: number, watched: boolean, activityDate?: string) =>
      asUser.mutation(api.library.episodes.setEpisodeState, {
        itemId,
        season: 1,
        episode,
        watched,
        ...(activityDate && { activityDate }),
      });
    await mark(1, true, '2026-10-09');
    await mark(2, true, '2026-10-09');
    await mark(2, true, '2026-10-09');
    await mark(3, true);
    expect((await asUser.query(api.stats.profile, {})).watchActivity).toEqual([
      { date: '2026-10-09', episodes: 2 },
      { date: '2026-10-10', episodes: 1 },
    ]);

    await asUser.mutation(api.library.episodes.setEpisodeState, {
      itemId,
      season: 1,
      episode: 1,
      rating: 4,
      activityDate: '2026-10-09',
    });
    await mark(3, false, '2026-10-09');
    expect((await asUser.query(api.stats.profile, {})).watchActivity).toEqual([
      { date: '2026-10-09', episodes: 2 },
    ]);
    const episodes = await t.run((ctx) => ctx.db.query('episodes').collect());
    const unmarked = episodes.find((episode) => episode.episode === 3);
    expect(unmarked?.watched).toBe(false);
    expect(unmarked).not.toHaveProperty('activityDate');
  });

  it('only trusts local dates within a day of the server clock', () => {
    const now = Date.parse('2026-10-10T02:00:00Z');
    expect(resolveActivityDate('2026-10-11', now)).toBe('2026-10-11');
    expect(resolveActivityDate('2026-10-12', now)).toBe('2026-10-10');
    expect(resolveActivityDate('2026-02-30', now)).toBe('2026-10-10');
    expect(resolveActivityDate(undefined, now)).toBe('2026-10-10');
    expect(resolveActivityDate('not-a-date', now)).toBe('2026-10-10');
    expect(resolveActivityDate('2026-10-08', now)).toBe('2026-10-10');
  });

  it('marks only aired episodes when a season with a listed future episode is marked watched', async () => {
    const { t, asUser, itemId } = await setup();
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await putSeason(t, {
      tmdbId: 209867,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: [
        { season: 1, episode: 1, name: 'Aired', airDate: '2026-01-01' },
        { season: 1, episode: 2, name: 'Next week', airDate: future },
      ],
      orderEpoch: 0,
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
    });

    await asUser.action(api.library.seasonWatched.setSeasonWatched, { itemId, season: 1 });

    const episodes = await t.run((ctx) => ctx.db.query('episodes').collect());
    expect(episodes.find((episode) => episode.episode === 1)?.watched).toBe(true);
    // Next week's episode stays unwatched, so Up next offers it when it airs.
    expect(episodes.find((episode) => episode.episode === 2)?.watched ?? false).toBe(false);
  });

  it('judges "aired" by the viewer\'s local date, not UTC, when marking a season', async () => {
    const { t, asUser, itemId } = await setup();
    // 03:00 UTC on Jan 2 is still Jan 1 in the viewer's (e.g. Edmonton's) evening.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-02T03:00:00Z'));
    await putSeason(t, {
      tmdbId: 209867,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: [
        { season: 1, episode: 1, name: 'Tonight', airDate: '2026-01-01' },
        { season: 1, episode: 2, name: 'Tomorrow', airDate: '2026-01-02' },
      ],
      orderEpoch: 0,
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
    });

    await asUser.action(api.library.seasonWatched.setSeasonWatched, {
      itemId,
      season: 1,
      activityDate: '2026-01-01',
    });

    const episodes = await t.run((ctx) => ctx.db.query('episodes').collect());
    expect(episodes.find((episode) => episode.episode === 1)?.watched).toBe(true);
    expect(episodes.find((episode) => episode.episode === 2)?.watched ?? false).toBe(false);
  });

  it('counts the episodes a season still has to air, across all of its chunks', async () => {
    const { t, asUser, itemId } = await setup();
    // 130 episodes span two chunks; the last three are dated after the viewer's day.
    await putSeason(t, {
      tmdbId: 209867,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: Array.from({ length: 130 }, (_, index) => ({
        season: 1,
        episode: index + 1,
        name: `Episode ${index + 1}`,
        airDate: index < 127 ? '2026-01-01' : '2026-03-01',
      })),
      orderEpoch: 0,
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
    });
    await asUser.mutation(api.library.episodes.setEpisodeState, {
      itemId,
      season: 1,
      episode: 130,
      watched: true,
    });

    expect(
      await asUser.query(api.library.episodes.getSeasonUpcoming, {
        itemId,
        season: 1,
        today: '2026-02-01',
      }),
    ).toEqual({ upcoming: 3, watchedUpcoming: 1 });
    expect(
      await asUser.query(api.library.episodes.getSeasonUpcoming, {
        itemId,
        season: 1,
        today: '2026-03-01',
      }),
    ).toEqual({ upcoming: 0, watchedUpcoming: 0 });
  });

  it('finds a not-yet-aired episode in an earlier chunk than an aired or undated one', async () => {
    const { t, asUser, itemId } = await setup();
    // Episode 120 (end of the first chunk) is dated after the viewer's day; 121 is undated.
    await putSeason(t, {
      tmdbId: 209867,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: Array.from({ length: 121 }, (_, index) => ({
        season: 1,
        episode: index + 1,
        name: `Episode ${index + 1}`,
        ...(index < 119 && { airDate: '2026-01-01' }),
        ...(index === 119 && { airDate: '2026-03-01' }),
      })),
      orderEpoch: 0,
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
    });
    expect(
      await asUser.query(api.library.episodes.getSeasonUpcoming, {
        itemId,
        season: 1,
        today: '2026-02-01',
      }),
    ).toEqual({ upcoming: 1, watchedUpcoming: 0 });
  });

  it('logs newly watched bulk episodes and reverses their original days on bulk unmark', async () => {
    const { t, asUser, itemId } = await setup();
    await putSeason(t, {
      tmdbId: 209867,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: Array.from({ length: 4 }, (_, index) => ({
        season: 1,
        episode: index + 1,
        name: `Episode ${index + 1}`,
      })),
      orderEpoch: 0,
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
    });
    for (const [season, episode, activityDate] of [
      [1, 1, '2026-10-09'],
      [1, 2, '2026-10-09'],
      [1, 3, '2026-10-10'],
      [2, 1, '2026-10-09'],
    ] as const)
      await asUser.mutation(api.library.episodes.setEpisodeState, {
        itemId,
        season,
        episode,
        watched: true,
        activityDate,
      });

    await asUser.action(api.library.seasonWatched.setSeasonWatched, { itemId, season: 1 });
    expect((await asUser.query(api.stats.profile, {})).watchActivity).toEqual([
      { date: '2026-10-09', episodes: 3 },
      { date: '2026-10-10', episodes: 2 },
    ]);
    for (let attempt = 0; attempt < 2; attempt += 1)
      await asUser.action(api.library.seasonWatched.setSeasonWatched, {
        itemId,
        season: 1,
        watched: false,
      });
    expect((await asUser.query(api.stats.profile, {})).watchActivity).toEqual([
      { date: '2026-10-09', episodes: 1 },
    ]);
    const episodes = await asUser.query(api.library.episodes.listEpisodes, { itemId, season: 1 });
    expect(episodes).toHaveLength(4);
    expect(episodes.every((episode) => !episode.watched && !episode.activityDate)).toBe(true);
  });

  it('does not attribute synced history to today and logs a later manual rewatch once', async () => {
    const { t, userId, asUser, itemId } = await setup();
    await t.mutation(internal.sync.recordWatchInternal, {
      userId,
      itemId,
      season: 1,
      episode: 1,
    });
    const args = { itemId, season: 1, episode: 1 };
    await asUser.mutation(api.library.episodes.setEpisodeState, { ...args, rating: 4 });
    await asUser.mutation(api.library.episodes.setEpisodeState, { ...args, watched: true });
    expect((await asUser.query(api.stats.profile, {})).watchActivity).toEqual([]);

    await asUser.mutation(api.library.episodes.setEpisodeState, { ...args, watched: false });
    await asUser.mutation(api.library.episodes.setEpisodeState, {
      ...args,
      watched: true,
      activityDate: '2026-10-09',
    });
    vi.setSystemTime(new Date('2026-10-11T12:00:00Z'));
    await asUser.mutation(api.library.episodes.setEpisodeState, { ...args, watched: false });
    await asUser.mutation(api.library.episodes.setEpisodeState, { ...args, watched: true });
    await asUser.mutation(api.library.episodes.setEpisodeState, { ...args, watched: true });
    expect((await asUser.query(api.stats.profile, {})).watchActivity).toEqual([
      { date: '2026-10-11', episodes: 1 },
    ]);
  });

  it('applies profile privacy and episode ownership to watch activity', async () => {
    const { t, asUser, itemId } = await setup();
    await asUser.mutation(api.profiles.save, { username: 'watcher', isPublic: true });
    const mark = { itemId, season: 1, episode: 1, watched: true };
    await asUser.mutation(api.library.episodes.setEpisodeState, mark);
    const watchActivity = [{ date: '2026-10-10', episodes: 1 }];
    const profile = { username: 'watcher' };
    expect((await t.query(api.profiles.publicProfile, profile))?.stats?.watchActivity).toEqual(
      watchActivity,
    );
    await asUser.mutation(api.profiles.save, { username: 'watcher', isPublic: false });
    expect((await t.query(api.profiles.publicProfile, profile))?.stats).toBeUndefined();
    expect((await asUser.query(api.profiles.publicProfile, profile))?.stats?.watchActivity).toEqual(
      watchActivity,
    );

    await t.run((ctx) => ctx.db.insert('users', { clerkId: 'viewer' }));
    const viewer = t.withIdentity({ subject: 'viewer' });
    await viewer.mutation(api.profiles.save, { username: 'viewer', isPublic: true });
    await expect(viewer.mutation(api.library.episodes.setEpisodeState, mark)).rejects.toThrow(
      'Item not found',
    );
    expect((await viewer.query(api.stats.profile, {})).watchActivity).toEqual([]);
    await viewer.mutation(api.profiles.follow, profile);
    expect((await viewer.query(api.profiles.publicProfile, profile))?.stats).toBeUndefined();
    await asUser.mutation(api.profiles.respondToFollow, { username: 'viewer', accept: true });
    expect((await viewer.query(api.profiles.publicProfile, profile))?.stats?.watchActivity).toEqual(
      watchActivity,
    );
    await viewer.mutation(api.profiles.unfollow, profile);
    expect((await viewer.query(api.profiles.publicProfile, profile))?.stats).toBeUndefined();
  });

  it('removes deleted episodes from activity while keeping other titles and users intact', async () => {
    const { t, asUser, itemId } = await setup();
    const otherItem = await asUser.mutation(api.library.items.addItem, {
      title: 'Another show',
      tmdbId: 42,
      mediaType: 'tv',
      status: 'watching',
    });
    for (const [id, episode, activityDate] of [
      [itemId, 1, '2026-10-09'],
      [itemId, 2, '2026-10-09'],
      [itemId, 3, '2026-10-10'],
      [otherItem, 1, '2026-10-09'],
    ] as const) {
      await asUser.mutation(api.library.episodes.setEpisodeState, {
        itemId: id,
        season: 1,
        episode,
        watched: true,
        activityDate,
      });
    }
    const otherDay = await t.run(async (ctx) => {
      const otherUser = await ctx.db.insert('users', { clerkId: 'other' });
      return ctx.db.insert('watchActivityDays', {
        userId: otherUser,
        date: '2026-10-09',
        episodes: 4,
      });
    });
    await asUser.mutation(api.library.items.removeItem, { itemId });
    await t.mutation(internal.library.items.continueRemoveItem, { itemId });
    await t.mutation(internal.library.items.continueRemoveItem, { itemId });
    expect((await asUser.query(api.stats.profile, {})).watchActivity).toEqual([
      { date: '2026-10-09', episodes: 1 },
    ]);
    expect((await t.run((ctx) => ctx.db.get(otherDay)))?.episodes).toBe(4);
  });

  it('keeps daily counters correct across deletion batches and retries', async () => {
    const { t, userId, asUser, itemId } = await setup();
    await t.run(async (ctx) => {
      for (let episode = 1; episode <= 501; episode += 1)
        await ctx.db.insert('episodes', {
          userId,
          itemId,
          season: 1,
          episode,
          watched: true,
          activityDate: '2026-10-09',
          tags: [],
          metadataProvider: 'tmdb',
        });
      await ctx.db.insert('watchActivityDays', { userId, date: '2026-10-09', episodes: 501 });
    });
    await asUser.mutation(api.library.items.removeItem, { itemId });
    await expect(
      t.mutation(internal.library.items.continueRemoveItem, { itemId }),
    ).resolves.toEqual({ deleted: 500, done: false });
    expect((await asUser.query(api.stats.profile, {})).watchActivity).toEqual([
      { date: '2026-10-09', episodes: 1 },
    ]);
    for (let attempt = 0; attempt < 3; attempt += 1)
      await t.mutation(internal.library.items.continueRemoveItem, { itemId });
    expect((await asUser.query(api.stats.profile, {})).watchActivity).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get(itemId))).toBeNull();
  });
});
