import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from '../../convex/_generated/api';
import schema from '../../convex/schema';

const modules = import.meta.glob('../../convex/**/*.ts');

describe('public API authorization', () => {
  it.each([
    ['library.listItems', 'query', api.library.listItems, {}],
    [
      'library.getOwnedItemByTmdb',
      'query',
      api.library.getOwnedItemByTmdb,
      { mediaType: 'movie', tmdbId: 1 },
    ],
    ['library.listTagSuggestions', 'query', api.library.listTagSuggestions, {}],
    [
      'library.addItem',
      'mutation',
      api.library.addItem,
      { tmdbId: 1, mediaType: 'movie', title: 'X', status: 'watchlist' },
    ],
    ['library.updateItem', 'mutation', api.library.updateItem, { itemId: 'items:missing' }],
    [
      'library.addTagToItems',
      'mutation',
      api.library.addTagToItems,
      { itemIds: ['items:missing'], tag: 'Favorites' },
    ],
    ['library.removeItem', 'mutation', api.library.removeItem, { itemId: 'items:missing' }],
    ['library.reorderItem', 'mutation', api.library.reorderItem, { itemId: 'items:missing' }],
    [
      'library.setEpisodeState',
      'mutation',
      api.library.setEpisodeState,
      { itemId: 'items:missing', season: 0, episode: 1 },
    ],
    [
      'library.listEpisodes',
      'query',
      api.library.listEpisodes,
      { itemId: 'items:missing', season: 1 },
    ],
    [
      'library.listEpisodeProgress',
      'query',
      api.library.listEpisodeProgress,
      { itemId: 'items:missing' },
    ],
    [
      'library.setSeasonWatched',
      'action',
      api.library.setSeasonWatched,
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
      const itemId = await owner.mutation(api.library.addItem, {
        tmdbId: 1,
        mediaType: 'tv',
        title: 'Private',
        status: 'watchlist',
      });
      const calls = {
        updateItem: () => other.mutation(api.library.updateItem, { itemId, rating: 8 }),
        addTagToItems: () =>
          other.mutation(api.library.addTagToItems, { itemIds: [itemId], tag: 'Favorites' }),
        removeItem: () => other.mutation(api.library.removeItem, { itemId }),
        reorderItem: () => other.mutation(api.library.reorderItem, { itemId }),
        setEpisodeState: () =>
          other.mutation(api.library.setEpisodeState, { itemId, season: 1, episode: 1 }),
        listEpisodes: () => other.query(api.library.listEpisodes, { itemId, season: 1 }),
        listEpisodeProgress: () => other.query(api.library.listEpisodeProgress, { itemId }),
        setSeasonWatched: () => other.action(api.library.setSeasonWatched, { itemId, season: 1 }),
      };
      await expect(calls[operation]()).rejects.toThrow('Item not found');
    },
  );
});
