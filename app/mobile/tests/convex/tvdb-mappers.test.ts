import { describe, expect, it } from 'vitest';
import {
  episodesForSeason,
  knownAnimeSeasonName,
  mapEpisode,
  seasonDisplayName,
  seasonTranslationLimit,
  selectSeasonOrder,
} from '../../convex/tvdb';
import { hideResolvedEmptySeasons, mergeSeasonDisplayNames } from '../../convex/seasonNames';
import { releasedEpisodes } from '../../convex/episodeAvailability';

describe('TVDB anime metadata mapping', () => {
  it('maps episode artwork, synopsis, runtime, and English coordinates', () => {
    expect(
      mapEpisode({
        id: 361887,
        seasonNumber: 1,
        number: 1,
        name: "I'm Luffy!",
        overview: 'Luffy begins his journey.',
        runtime: 25,
        aired: '1999-10-20',
        image: 'https://artworks.thetvdb.com/banners/v4/episode/361887/screencap.jpg',
      }),
    ).toEqual({
      id: 361887,
      season: 1,
      episode: 1,
      name: "I'm Luffy!",
      overview: 'Luffy begins his journey.',
      runtime: 25,
      airDate: '1999-10-20',
      imageUrl: 'https://artworks.thetvdb.com/banners/v4/episode/361887/screencap.jpg',
    });
  });

  it('enforces the requested season when TVDB returns every season', () => {
    const seasonOne = {
      id: 1,
      season: 1,
      episode: 1,
      name: 'Season one episode',
      imageUrl: 'https://example.com/season-one.jpg',
    };
    const seasonTwo = {
      id: 2,
      season: 2,
      episode: 1,
      name: 'Future episode without artwork',
    };
    expect(episodesForSeason([seasonOne, seasonTwo], 1)).toEqual([seasonOne]);
    expect(episodesForSeason([seasonOne, seasonTwo])).toEqual([seasonOne, seasonTwo]);
  });

  it('selects TVDB aired order even when arc-style alternatives exist', () => {
    expect(
      selectSeasonOrder(
        [
          { id: 1, number: 1, name: 'Season 1', type: 'official', typeId: 1 },
          { id: 2, number: 1, name: 'East Blue Arc', type: 'alternate', typeId: 2 },
          { id: 3, number: 2, name: 'Alabasta Arc', type: 'alternate', typeId: 2 },
        ],
        1,
      ),
    ).toBe('official');
  });

  it('keeps aired order when TVDB also provides Alternate Order 2', () => {
    expect(
      selectSeasonOrder(
        [
          { id: 1, number: 1, name: 'Season 1', type: 'official', typeId: 1 },
          { id: 2, number: 1, name: 'East Blue Arc', type: 'alternate', typeId: 4 },
          { id: 3, number: 1, name: '1st East Blue Arc', type: 'alttwo', typeId: 5 },
          { id: 4, number: 2, name: '2nd Grand Line Arc', type: 'alttwo', typeId: 5 },
        ],
        1,
      ),
    ).toBe('official');
  });

  it('translates every current season instead of stopping after season 12', () => {
    expect(seasonTranslationLimit(32)).toBe(32);
    expect(seasonTranslationLimit(2)).toBe(2);
    expect(seasonTranslationLimit(100)).toBe(64);
  });

  it('fills generic and non-English TVDB labels from matching TMDB seasons', () => {
    expect(
      mergeSeasonDisplayNames(
        [
          { season: 12, name: 'Amazon Lily', episodeCount: 14 },
          { season: 13, name: 'Season 13', episodeCount: 101 },
          { season: 21, name: 'ワノ国編', episodeCount: 197 },
        ],
        [
          { season: 12, name: 'Amazon Lily', episodeCount: 14 },
          { season: 13, name: 'Impel Down & Marineford', episodeCount: 101 },
          { season: 21, name: 'Wano Country Arc', episodeCount: 197 },
        ],
      ),
    ).toEqual([
      { season: 12, name: 'Amazon Lily', episodeCount: 14 },
      { season: 13, name: 'Impel Down & Marineford', episodeCount: 101 },
      { season: 21, name: 'Wano Country Arc', episodeCount: 197 },
    ]);
  });

  it('does not replace TVDB ordering or counts while merging display names', () => {
    expect(
      mergeSeasonDisplayNames(
        [{ season: 4, name: 'Season 4', episodeCount: 39 }],
        [
          { season: 3, name: 'Drum Island', episodeCount: 14 },
          { season: 4, name: 'Alabasta', episodeCount: 99 },
        ],
      ),
    ).toEqual([{ season: 4, name: 'Alabasta', episodeCount: 39 }]);
  });

  it('hides a season only after its resolved episode list is empty', () => {
    expect(
      hideResolvedEmptySeasons(
        [
          { season: 1, name: 'Season 1', episodeCount: 28 },
          { season: 2, name: 'Season 2', episodeCount: 13 },
          { season: 3, name: 'The Golden Land Arc', episodeCount: 1 },
        ],
        [
          { season: 2, episodeCount: 3 },
          { season: 3, episodeCount: 0 },
        ],
      ),
    ).toEqual([
      { season: 1, name: 'Season 1', episodeCount: 28 },
      { season: 2, name: 'Season 2', episodeCount: 13 },
    ]);
  });

  it('hides future and undated placeholder episodes until they are released', () => {
    const episodes = [
      {
        season: 2,
        episode: 3,
        name: 'The Year That Passed',
        airDate: '2026-07-19',
        overview: 'A released episode.',
      },
      { season: 2, episode: 4, name: 'Episode 4', airDate: '2026-07-26' },
      { season: 2, episode: 5, name: 'Episode 5' },
      { season: 2, episode: 6, name: 'A real episode without a date', overview: 'Published.' },
    ];

    expect(releasedEpisodes(episodes, Date.parse('2026-07-24T12:00:00Z'))).toEqual([
      episodes[0],
      episodes[3],
    ]);
    expect(releasedEpisodes(episodes, Date.parse('2026-07-26T12:00:00Z'))).toEqual([
      episodes[0],
      episodes[1],
      episodes[3],
    ]);
  });

  it('keeps the official two-season order for ordinary anime', () => {
    expect(
      selectSeasonOrder(
        [
          { id: 1, number: 1, name: 'Season 1', type: 'official', typeId: 1 },
          { id: 2, number: 2, name: 'Season 2', type: 'official', typeId: 1 },
          { id: 3, number: 1, name: 'Season 1', type: 'absolute', typeId: 3 },
        ],
        1,
      ),
    ).toBe('official');
  });

  it('uses TVDB English season translations instead of generic raw labels', () => {
    expect(seasonDisplayName(3, 'Season 3', 'Sky Island')).toBe('Sky Island');
    expect(seasonDisplayName(3, '3. Staffel', 'Kaguya-sama: Love Is War -Ultra Romantic-')).toBe(
      'Kaguya-sama: Love Is War -Ultra Romantic-',
    );
    expect(seasonDisplayName(2, 'Season 2', 'The Divine Visionary Candidate Exam Arc')).toBe(
      'The Divine Visionary Candidate Exam Arc',
    );
    expect(seasonDisplayName(4, 'Season 4', 'Season 4')).toBe('Season 4');
    expect(seasonDisplayName(3, '3. Staffel', 'Season 3')).toBe('Season 3');
  });

  it('fills the missing Kaguya-sama season two title', () => {
    expect(knownAnimeSeasonName(['Kaguya-sama: Love Is War'], 2)).toBe('Kaguya-sama: Love Is War?');
  });
});
