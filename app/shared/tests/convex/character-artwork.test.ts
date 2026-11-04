import { afterEach, expect, it, vi } from 'vitest';
import { convexTest } from 'convex-test';
import { mapCharacterArtwork, withCharacterArtwork } from '../../convex/characterArtwork';
import { resolveFreshTitle } from '../../convex/resolvedMetadata/titleResolution';
import { selectTitleMatch, verifiedTmdbRemoteMovie } from '../../convex/tvdbParsing';
import type { ActionCtx } from '../../convex/_generated/server';
import { internal } from '../../convex/_generated/api';
import schema from '../../convex/schema';

const cast = [{ name: 'Ikue Otani', character: 'Pikachu (voice)', profilePath: '/actor.jpg' }];
const characters = [
  {
    name: 'Pikachu',
    personName: 'Ikue Otani',
    imageUrl: 'https://artworks.thetvdb.com/pikachu.jpg',
  },
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each(['remote', 'title'] as const)('loads movie artwork via %s lookup', async (lookup) => {
  vi.stubEnv('TVDB_API_KEY', 'test-key');
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const data = url.endsWith('/login')
      ? { token: 'test-token' }
      : url.includes('/search/remoteid/')
        ? lookup === 'remote'
          ? [{ sourceName: 'TheMovieDB.com', movie: { id: 101, name: 'Pokemon' } }]
          : []
        : url.includes('/search?')
          ? [
              {
                id: 'movie-101',
                type: 'movie',
                name: 'Pokemon',
                remote_ids: [{ id: '77', sourceName: 'TheMovieDB.com' }],
              },
            ]
          : url.endsWith('/movies/101/extended')
            ? {
                characters: [
                  {
                    name: 'Pikachu',
                    image: 'https://artworks.thetvdb.com/pikachu.jpg',
                    personName: 'Ikue Otani',
                  },
                ],
              }
            : undefined;
    if (!data) throw new Error(`Unexpected URL: ${url}`);
    return new Response(JSON.stringify({ data }));
  });
  vi.stubGlobal('fetch', fetchMock);
  const t = convexTest({ schema, modules: import.meta.glob('../../convex/**/*.ts') });
  expect(
    await t.action(internal.tvdb.getCharacterArtwork, {
      tmdbId: 77,
      mediaType: 'movie',
      title: 'Pokemon',
    }),
  ).toEqual(characters);
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/search?'))).toBe(
    lookup === 'title',
  );
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/movies/101/extended'))).toBe(
    true,
  );
});

it('uses character artwork, not the separate actor portrait, and normalizes relative URLs', () => {
  expect(
    mapCharacterArtwork({
      characters: [
        {
          name: 'Pikachu',
          image: '/banners/pikachu.jpg',
          personImgURL: 'https://example.com/actor.jpg',
        },
        { name: 'Ash', personImgURL: 'https://example.com/actor.jpg' },
        { name: 'Misty', image: '' },
        { name: 'Narrator', image: 'https://example.com/narrator.jpg' },
      ],
    }),
  ).toEqual([{ name: 'Pikachu', imageUrl: 'https://artworks.thetvdb.com/banners/pikachu.jpg' }]);
});

it('matches voice suffixes and reversed names while preserving the original cast and actor image', () => {
  expect(withCharacterArtwork(cast, [{ ...characters[0], personName: 'Otani, Ikue' }])).toEqual([
    { ...cast[0], characterImageUrl: characters[0].imageUrl },
  ]);
  expect(cast[0]).not.toHaveProperty('characterImageUrl');
});

it('matches bilingual aliases and combined roles observed in live TVDB records', () => {
  expect(
    withCharacterArtwork(
      [
        { name: 'Taito Ban', character: 'Amane Fujimiya (voice)' },
        { name: 'Morwenna Banks', character: 'Mummy Pig / Madame Gazelle (voice)' },
      ],
      [
        {
          name: '藤宮 周 / Amane Fujimiya',
          personName: 'Taito Ban',
          imageUrl: 'https://example.com/amane.jpg',
        },
        {
          name: 'Mummy Pig',
          personName: 'Morwenna Banks',
          imageUrl: 'https://example.com/mummy.jpg',
        },
      ],
    ).map((member) => member.characterImageUrl),
  ).toEqual(['https://example.com/amane.jpg', 'https://example.com/mummy.jpg']);
});

it('accepts a long-vowel romanization only when the voice actor also matches', () => {
  const member = { name: 'Yoshitsugu Matsuoka', character: 'Futaro Uesugi (voice)' };
  const artwork = {
    name: 'Fuutarou Uesugi',
    personName: 'Yoshitsugu Matsuoka',
    imageUrl: 'https://example.com/futaro.jpg',
  };
  expect(withCharacterArtwork([member], [artwork])[0].characterImageUrl).toBe(artwork.imageUrl);
  expect(withCharacterArtwork([member], [{ ...artwork, personName: 'Other actor' }])).toEqual([
    member,
  ]);
});

it('leaves unmatched or ambiguous roles alone and uses actor identity to resolve ambiguity', () => {
  expect(withCharacterArtwork(cast, [{ ...characters[0], name: 'Ash' }])).toEqual(cast);
  const ambiguous = [
    characters[0],
    { ...characters[0], personName: 'Other actor', imageUrl: 'https://example.com/other.jpg' },
  ];
  expect(withCharacterArtwork(cast, ambiguous)[0].characterImageUrl).toBe(characters[0].imageUrl);
  expect(
    withCharacterArtwork(
      cast,
      ambiguous.map(({ personName: _person, ...entry }) => entry),
    ),
  ).toEqual(cast);
});

it('rejects movie lookalikes with conflicting TMDB IDs or equally ranked matches', () => {
  const movie = { id: 'movie-10', type: 'movie', name: 'Animated movie' };
  expect(selectTitleMatch([movie], 77, [movie.name], 'movie')).toEqual(movie);
  expect(
    selectTitleMatch([movie, { ...movie, id: 'movie-11' }], 77, [movie.name], 'movie'),
  ).toBeUndefined();
  expect(
    selectTitleMatch(
      [{ ...movie, remote_ids: [{ sourceName: 'TheMovieDB.com', id: '99' }] }],
      77,
      [movie.name],
      'movie',
    ),
  ).toBeUndefined();
});

it.each(['movie', 'tv'] as const)(
  'enriches animated %s cast through TVDB and persists the optional field',
  async (mediaType) => {
    const runAction = vi
      .fn()
      .mockResolvedValueOnce({ title: 'Pokemon', genres: ['Animation'], cast });
    if (mediaType === 'tv') runAction.mockResolvedValueOnce(null);
    runAction.mockResolvedValueOnce(characters);
    const { value } = await resolveFreshTitle(
      { runAction } as unknown as ActionCtx,
      { mediaType, tmdbId: 77 },
      null,
      null,
      false,
    );
    expect(value.cast[0]).toEqual({ ...cast[0], characterImageUrl: characters[0].imageUrl });
    const t = convexTest({ schema, modules: import.meta.glob('../../convex/**/*.ts') });
    await t.run((ctx) => ctx.db.insert('resolvedTitles', value));
    expect(
      (await t.query(internal.resolvedMetadata.reads.readTitle, { mediaType, tmdbId: 77 }))?.cast,
    ).toEqual(value.cast);
  },
);

it('reuses characters from the anime guide without another artwork request', async () => {
  const runAction = vi
    .fn()
    .mockResolvedValueOnce({ title: 'Pokemon', genres: ['Anime'], cast })
    .mockResolvedValueOnce({
      tvdbId: 88,
      order: 'official',
      genres: ['Anime'],
      episodeRunTime: [],
      seasons: [],
      characters,
    });
  const { value } = await resolveFreshTitle(
    { runAction } as unknown as ActionCtx,
    { mediaType: 'tv', tmdbId: 77 },
    null,
    null,
    false,
  );
  expect(value.cast[0].characterImageUrl).toBe(characters[0].imageUrl);
  expect(runAction).toHaveBeenCalledTimes(2);
});

it('keeps actor photos when TVDB fails and skips lookup for live action', async () => {
  const runAction = vi
    .fn()
    .mockResolvedValueOnce({ title: 'Animated movie', genres: ['Animation'], cast })
    .mockRejectedValueOnce(new Error('TVDB unavailable'));
  const animated = await resolveFreshTitle(
    { runAction } as unknown as ActionCtx,
    { mediaType: 'movie', tmdbId: 77 },
    null,
    null,
    false,
  );
  expect(animated.value.cast).toEqual(cast);
  expect(animated.partial).toBe(false);
  runAction.mockReset().mockResolvedValueOnce({ title: 'Live action', genres: ['Drama'], cast });
  const live = await resolveFreshTitle(
    { runAction } as unknown as ActionCtx,
    { mediaType: 'movie', tmdbId: 77 },
    null,
    null,
    false,
  );
  expect(live.value.cast).toEqual(cast);
  expect(runAction).toHaveBeenCalledTimes(1);
});

it('matches artwork beyond the first 200 provider characters', () => {
  const mapped = mapCharacterArtwork({
    characters: [
      ...Array.from({ length: 200 }, (_, i) => ({ name: `Other ${i}`, image: `/other-${i}.jpg` })),
      { name: 'Pikachu', image: characters[0].imageUrl },
    ],
  });
  expect(withCharacterArtwork(cast, mapped)[0].characterImageUrl).toBe(characters[0].imageUrl);
});

it('rejects unrelated providers, series, and movie title collisions in remote lookup', () => {
  expect(
    verifiedTmdbRemoteMovie({ sourceName: 'IMDB', movie: { id: 101, name: 'Pokemon' } }, [
      'Pokemon',
    ]),
  ).toBeUndefined();
  expect(
    verifiedTmdbRemoteMovie({ sourceName: 'TMDB', series: { id: 101, name: 'Pokemon' } }, [
      'Pokemon',
    ]),
  ).toBeUndefined();
  expect(
    verifiedTmdbRemoteMovie({ sourceName: 'TMDB', movie: { id: 101, name: 'Other' } }, ['Pokemon']),
  ).toBeUndefined();
});

it.each(['empty', 'failed', 'fresh'] as const)(
  'preserves or replaces saved artwork on %s refresh',
  async (result) => {
    const runAction = vi
      .fn()
      .mockResolvedValueOnce({ title: 'Pokemon', genres: ['Animation'], cast })
      .mockResolvedValueOnce(characters);
    const initial = await resolveFreshTitle(
      { runAction } as unknown as ActionCtx,
      { mediaType: 'movie', tmdbId: 77 },
      null,
      null,
      false,
    );
    const t = convexTest({ schema, modules: import.meta.glob('../../convex/**/*.ts') });
    await t.run((ctx) => ctx.db.insert('resolvedTitles', initial.value));
    const current = await t.query(internal.resolvedMetadata.reads.readTitle, {
      mediaType: 'movie',
      tmdbId: 77,
    });
    runAction.mockReset().mockResolvedValueOnce({ title: 'Pokemon', genres: ['Animation'], cast });
    if (result === 'failed') runAction.mockRejectedValueOnce(new Error('TVDB unavailable'));
    else
      runAction.mockResolvedValueOnce(
        result === 'empty' ? [] : [{ ...characters[0], imageUrl: 'https://example.com/new.jpg' }],
      );
    const refreshed = await resolveFreshTitle(
      { runAction } as unknown as ActionCtx,
      { mediaType: 'movie', tmdbId: 77 },
      current,
      null,
      false,
    );
    expect(refreshed.value.cast[0].characterImageUrl).toBe(
      result === 'fresh' ? 'https://example.com/new.jpg' : characters[0].imageUrl,
    );
  },
);

it('resolves provider metadata with omitted optional genres', async () => {
  const runAction = vi.fn().mockResolvedValue({ title: 'Movie', cast });
  const { value } = await resolveFreshTitle(
    { runAction } as unknown as ActionCtx,
    { mediaType: 'movie', tmdbId: 77 },
    null,
    null,
    false,
  );
  expect(value.cast).toEqual(cast);
  expect(runAction).toHaveBeenCalledTimes(1);
});
