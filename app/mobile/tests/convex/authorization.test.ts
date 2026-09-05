import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from '../../convex/_generated/api';
import schema from '../../convex/schema';

const modules = import.meta.glob('../../convex/**/*.ts');

describe('public API authorization', () => {
  it.each([
    ['library/items:listItems', 'query', api.library.items.listItems, {}],
    [
      'library/items:getOwnedItemByTmdb',
      'query',
      api.library.items.getOwnedItemByTmdb,
      { mediaType: 'movie', tmdbId: 1 },
    ],
    ['library/items:listTagSuggestions', 'query', api.library.items.listTagSuggestions, {}],
    [
      'library/items:addItem',
      'mutation',
      api.library.items.addItem,
      { tmdbId: 1, mediaType: 'movie', title: 'X', status: 'watchlist' },
    ],
    [
      'library/items:updateItem',
      'mutation',
      api.library.items.updateItem,
      { itemId: 'items:missing' },
    ],
    [
      'library/items:addTagToItems',
      'mutation',
      api.library.items.addTagToItems,
      { itemIds: ['items:missing'], tag: 'Favorites' },
    ],
    [
      'library/items:removeItem',
      'mutation',
      api.library.items.removeItem,
      { itemId: 'items:missing' },
    ],
    [
      'library/ordering:reorderItem',
      'mutation',
      api.library.ordering.reorderItem,
      { itemId: 'items:missing' },
    ],
    [
      'library/episodes:setEpisodeState',
      'mutation',
      api.library.episodes.setEpisodeState,
      { itemId: 'items:missing', season: 0, episode: 1 },
    ],
    [
      'library/episodes:listEpisodes',
      'query',
      api.library.episodes.listEpisodes,
      { itemId: 'items:missing', season: 1 },
    ],
    [
      'library/episodes:listEpisodeProgress',
      'query',
      api.library.episodes.listEpisodeProgress,
      { itemId: 'items:missing' },
    ],
    [
      'library/seasonWatched:setSeasonWatched',
      'action',
      api.library.seasonWatched.setSeasonWatched,
      { itemId: 'items:missing', season: 1 },
    ],
    ['settings.getSettings', 'query', api.settings.getSettings, {}],
    ['settings.setSettings', 'mutation', api.settings.setSettings, { defaultView: 'list' }],
    ['stats.profile', 'query', api.stats.profile, {}],
    ['profiles.me', 'query', api.profiles.me, {}],
    ['profiles.search', 'query', api.profiles.search, { query: 'viewer' }],
    ['profiles.followRequests', 'query', api.profiles.followRequests, {}],
    ['notifications.feed', 'query', api.notifications.feed, {}],
    ['profiles.save', 'mutation', api.profiles.save, { username: 'viewer', isPublic: false }],
    ['profiles.follow', 'mutation', api.profiles.follow, { username: 'viewer' }],
    ['profiles.unfollow', 'mutation', api.profiles.unfollow, { username: 'viewer' }],
    [
      'profiles.respondToFollow',
      'mutation',
      api.profiles.respondToFollow,
      { username: 'viewer', accept: true },
    ],
    ['profiles.generateAvatarUploadUrl', 'mutation', api.profiles.generateAvatarUploadUrl, {}],
    ['profiles.removeAvatar', 'mutation', api.profiles.removeAvatar, {}],
    ['tmdb.searchMulti', 'action', api.tmdb.searchMulti, { query: 'x' }],
    [
      'calendar.upcoming',
      'action',
      api.calendar.upcoming,
      { startDate: '2026-08-01', endDate: '2026-08-31' },
    ],
  ] as const)('%s rejects unauthenticated calls', async (_name, kind, fn, args) => {
    const t = convexTest(schema, modules);
    const { itemId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', { clerkId: 'user_unauthenticated_fixture' });
      const now = Date.now();
      const itemId = await ctx.db.insert('items', {
        userId,
        tmdbId: 1,
        mediaType: 'tv',
        title: 'Fixture',
        normalizedTitle: 'fixture',
        isAnime: false,
        status: 'watchlist',
        timesWatched: 0,
        tags: [],
        rank: 1,
        createdAt: now,
        updatedAt: now,
      });
      return { itemId };
    });
    const validArgs = {
      ...args,
      ...('itemId' in args ? { itemId } : {}),
      ...('itemIds' in args ? { itemIds: [itemId] } : {}),
    };
    await expect(
      (t[kind] as (f: typeof fn, a: typeof validArgs) => Promise<unknown>)(fn, validArgs),
    ).rejects.toThrow('Authentication required');
  });

  it.each([
    'updateItem',
    'addTagToItems',
    'removeItem',
    'reorderItem',
    'setEpisodeState',
    'listEpisodes',
    'listEpisodeProgress',
    'setSeasonWatched',
  ] as const)(
    'prevents a second user from using library.%s on another user’s item',
    async (operation) => {
      const t = convexTest(schema, modules);
      const ownerId = await t.run((ctx) =>
        ctx.db.insert('users', { clerkId: 'user_authorization_owner' }),
      );
      await t.run((ctx) => ctx.db.insert('users', { clerkId: 'user_authorization_other' }));
      const owner = t.withIdentity({ subject: 'user_authorization_owner' });
      const other = t.withIdentity({ subject: 'user_authorization_other' });
      const itemId = await owner.mutation(api.library.items.addItem, {
        tmdbId: 1,
        mediaType: 'tv',
        title: 'Private',
        status: 'watchlist',
      });
      const calls = {
        updateItem: () => other.mutation(api.library.items.updateItem, { itemId, rating: 8 }),
        addTagToItems: () =>
          other.mutation(api.library.items.addTagToItems, { itemIds: [itemId], tag: 'Favorites' }),
        removeItem: () => other.mutation(api.library.items.removeItem, { itemId }),
        reorderItem: () => other.mutation(api.library.ordering.reorderItem, { itemId }),
        setEpisodeState: () =>
          other.mutation(api.library.episodes.setEpisodeState, { itemId, season: 1, episode: 1 }),
        listEpisodes: () => other.query(api.library.episodes.listEpisodes, { itemId, season: 1 }),
        listEpisodeProgress: () =>
          other.query(api.library.episodes.listEpisodeProgress, { itemId }),
        setSeasonWatched: () =>
          other.action(api.library.seasonWatched.setSeasonWatched, { itemId, season: 1 }),
      };
      await expect(calls[operation]()).rejects.toThrow('Item not found');
    },
  );
});
