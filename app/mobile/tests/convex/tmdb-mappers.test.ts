import { describe, expect, it } from 'vitest';
import { mapSearchResponse, mapSeasonDetails, mapTvDetails } from '../../convex/tmdb';

describe('TMDB mapper contracts', () => {
  it('does not expose announced episode totals for seasons that have not premiered', () => {
    const today = new Date().toISOString().slice(0, 10);
    const tv = mapTvDetails({
      id: 1,
      name: 'Show',
      seasons: [
        { season_number: 0, name: 'Specials', episode_count: 0, air_date: null },
        { season_number: 1, name: 'Season 1', episode_count: 12, air_date: '2020-01-01' },
        { season_number: 2, name: 'Season 2', episode_count: 12, air_date: '2999-01-01' },
        { season_number: 3, name: 'Season 3', episode_count: 1, air_date: today },
      ],
    });
    expect(tv.seasons.map((season) => season.episodeCount)).toEqual([0, 12, 0, 1]);
  });

  it('maps supported search fields and excludes unsupported media types', () => {
    expect(
      mapSearchResponse({
        results: [
          {
            id: 299534,
            media_type: 'movie',
            title: 'Avengers: Endgame',
            original_title: 'Avengers: Endgame',
            poster_path: '/poster.jpg',
            overview: 'After the Snap',
            release_date: '2019-04-24',
            vote_average: 8.3,
          },
          { id: 1, media_type: 'person', name: 'Someone' },
        ],
      }),
    ).toEqual([
      {
        id: 299534,
        title: 'Avengers: Endgame',
        originalTitle: 'Avengers: Endgame',
        mediaType: 'movie',
        posterPath: '/poster.jpg',
        overview: 'After the Snap',
        releaseDate: '2019-04-24',
        voteAverage: 8.3,
      },
    ]);
  });

  it('keeps valid search results and null posters while skipping malformed entries', () => {
    expect(
      mapSearchResponse({
        results: [
          { media_type: 'movie', id: 1, title: 'Valid', poster_path: null },
          { media_type: 'movie', title: 'No id' },
          { media_type: 'tv', id: 2, name: '  ' },
        ],
      }),
    ).toEqual([expect.objectContaining({ id: 1, title: 'Valid', posterPath: undefined })]);
  });

  it('filters missing identifiers and preserves real season zero records', () => {
    const tv = mapTvDetails({
      id: 1,
      name: 'Show',
      seasons: [
        { season_number: null, name: 'Bad' },
        { season_number: 0, name: 'Specials', episode_count: 2 },
      ],
    });
    expect(tv.seasons).toEqual([{ season: 0, name: 'Specials', episodeCount: 2 }]);
    expect(
      mapSeasonDetails({
        season_number: 0,
        episodes: [
          { episode_number: 0, name: 'Special' },
          { episode_number: null, name: 'Bad' },
          { name: 'Missing' },
        ],
      }),
    ).toEqual([expect.objectContaining({ season: 0, episode: 0 })]);
  });
});
