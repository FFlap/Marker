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
      asUser.mutation(api.library.addItem, add('Bad runtime', 11, 'movie', { runtime: Infinity })),
    ).rejects.toThrow('Runtime');
    await expect(
      asUser.mutation(
        api.library.addItem,
        add('Too many genres', 12, 'movie', { genres: Array(16).fill('Drama') }),
      ),
    ).rejects.toThrow('limited to 15');
    await expect(
      asUser.mutation(
        api.library.addItem,
        add('Bad release date', 13, 'movie', { releaseDate: '2026-02-30' }),
      ),
    ).rejects.toThrow('YYYY-MM-DD');
    await expect(
      asUser.mutation(api.library.addItem, add('Bad TMDB id', -1, 'movie')),
    ).rejects.toThrow('non-negative integer');
    await expect(
      asUser.mutation(api.library.addItem, add('Fractional TMDB id', 1.5, 'movie')),
    ).rejects.toThrow('non-negative integer');
    await expect(
      asUser.mutation(api.library.addItem, add('Oversized TMDB id', 2 ** 31 + 1, 'movie')),
    ).rejects.toThrow('no greater than');
    await expect(
      asUser.mutation(api.library.addItem, {
        ...add('Valid release date', 14, 'movie'),
        releaseDate: '2026-02-28',
      }),
    ).resolves.toBeDefined();
    await expect(
      asUser.mutation(internal.library.addItemInternal, {
        userId,
        ...add('Bad internal date', 15, 'movie', { releaseDate: 'February 15, 2026' }),
      }),
    ).rejects.toThrow('YYYY-MM-DD');
    await expect(
      asUser.action(api.library.addItemAndMarkWatched, {
        ...add('Bad action id', -1, 'tv'),
        status: 'watched',
      }),
    ).rejects.toThrow('non-negative integer');
  });
  it('requires auth and validates additions, duplicates, ratings, statuses, tags, and reorder', async () => {
    const { t, asUser } = await setup();
    await expect(t.query(api.library.listItems, {})).rejects.toThrow('Authentication required');
    const titles = [
      ['Avengers: Endgame', 299534, 'movie'],
      ['The Middle', 1422, 'tv'],
      ['Daredevil', 61889, 'tv'],
      ['Oshi no Ko', 203737, 'tv'],
      ["Shikimori's Not Just a Cutie", 154391, 'tv'],
      ['Kaguya-sama: Love Is War', 83121, 'tv'],
    ] as const;
    const ids = [];
    for (const [title, id, type] of titles)
      ids.push(
        await asUser.mutation(api.library.addItem, add(title, id, type, { tags: ['favorite'] })),
      );
    await expect(
      asUser.mutation(api.library.addItem, add(titles[0][0], titles[0][1], titles[0][2])),
    ).rejects.toThrow('already exists');
    for (const rating of [-1, 10.5])
      await expect(
        asUser.mutation(api.library.updateItem, { itemId: ids[0], rating }),
      ).rejects.toThrow('between 0 and 10');
    await asUser.mutation(api.library.updateItem, {
      itemId: ids[0],
      status: 'watching',
      rating: 9.5,
      tags: ['marvel'],
    });
    await asUser.mutation(api.library.updateItem, {
      itemId: ids[0],
      status: 'watched',
      timesWatched: 2,
    });
    const midpoint = await asUser.mutation(api.library.reorderItem, {
      itemId: ids[3],
      beforeId: ids[1],
      afterId: ids[2],
    });
    expect(midpoint).toBe(2.5);
    await asUser.mutation(api.library.updateItem, {
      itemId: ids[1],
      status: 'dropped',
    });
    const items = await asUser.query(api.library.listItems, {});
    expect(items.find((i) => i._id === ids[0])).toMatchObject({
      status: 'watched',
      rating: 9.5,
      tags: ['marvel'],
      timesWatched: 2,
    });
    expect(items.find((i) => i._id === ids[1])?.status).toBe('dropped');
  });

  it('persists anime classification separately from the Animation genre', async () => {
    const { asUser } = await setup();
    const animeId = await asUser.mutation(
      api.library.addItem,
      add('One Piece', 37854, 'tv', { genres: ['Animation', 'Anime'] }),
    );
    const animationId = await asUser.mutation(
      api.library.addItem,
      add('Peppa Pig', 12225, 'tv', { genres: ['Animation', 'Kids'] }),
    );
    const items = await asUser.query(api.library.listItems, {});
    expect(items.find((item) => item._id === animeId)?.isAnime).toBe(true);
    expect(items.find((item) => item._id === animationId)?.isAnime).toBe(false);
  });

  it('keeps independent per-tag ordering and removes stale tag ranks', async () => {
    const { asUser } = await setup();
    const first = await asUser.mutation(
      api.library.addItem,
      add('First', 201, 'movie', { tags: ['Favorites', 'Weekend'] }),
    );
    const second = await asUser.mutation(
      api.library.addItem,
      add('Second', 202, 'movie', { tags: ['favorites', 'Weekend'] }),
    );
    const third = await asUser.mutation(
      api.library.addItem,
      add('Third', 203, 'movie', { tags: ['Favorites', 'Weekend'] }),
    );
    expect(await asUser.query(api.library.listTagSuggestions, {})).toEqual([
      'Favorites',
      'Weekend',
    ]);
    const originalItems = (await asUser.query(api.library.listItems, {})).map((item) => ({
      id: item._id,
      title: item.title,
      status: item.status,
      tags: item.tags,
      rank: item.rank,
    }));

    await asUser.mutation(api.library.reorderTagItem, {
      tag: 'FAVORITES',
      itemId: third,
      afterId: first,
    });
    const favoriteRanks = await asUser.query(api.library.listTagRanks, { tag: 'favorites' });
    const favoriteOrder = [...favoriteRanks]
      .sort((left, right) => left.rank - right.rank)
      .map((rank) => rank.itemId);
    expect(favoriteOrder).toEqual([third, first, second]);
    await asUser.mutation(api.tags.setVisibility, { tag: 'Weekend', isPublic: false });
    await asUser.mutation(api.library.reorderTagItem, {
      tag: 'Weekend',
      itemId: second,
    });
    expect(
      (await asUser.query(api.library.listTagRanks, { tag: 'Weekend' })).map((rank) => rank.itemId),
    ).toEqual([second, first, third]);
    expect(
      (await asUser.query(api.library.listTagRanks, { tag: 'Favorites' })).map(
        (rank) => rank.itemId,
      ),
    ).toEqual([third, first, second]);
    const { collections: previews } = await asUser.query(api.tags.mine, {});
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
      (await asUser.query(api.library.listItems, {})).map((item) => ({
        id: item._id,
        title: item.title,
        status: item.status,
        tags: item.tags,
        rank: item.rank,
      })),
    ).toEqual(originalItems);

    await asUser.mutation(api.library.updateItem, {
      itemId: third,
      tags: ['Weekend'],
    });
    expect(
      (await asUser.query(api.library.listTagRanks, { tag: 'Favorites' })).map(
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

    expect(await asUser.query(api.library.listTagSuggestions, {})).not.toContain('Zulu Target');
    expect(await asUser.query(api.library.listTagSuggestions, { prefix: 'zulu' })).toEqual([
      'Zulu Target',
    ]);
  });

  it('adds one tag to many owned titles without duplicating tags or memberships', async () => {
    const { asUser } = await setup();
    const existing = await asUser.mutation(
      api.library.addItem,
      add('Existing', 211, 'movie', { tags: ['Favorites'] }),
    );
    const first = await asUser.mutation(
      api.library.addItem,
      add('First addition', 212, 'movie', { tags: ['Weekend'] }),
    );
    const second = await asUser.mutation(api.library.addItem, add('Second addition', 213, 'tv'));

    await expect(
      asUser.mutation(api.library.addTagToItems, {
        itemIds: [existing, first, second, second],
        tag: ' favorites ',
      }),
    ).resolves.toEqual({ updated: 2 });

    const items = await asUser.query(api.library.listItems, {});
    expect(items.find((item) => item._id === existing)?.tags).toEqual(['Favorites']);
    expect(items.find((item) => item._id === first)?.tags).toEqual(['Weekend', 'favorites']);
    expect(items.find((item) => item._id === second)?.tags).toEqual(['favorites']);
    expect(
      (await asUser.query(api.library.listTagRanks, { tag: 'FAVORITES' })).map(
        (rank) => rank.itemId,
      ),
    ).toEqual([existing, first, second]);
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
      api.library.addItem,
      add('Public Favorite', 801, 'movie', { tags: ['Favorites'] }),
    );
    const secondPublic = await asUser.mutation(
      api.library.addItem,
      add('Second Public Favorite', 803, 'movie', { tags: ['Favorites'] }),
    );
    await secondUser.mutation(
      api.library.addItem,
      add('Private Favorite', 802, 'movie', { tags: ['Favorites'] }),
    );
    await asUser.mutation(api.library.reorderTagItem, {
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
      viewer.mutation(api.library.reorderTagItem, {
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
      api.library.addItem,
      add('Already watched', 1, 'movie', { status: 'watched', timesWatched: 2 }),
    );
    const movie = await asUser.mutation(
      api.library.addItem,
      add('Move me', 2, 'movie', { status: 'watchlist', timesWatched: 0 }),
    );
    const dropped = await asUser.mutation(
      api.library.addItem,
      add('Drop me', 3, 'movie', { status: 'watchlist' }),
    );

    await asUser.action(api.library.moveItemToWatched, {
      itemId: movie,
      beforeId: watchedNeighbor,
    });
    await asUser.mutation(api.library.reorderItem, {
      itemId: dropped,
      status: 'dropped',
    });

    const items = await asUser.query(api.library.listItems, {});
    expect(items.find((item) => item._id === movie)).toMatchObject({
      status: 'watched',
      timesWatched: 1,
    });
    expect(items.find((item) => item._id === movie)!.rank).toBeGreaterThan(
      items.find((item) => item._id === watchedNeighbor)!.rank,
    );
    expect(items.find((item) => item._id === dropped)?.status).toBe('dropped');
  });

  it('keeps canonical metadata and user episode state in separate queries', async () => {
    const { t, asUser } = await setup();
    const itemId = await asUser.mutation(
      api.library.addItem,
      add('Daredevil', 61889, 'tv', { status: 'watching' }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert('resolvedTitles', {
        tmdbId: 61889,
        mediaType: 'tv',
        title: 'Daredevil',
        overview: 'A blind lawyer protects Hell’s Kitchen.',
        firstAirDate: '2015-04-10',
        episodeRunTime: [52],
        genres: ['Drama'],
        cast: [{ name: 'Charlie Cox', character: 'Matt Murdock' }],
        seasons: [{ season: 1, name: 'Season 1', episodeCount: 13 }],
        metadataProvider: 'tmdb',
        refreshedAt: Date.now(),
        refreshAfter: Date.now() + 60_000,
        orderEpoch: 0,
      });
    });
    await asUser.mutation(api.library.setEpisodeState, {
      itemId,
      season: 1,
      episode: 1,
      watched: true,
    });

    const view = await asUser.query(api.resolvedMetadata.getItemView, { itemId });
    expect(view?.item._id).toBe(itemId);
    expect(view?.title).toMatchObject({
      title: 'Daredevil',
      metadataProvider: 'tmdb',
    });
    expect(view).not.toHaveProperty('savedEpisodes');
    const savedEpisodes = await asUser.query(api.library.listEpisodes, { itemId, season: 1 });
    expect(savedEpisodes[0]).toMatchObject({ season: 1, episode: 1, watched: true });
  });

  it('upserts episodes idempotently and computes exact stats', async () => {
    vi.useFakeTimers();
    const { t, asUser } = await setup();
    const movie = await asUser.mutation(
      api.library.addItem,
      add('Avengers: Endgame', 299534, 'movie', {
        status: 'watched',
        runtime: 181,
        timesWatched: 2,
        rating: 9,
        tags: ['hero'],
      }),
    );
    const show = await asUser.mutation(
      api.library.addItem,
      add('Daredevil', 61889, 'tv', { status: 'watched', runtime: 50, rating: 8, tags: ['Hero'] }),
    );
    await asUser.mutation(api.library.setEpisodeState, {
      itemId: show,
      season: 1,
      episode: 1,
      watched: true,
      runtime: 52,
      rating: 9.5,
      tags: ['pilot'],
      name: 'Into the Ring',
    });
    await asUser.mutation(api.library.setEpisodeState, {
      itemId: show,
      season: 1,
      episode: 1,
      watched: true,
      rating: 8.5,
      tags: ['pilot', 'great'],
    });
    await asUser.mutation(api.library.setEpisodeState, {
      itemId: show,
      season: 1,
      episode: 2,
      watched: true,
    });
    const episodes = await asUser.query(api.library.listEpisodes, { itemId: show, season: 1 });
    expect(episodes).toHaveLength(2);
    expect(episodes[0]).toMatchObject({ rating: 8.5, tags: ['pilot', 'great'] });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const stats = await asUser.query(api.stats.profile, {});
    expect(stats).toMatchObject({
      totalWatchMinutes: 464,
      episodesWatched: 2,
      moviesWatched: 1,
      showsWatched: 1,
      totalItems: 2,
      avgRating: 8.5,
    });
    expect(stats.topTags[0]).toEqual({ tag: 'hero', count: 2 });
    await asUser.mutation(api.library.removeItem, { itemId: show });
    for (let pass = 0; pass < 8; pass += 1)
      await t.mutation(internal.library.continueRemoveItem, { itemId: show });
    expect(
      await t.run((ctx) =>
        ctx.db
          .query('episodes')
          .withIndex('by_item', (query) => query.eq('itemId', show))
          .collect(),
      ),
    ).toEqual([]);
  });

  it('derives season batches from canonical metadata and applies them idempotently', async () => {
    const { t, asUser } = await setup();
    const itemId = await asUser.mutation(
      api.library.addItem,
      add('Daredevil', 61889, 'tv', { status: 'watching' }),
    );
    await t.run((ctx) =>
      ctx.db.insert('resolvedTitles', {
        tmdbId: 61889,
        mediaType: 'tv',
        title: 'Daredevil',
        episodeRunTime: [50],
        genres: [],
        cast: [],
        seasons: [
          { season: 1, name: 'Season 1', episodeCount: 2 },
          { season: 2, name: 'Season 2', episodeCount: 2 },
        ],
        metadataProvider: 'tmdb',
        orderEpoch: 0,
        refreshedAt: Date.now(),
        refreshAfter: Date.now() + 60_000,
      }),
    );
    await t.mutation(internal.resolvedMetadata.putSeason, {
      tmdbId: 61889,
      season: 1,
      metadataProvider: 'tmdb',
      episodes: [
        { season: 1, episode: 1, name: 'One' },
        { season: 1, episode: 2, name: 'Two' },
      ],
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
      orderEpoch: 0,
    });
    await t.mutation(internal.resolvedMetadata.putSeason, {
      tmdbId: 61889,
      season: 2,
      metadataProvider: 'tmdb',
      episodes: [
        { season: 2, episode: 1, name: 'Three' },
        { season: 2, episode: 2, name: 'Four' },
      ],
      refreshedAt: Date.now(),
      refreshAfter: Date.now() + 60_000,
      orderEpoch: 0,
    });
    const setSeason = (watched = true) =>
      asUser.action(api.library.setSeasonWatched, {
        itemId,
        season: 1,
        watched,
      });

    await setSeason();
    await setSeason();
    let episodes = await asUser.query(api.library.listEpisodes, { itemId, season: 1 });
    expect(episodes).toHaveLength(2);
    expect(episodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ season: 1, episode: 1, watched: true }),
        expect.objectContaining({ season: 1, episode: 2, watched: true }),
      ]),
    );
    await setSeason(false);
    episodes = await asUser.query(api.library.listEpisodes, { itemId, season: 1 });
    expect(episodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ season: 1, episode: 1, watched: false }),
        expect.objectContaining({ season: 1, episode: 2, watched: false }),
      ]),
    );
    await asUser.action(api.library.moveItemToWatched, { itemId });
    const watchedSeasons = await Promise.all([
      asUser.query(api.library.listEpisodes, { itemId, season: 1 }),
      asUser.query(api.library.listEpisodes, { itemId, season: 2 }),
    ]);
    expect(watchedSeasons).toHaveLength(2);
    expect(watchedSeasons.every((season) => season.every((episode) => episode.watched))).toBe(true);
    expect(
      (await asUser.query(api.library.listItems, {})).find((item) => item._id === itemId),
    ).toMatchObject({ status: 'watched', timesWatched: 1 });
  });

  it('computes episode stats from maintained summaries without raw episode rows', async () => {
    vi.useFakeTimers();
    const { t, userId, asUser } = await setup();
    const itemId = await asUser.mutation(
      api.library.addItem,
      add('Aggregate show', 700, 'tv', { status: 'watched', runtime: 45, tags: ['hero'] }),
    );
    await t.run((ctx) =>
      ctx.db.insert('episodeSummaries', {
        userId,
        itemId,
        season: 1,
        total: 2,
        watchedCount: 2,
        watchedRuntimeMinutes: 52,
        watchedRuntimeFallbackCount: 1,
        tagCounts: [{ tag: 'pilot', count: 2 }],
      }),
    );
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    await expect(asUser.query(api.stats.profile, {})).resolves.toMatchObject({
      episodesWatched: 2,
      totalWatchMinutes: 97,
      topTags: [
        { tag: 'pilot', count: 2 },
        { tag: 'hero', count: 1 },
      ],
    });
    await expect(t.run((ctx) => ctx.db.query('episodes').collect())).resolves.toEqual([]);
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
      await t.mutation(internal.resolvedMetadata.putSeason, {
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

    const itemId = await asUser.action(api.library.addItemAndMarkWatched, {
      tmdbId,
      mediaType: 'tv',
      title: 'Breaking Bad',
      status: 'watched',
      timesWatched: 1,
      tags: [],
    });

    expect(
      (await asUser.query(api.library.listItems, {})).find((item) => item._id === itemId),
    ).toMatchObject({ status: 'watched', timesWatched: 1 });
    const watched = (
      await Promise.all(
        [0, 1, 2].map((season) => asUser.query(api.library.listEpisodes, { itemId, season })),
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
      api.library.addItem,
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
      api.library.addItem,
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
