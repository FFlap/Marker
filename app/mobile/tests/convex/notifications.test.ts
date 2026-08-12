import { convexTest } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';
import schema from '../../convex/schema';
import { api } from '../../convex/_generated/api';

const modules = import.meta.glob('../../convex/**/*.ts');

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const viewerId = await ctx.db.insert('users', {
      clerkId: 'user_notifications_viewer',
      username: 'viewer',
      normalizedUsername: 'viewer',
    });
    const pendingViewerId = await ctx.db.insert('users', {
      clerkId: 'user_notifications_pending',
      username: 'pending_viewer',
      normalizedUsername: 'pending_viewer',
    });
    const actorId = await ctx.db.insert('users', {
      clerkId: 'user_notifications_actor',
      username: 'mika',
      normalizedUsername: 'mika',
      isPublic: true,
    });
    const secondActorId = await ctx.db.insert('users', {
      clerkId: 'user_notifications_second_actor',
      username: 'noah',
      normalizedUsername: 'noah',
      isPublic: true,
    });
    for (const [followerId, followingId, status] of [
      [viewerId, actorId, 'accepted'],
      [viewerId, secondActorId, 'accepted'],
      [pendingViewerId, actorId, 'pending'],
    ] as const)
      await ctx.db.insert('follows', {
        followerId,
        followingId,
        status,
        createdAt: 1,
        updatedAt: 1,
      });
    return { actorId };
  });
  return {
    t,
    ...ids,
    viewer: t.withIdentity({ subject: 'user_notifications_viewer' }),
    pendingViewer: t.withIdentity({ subject: 'user_notifications_pending' }),
    actor: t.withIdentity({ subject: 'user_notifications_actor' }),
    secondActor: t.withIdentity({ subject: 'user_notifications_second_actor' }),
  };
}

const addShow = (title: string, tmdbId: number) => ({
  tmdbId,
  mediaType: 'tv' as const,
  title,
  status: 'watchlist' as const,
});

describe('notification activity feed', () => {
  it('writes only semantic transitions and applies per-kind settings', async () => {
    vi.useFakeTimers();
    const { t, actorId, actor, viewer } = await setup();
    const itemId = await actor.mutation(api.library.addItem, addShow('Signal', 42));

    vi.setSystemTime(10);
    await actor.mutation(api.library.updateItem, { itemId, rating: 9.2 });
    vi.setSystemTime(20);
    await actor.mutation(api.library.updateItem, { itemId, tags: ['quiet'] });
    vi.setSystemTime(30);
    await actor.mutation(api.library.updateItem, { itemId, status: 'watching' });
    vi.setSystemTime(40);
    await actor.mutation(api.library.setEpisodeState, {
      itemId,
      season: 1,
      episode: 3,
      watched: true,
    });
    vi.setSystemTime(50);
    await actor.mutation(api.library.updateItem, { itemId, status: 'watched' });
    await actor.mutation(api.library.updateItem, { itemId, status: 'watched', rating: 9.2 });

    const stored = await t.run((ctx) =>
      ctx.db
        .query('activityEvents')
        .withIndex('by_actor_time', (query) => query.eq('userId', actorId))
        .collect(),
    );
    expect(stored.map((event) => event.kind)).toEqual(['rating', 'status', 'episode', 'finished']);
    expect((await viewer.query(api.notifications.feed, {})).map((entry) => entry.kind)).toEqual([
      'finished',
      'episode',
      'status',
      'rating',
    ]);

    await viewer.mutation(api.settings.setSettings, {
      activityRatings: false,
      activityWatched: false,
      activityWatching: true,
    });
    expect((await viewer.query(api.notifications.feed, {})).map((entry) => entry.kind)).toEqual([
      'status',
    ]);
    vi.useRealTimers();
  });

  it('merges actor pages by time and excludes pending follows', async () => {
    vi.useFakeTimers();
    const { viewer, pendingViewer, actor, secondActor } = await setup();
    vi.setSystemTime(100);
    const first = await actor.mutation(api.library.addItem, addShow('Signal', 42));
    await actor.mutation(api.library.updateItem, { itemId: first, status: 'watching' });
    vi.setSystemTime(200);
    const second = await secondActor.mutation(api.library.addItem, addShow('Orbit', 43));
    await secondActor.mutation(api.library.updateItem, { itemId: second, rating: 8 });

    const feed = await viewer.query(api.notifications.feed, {});
    expect(feed.map((entry) => entry.actorUsername)).toEqual(['noah', 'mika']);
    expect(await pendingViewer.query(api.notifications.feed, {})).toEqual([]);
    vi.useRealTimers();
  });
});
