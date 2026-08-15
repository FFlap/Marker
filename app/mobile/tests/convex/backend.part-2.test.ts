import { convexTest } from 'convex-test';
import { describe, expect, it, vi, afterEach } from 'vitest';
import schema from '../../convex/schema';
import { api, internal } from '../../convex/_generated/api';

const modules = import.meta.glob('../../convex/**/*.ts');
async function setup() {
  const t = convexTest(schema, modules);
  const clerkId = 'user_backend_test';
  const userId = await t.run((ctx) => ctx.db.insert('users', { clerkId }));
  return { t, userId, asUser: t.withIdentity({ subject: clerkId }) };
}
const add = (
  title: string,
  tmdbId: number,
  mediaType: 'movie' | 'tv' = 'tv',
  extra: Record<string, unknown> = {},
) => ({ tmdbId, mediaType, title, status: 'watchlist' as const, ...extra });

describe('Marker backend', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('atomically adds a watched TV show and marks every episode watched', async () => {
    const { t, asUser } = await setup();
    const tmdbId = 1396;
    const now = Date.now();
    await t.run((ctx) =>
      ctx.db.insert('resolvedTitles', {
        tmdbId,
        mediaType: 'tv',
        title: 'Breaking Bad',
        episodeRunTime: [47],
        genres: ['Drama'],
        cast: [],
        seasons: [
          { season: 0, name: 'Specials', episodeCount: 1 },
          { season: 1, name: 'Season 1', episodeCount: 2 },
          { season: 2, name: 'Season 2', episodeCount: 2 },
        ],
        metadataProvider: 'tmdb',
        orderEpoch: 0,
        refreshedAt: now,
        refreshAfter: now + 60_000,
      }),
    );
    for (const season of [0, 1, 2]) {
      const count = season === 0 ? 1 : 2;
      await t.mutation(internal.resolvedMetadata.requests.putSeason, {
        tmdbId,
        season,
        metadataProvider: 'tmdb',
        episodes: Array.from({ length: count }, (_, index) => ({
          season,
          episode: index + 1,
          name: `S${season}E${index + 1}`,
        })),
        refreshedAt: now,
        refreshAfter: now + 60_000,
        orderEpoch: 0,
      });
    }

    const itemId = await asUser.action(api.library.seasonWatched.addItemAndMarkWatched, {
      tmdbId,
      mediaType: 'tv',
      title: 'Breaking Bad',
      status: 'watched',
      timesWatched: 1,
      tags: [],
    });

    expect(
      (await asUser.query(api.library.items.listItems, {})).find((item) => item._id === itemId),
    ).toMatchObject({ status: 'watched', timesWatched: 1 });
    const watched = (
      await Promise.all(
        [0, 1, 2].map((season) =>
          asUser.query(api.library.episodes.listEpisodes, { itemId, season }),
        ),
      )
    ).flat();
    expect(watched).toHaveLength(5);
    expect(watched.every((episode) => episode.watched)).toBe(true);
  });

  it('stores unique profiles and hides private activity from public queries', async () => {
    vi.useFakeTimers();
    const { t, asUser } = await setup();
    await asUser.mutation(api.profiles.save, { username: 'Flappy_7', isPublic: false });
    expect(await asUser.query(api.profiles.me, {})).toMatchObject({
      username: 'Flappy_7',
      isPublic: false,
    });
    const privateProfile = await t.query(api.profiles.publicProfile, { username: 'flappy_7' });
    expect(privateProfile).toMatchObject({
      profile: { username: 'Flappy_7', isPublic: false },
    });
    expect(privateProfile).not.toHaveProperty('stats');

    await t.run((ctx) => ctx.db.insert('users', { clerkId: 'user_profile_second' }));
    const secondUser = t.withIdentity({ subject: 'user_profile_second' });
    await expect(
      secondUser.mutation(api.profiles.save, { username: 'FLAPPY_7', isPublic: true }),
    ).rejects.toThrow('already taken');

    await asUser.mutation(
      api.library.items.addItem,
      add('Public Movie', 88, 'movie', {
        status: 'watched',
        runtime: 100,
        timesWatched: 1,
      }),
    );
    await asUser.mutation(api.profiles.save, { username: 'Flappy_7', isPublic: true });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const publicProfile = await t.query(api.profiles.publicProfile, { username: 'FLAPPY_7' });
    expect(publicProfile).toMatchObject({
      profile: { username: 'Flappy_7', isPublic: true },
      stats: { moviesWatched: 1, totalWatchMinutes: 100 },
    });
  });

  it('requires approval for private follows and keeps relationship counts exact', async () => {
    vi.useFakeTimers();
    const { t, userId: ownerId, asUser: owner } = await setup();
    await owner.mutation(api.profiles.save, { username: 'private_owner', isPublic: false });
    await owner.mutation(
      api.library.items.addItem,
      add('Private Movie', 901, 'movie', {
        status: 'watched',
        runtime: 90,
        timesWatched: 1,
      }),
    );
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await t.run((ctx) => ctx.db.insert('users', { clerkId: 'user_private_follower' }));
    const follower = t.withIdentity({ subject: 'user_private_follower' });
    await follower.mutation(api.profiles.save, { username: 'curious_viewer', isPublic: true });

    expect(await follower.mutation(api.profiles.follow, { username: 'private_owner' })).toBe(
      'pending',
    );
    expect(
      await follower.query(api.profiles.publicProfile, { username: 'private_owner' }),
    ).not.toHaveProperty('stats');
    expect(await owner.query(api.profiles.followRequests, {})).toEqual([
      expect.objectContaining({ username: 'curious_viewer' }),
    ]);
    expect(await owner.query(api.profiles.me, {})).toMatchObject({ followerCount: 0 });
    expect(await follower.query(api.profiles.me, {})).toMatchObject({ followingCount: 0 });

    await owner.mutation(api.profiles.respondToFollow, {
      username: 'curious_viewer',
      accept: true,
    });
    expect(await owner.query(api.profiles.me, {})).toMatchObject({ followerCount: 1 });
    expect(await follower.query(api.profiles.me, {})).toMatchObject({ followingCount: 1 });
    expect(
      await follower.query(api.profiles.publicProfile, { username: 'private_owner' }),
    ).toMatchObject({ stats: { moviesWatched: 1, totalWatchMinutes: 90 } });

    await follower.mutation(api.profiles.unfollow, { username: 'private_owner' });
    expect(await owner.query(api.profiles.me, {})).toMatchObject({ followerCount: 0 });
    expect(await follower.query(api.profiles.me, {})).toMatchObject({ followingCount: 0 });
    expect(
      await follower.query(api.profiles.publicProfile, { username: 'private_owner' }),
    ).not.toHaveProperty('stats');

    expect(await follower.mutation(api.profiles.follow, { username: 'private_owner' })).toBe(
      'pending',
    );
    await owner.mutation(api.profiles.save, { username: 'private_owner', isPublic: true });
    expect(await owner.query(api.profiles.me, {})).toMatchObject({ followerCount: 1 });
    expect(await follower.query(api.profiles.me, {})).toMatchObject({ followingCount: 1 });
    expect(
      await follower.query(api.profiles.publicProfile, { username: 'private_owner' }),
    ).toMatchObject({ relationship: 'accepted' });

    const storedOwner = await t.run((ctx) => ctx.db.get(ownerId));
    expect(storedOwner?.followerCount).toBe(1);
  });
});
