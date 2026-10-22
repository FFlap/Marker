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
  it('validates runtime and genre metadata on additions', async () => {
    const { userId, asUser } = await setup();
    await expect(
      asUser.mutation(
        api.library.items.addItem,
        add('Bad runtime', 11, 'movie', { runtime: Infinity }),
      ),
    ).rejects.toThrow('Runtime');
    await expect(
      asUser.mutation(
        api.library.items.addItem,
        add('Too many genres', 12, 'movie', { genres: Array(16).fill('Drama') }),
      ),
    ).rejects.toThrow('limited to 15');
    await expect(
      asUser.mutation(
        api.library.items.addItem,
        add('Bad release date', 13, 'movie', { releaseDate: '2026-02-30' }),
      ),
    ).rejects.toThrow('YYYY-MM-DD');
    await expect(
      asUser.mutation(api.library.items.addItem, add('Bad TMDB id', -1, 'movie')),
    ).rejects.toThrow('non-negative integer');
    await expect(
      asUser.mutation(api.library.items.addItem, add('Fractional TMDB id', 1.5, 'movie')),
    ).rejects.toThrow('non-negative integer');
    await expect(
      asUser.mutation(api.library.items.addItem, add('Oversized TMDB id', 2 ** 31 + 1, 'movie')),
    ).rejects.toThrow('no greater than');
    await expect(
      asUser.mutation(api.library.items.addItem, {
        ...add('Valid release date', 14, 'movie'),
        releaseDate: '2026-02-28',
      }),
    ).resolves.toBeDefined();
    await expect(
      asUser.mutation(internal.library.items.addItemInternal, {
        userId,
        ...add('Bad internal date', 15, 'movie', { releaseDate: 'February 15, 2026' }),
      }),
    ).rejects.toThrow('YYYY-MM-DD');
    await expect(
      asUser.action(api.library.seasonWatched.addItemAndMarkWatched, {
        ...add('Bad action id', -1, 'tv'),
        status: 'watched',
      }),
    ).rejects.toThrow('non-negative integer');
  });
  it('rejects duplicate additions and negative ratings while preserving updated watch counts', async () => {
    const { asUser } = await setup();
    const movie = add('Avengers: Endgame', 299534, 'movie');
    const itemId = await asUser.mutation(api.library.items.addItem, movie);
    await expect(asUser.mutation(api.library.items.addItem, movie)).rejects.toThrow(
      'already exists',
    );
    await expect(
      asUser.mutation(api.library.items.updateItem, { itemId, rating: -1 }),
    ).rejects.toThrow('between 0 and 5');
    await asUser.mutation(api.library.items.updateItem, {
      itemId,
      status: 'watched',
      timesWatched: 2,
    });
    const items = await asUser.query(api.library.items.listItems, {});
    expect(items.find((i) => i._id === itemId)).toMatchObject({
      status: 'watched',
      timesWatched: 2,
    });
  });

  it('keeps independent per-tag ordering and removes stale tag ranks', async () => {
    const { asUser } = await setup();
    const first = await asUser.mutation(
      api.library.items.addItem,
      add('First', 201, 'movie', { tags: ['Favorites', 'Weekend'] }),
    );
    const second = await asUser.mutation(
      api.library.items.addItem,
      add('Second', 202, 'movie', { tags: ['favorites', 'Weekend'] }),
    );
    const third = await asUser.mutation(
      api.library.items.addItem,
      add('Third', 203, 'movie', { tags: ['Favorites', 'Weekend'] }),
    );
    expect(await asUser.query(api.library.items.listTagSuggestions, {})).toEqual([
      'Favorites',
      'Weekend',
    ]);
    const originalItems = (await asUser.query(api.library.items.listItems, {})).map((item) => ({
      id: item._id,
      title: item.title,
      status: item.status,
      tags: item.tags,
      rank: item.rank,
    }));

    await asUser.mutation(api.library.ordering.reorderTagItem, {
      tag: 'FAVORITES',
      itemId: third,
      afterId: first,
    });
    const favoriteRanks = await asUser.query(api.library.items.listTagRanks, { tag: 'favorites' });
    const favoriteOrder = [...favoriteRanks]
      .sort((left, right) => left.rank - right.rank)
      .map((rank) => rank.itemId);
    expect(favoriteOrder).toEqual([third, first, second]);
    await asUser.mutation(api.tags.setVisibility, { tag: 'Weekend', isPublic: false });
    await asUser.mutation(api.library.ordering.reorderTagItem, {
      tag: 'Weekend',
      itemId: second,
    });
    expect(
      (await asUser.query(api.library.items.listTagRanks, { tag: 'Weekend' })).map(
        (rank) => rank.itemId,
      ),
    ).toEqual([second, first, third]);
    expect(
      (await asUser.query(api.library.items.listTagRanks, { tag: 'Favorites' })).map(
        (rank) => rank.itemId,
      ),
    ).toEqual([third, first, second]);
    const { page: previews } = await asUser.query(api.tags.mine, {
      paginationOpts: { cursor: null, numItems: 100 },
    });
    expect(previews.find((preview) => preview.tag === 'Favorites')?.posters).toMatchObject([
      { itemId: String(third) },
      { itemId: String(first) },
      { itemId: String(second) },
    ]);
    expect(previews.find((preview) => preview.tag === 'Weekend')?.posters).toMatchObject([
      { itemId: String(second) },
      { itemId: String(first) },
      { itemId: String(third) },
    ]);
    expect(
      (await asUser.query(api.library.items.listItems, {})).map((item) => ({
        id: item._id,
        title: item.title,
        status: item.status,
        tags: item.tags,
        rank: item.rank,
      })),
    ).toEqual(originalItems);

    await asUser.mutation(api.library.items.updateItem, {
      itemId: third,
      tags: ['Weekend'],
    });
    expect(
      (await asUser.query(api.library.items.listTagRanks, { tag: 'Favorites' })).map(
        (rank) => rank.itemId,
      ),
    ).not.toContain(third);
  });

  it('searches tag suggestions beyond the initial list', async () => {
    const { t, userId, asUser } = await setup();
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let index = 0; index < 205; index += 1) {
        const tagKey = `alpha-${String(index).padStart(3, '0')}`;
        await ctx.db.insert('tagCollections', {
          userId,
          tagKey,
          label: tagKey,
          isPublic: false,
          memberCount: 0,
          previewPosters: [],
          createdAt: now,
          updatedAt: now,
        });
      }
      await ctx.db.insert('tagCollections', {
        userId,
        tagKey: 'zulu-target',
        label: 'Zulu Target',
        isPublic: false,
        memberCount: 0,
        previewPosters: [],
        createdAt: now,
        updatedAt: now,
      });
    });

    expect(await asUser.query(api.library.items.listTagSuggestions, {})).not.toContain(
      'Zulu Target',
    );
    expect(await asUser.query(api.library.items.listTagSuggestions, { prefix: 'zulu' })).toEqual([
      'Zulu Target',
    ]);
  });

  it('adds one tag to many owned titles without duplicating tags or memberships', async () => {
    const { t, asUser } = await setup();
    const existing = await asUser.mutation(
      api.library.items.addItem,
      add('Existing', 211, 'movie', { tags: ['Favorites'] }),
    );
    const first = await asUser.mutation(
      api.library.items.addItem,
      add('First addition', 212, 'movie', { tags: ['Weekend'] }),
    );
    const second = await asUser.mutation(
      api.library.items.addItem,
      add('Second addition', 213, 'tv'),
    );

    await expect(
      asUser.mutation(api.library.items.addTagToItems, {
        itemIds: [existing, first, second, second],
        tag: ' favorites ',
      }),
    ).resolves.toEqual({ updated: 2 });

    const items = await asUser.query(api.library.items.listItems, {});
    expect(items.find((item) => item._id === existing)?.tags).toEqual(['Favorites']);
    expect(items.find((item) => item._id === first)?.tags).toEqual(['Weekend', 'favorites']);
    expect(items.find((item) => item._id === second)?.tags).toEqual(['favorites']);
    expect(
      (await asUser.query(api.library.items.listTagRanks, { tag: 'FAVORITES' })).map(
        (rank) => rank.itemId,
      ),
    ).toEqual([existing, first, second]);
    await expect(
      t.run((ctx) =>
        ctx.db
          .query('tagCollections')
          .withIndex('by_user_tag', (query) =>
            query.eq('userId', items[0]!.userId).eq('tagKey', 'favorites'),
          )
          .unique(),
      ),
    ).resolves.toMatchObject({
      memberCount: 3,
      previewPosters: [{ itemId: existing }, { itemId: first }, { itemId: second }],
    });

    await asUser.mutation(api.library.items.removeItem, { itemId: first });
    await t.mutation(internal.library.items.continueRemoveItem, { itemId: first });
    await t.mutation(internal.library.items.continueRemoveItem, { itemId: first });
    const collection = await t.run((ctx) =>
      ctx.db
        .query('tagCollections')
        .withIndex('by_user_tag', (query) =>
          query.eq('userId', items[0]!.userId).eq('tagKey', 'favorites'),
        )
        .unique(),
    );
    expect(collection).toMatchObject({ memberCount: 2 });
    expect(collection?.previewPosters.map((poster) => poster.itemId)).not.toContain(first);
  });

  it('keeps tag visibility per person and only aggregates public collections', async () => {
    const { t, asUser } = await setup();
    await t.run((ctx) => ctx.db.insert('users', { clerkId: 'user_tag_owner' }));
    await t.run((ctx) => ctx.db.insert('users', { clerkId: 'user_tag_viewer' }));
    const secondUser = t.withIdentity({ subject: 'user_tag_owner' });
    const viewer = t.withIdentity({ subject: 'user_tag_viewer' });

    await asUser.mutation(api.profiles.save, {
      username: 'tag_owner',
      isPublic: false,
    });
    const firstPublic = await asUser.mutation(
      api.library.items.addItem,
      add('Public Favorite', 801, 'movie', { tags: ['Favorites'] }),
    );
    const secondPublic = await asUser.mutation(
      api.library.items.addItem,
      add('Second Public Favorite', 803, 'movie', { tags: ['Favorites'] }),
    );
    await secondUser.mutation(
      api.library.items.addItem,
      add('Private Favorite', 802, 'movie', { tags: ['Favorites'] }),
    );
    await asUser.mutation(api.library.ordering.reorderTagItem, {
      tag: 'Favorites',
      itemId: secondPublic,
      afterId: firstPublic,
    });
    await asUser.mutation(api.tags.setVisibility, {
      tag: 'Favorites',
      isPublic: true,
    });

    expect(await asUser.query(api.tags.visibility, { tag: 'favorites' })).toEqual({
      isPublic: true,
    });
    expect(await secondUser.query(api.tags.visibility, { tag: 'favorites' })).toEqual({
      isPublic: false,
    });
    await expect(
      secondUser.mutation(api.tags.setVisibility, {
        tag: 'Does not exist',
        isPublic: true,
      }),
    ).rejects.toThrow('Tag not found');

    const publicTags = await viewer.query(api.tags.searchPublic, { query: 'favor' });
    expect(publicTags).toMatchObject([
      {
        tag: 'Favorites',
        entryCount: 2,
        contributorCount: 1,
      },
    ]);
    const details = await viewer.query(api.tags.publicDetails, { tag: 'favorites' });
    expect(details?.titles.map((title) => title.title)).toEqual([
      'Public Favorite',
      'Second Public Favorite',
    ]);
    const ownerCollection = await viewer.query(api.tags.publicByUser, {
      username: 'tag_owner',
      tag: 'favorites',
    });
    expect(ownerCollection?.titles.map((title) => title.title)).toEqual([
      'Second Public Favorite',
      'Public Favorite',
    ]);
    expect(ownerCollection?.titles.every((title) => title.status === 'watchlist')).toBe(true);
    expect(ownerCollection?.isOwner).toBe(false);
    const privateProfile = await viewer.query(api.profiles.publicProfile, {
      username: 'tag_owner',
    });
    expect(privateProfile).toMatchObject({
      profile: { isPublic: false },
      publicTags: [{ tag: 'Favorites', count: 2 }],
    });
    expect(privateProfile && 'stats' in privateProfile).toBe(false);
    await expect(
      viewer.mutation(api.library.ordering.reorderTagItem, {
        tag: 'Favorites',
        itemId: firstPublic,
      }),
    ).rejects.toThrow('Item not found');

    await asUser.mutation(api.tags.setVisibility, {
      tag: 'Favorites',
      isPublic: false,
    });
    expect(await viewer.query(api.tags.searchPublic, { query: 'favor' })).toEqual([]);
  });

  it('moves titles across status sections and enforces watched history', async () => {
    const { asUser } = await setup();
    const watchedNeighbor = await asUser.mutation(
      api.library.items.addItem,
      add('Already watched', 1, 'movie', { status: 'watched', timesWatched: 2 }),
    );
    const movie = await asUser.mutation(
      api.library.items.addItem,
      add('Move me', 2, 'movie', { status: 'watchlist', timesWatched: 0 }),
    );
    const dropped = await asUser.mutation(
      api.library.items.addItem,
      add('Drop me', 3, 'movie', { status: 'watchlist' }),
    );

    await asUser.action(api.library.seasonWatched.moveItemToWatched, {
      itemId: movie,
      beforeId: watchedNeighbor,
    });
    await asUser.mutation(api.library.ordering.reorderItem, {
      itemId: dropped,
      status: 'dropped',
    });

    const items = await asUser.query(api.library.items.listItems, {});
    expect(items.find((item) => item._id === movie)).toMatchObject({
      status: 'watched',
      timesWatched: 1,
    });
    expect(items.find((item) => item._id === movie)!.rank).toBeGreaterThan(
      items.find((item) => item._id === watchedNeighbor)!.rank,
    );
    expect(items.find((item) => item._id === dropped)?.status).toBe('dropped');
  });

  it('upserts episodes idempotently and computes exact stats', async () => {
    vi.useFakeTimers();
    const { t, asUser } = await setup();
    await asUser.mutation(
      api.library.items.addItem,
      add('Avengers: Endgame', 299534, 'movie', {
        status: 'watched',
        runtime: 181,
        timesWatched: 2,
        rating: 4.5,
        tags: ['hero'],
      }),
    );
    const show = await asUser.mutation(
      api.library.items.addItem,
      add('Daredevil', 61889, 'tv', { status: 'watched', runtime: 50, rating: 4, tags: ['Hero'] }),
    );
    await asUser.mutation(api.library.episodes.setEpisodeState, {
      itemId: show,
      season: 1,
      episode: 1,
      watched: true,
      runtime: 52,
      rating: 4.75,
      tags: ['pilot'],
      name: 'Into the Ring',
    });
    await asUser.mutation(api.library.episodes.setEpisodeState, {
      itemId: show,
      season: 1,
      episode: 1,
      watched: true,
      rating: 4.25,
      tags: ['pilot', 'great'],
    });
    await asUser.mutation(api.library.episodes.setEpisodeState, {
      itemId: show,
      season: 1,
      episode: 2,
      watched: true,
    });
    const episodes = await asUser.query(api.library.episodes.listEpisodes, {
      itemId: show,
      season: 1,
    });
    expect(episodes).toHaveLength(2);
    expect(episodes[0]).toMatchObject({ rating: 4.25, tags: ['pilot', 'great'] });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const stats = await asUser.query(api.stats.profile, {});
    expect(stats).toMatchObject({
      totalWatchMinutes: 464,
      episodesWatched: 2,
      moviesWatched: 1,
      showsWatched: 1,
      totalItems: 2,
      avgRating: 4.25,
    });
    expect(stats.topTags).toEqual([
      { tag: 'hero', count: 2 },
      { tag: 'great', count: 1 },
      { tag: 'pilot', count: 1 },
    ]);
  });
});
