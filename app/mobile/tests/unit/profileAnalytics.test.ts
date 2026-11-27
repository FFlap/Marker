import { describe, expect, it } from 'vitest';
import { analyzeActivity, analyzeLibrary } from '../../src/lib/profileAnalytics';
import { sortLibraryItems } from '../../src/lib/libraryFilters';

const today = '2026-11-23';

describe('analyzeActivity', () => {
  const days = [
    { date: '2026-11-23', episodes: 4 },
    { date: '2026-11-21', episodes: 2 },
    { date: '2026-11-14', episodes: 3 },
    { date: '2026-10-01', episodes: 5 },
    { date: '2025-11-30', episodes: 7 },
  ];

  it('compares the last seven days with the seven before them', () => {
    const week = analyzeActivity(days, today, 'week');
    expect(week.buckets).toHaveLength(7);
    expect(week.buckets.at(-1)).toMatchObject({ key: today, episodes: 4 });
    expect(week.total).toBe(6);
    expect(week.previousTotal).toBe(3);
    expect(week.activeDays).toBe(2);
    expect(week.periodDays).toBe(7);
    expect(week.perDay).toBeCloseTo(6 / 7);
    expect(week.bestDay).toEqual({ date: today, episodes: 4 });
    // 2026-11-23 is a Monday.
    expect(week.weekdays.find((day) => day.label === 'Mon')?.episodes).toBe(4);
  });

  it('groups a year by month and keeps the comparison window', () => {
    const year = analyzeActivity(days, today, 'year');
    expect(year.buckets).toHaveLength(12);
    expect(year.buckets.at(-1)?.episodes).toBe(9);
    expect(year.total).toBe(14);
    expect(year.previousTotal).toBe(7);
  });

  it('averages over the whole period and over active days', () => {
    const week = analyzeActivity(days, today, 'week');
    expect(week.perActiveDay).toBeCloseTo(week.total / week.activeDays);
    expect(analyzeActivity([], today, 'week').perActiveDay).toBe(0);
  });

  it('ignores days after today', () => {
    expect(analyzeActivity([{ date: '2026-11-24', episodes: 9 }], today, 'week').total).toBe(0);
  });
});

describe('analyzeLibrary', () => {
  it('splits paired TMDB genres and counts each once per title', () => {
    const library = analyzeLibrary([
      {
        status: 'watched',
        mediaType: 'tv',
        isAnime: false,
        timesWatched: 1,
        genres: ['Action & Adventure', 'Action', 'Sci-Fi & Fantasy'],
      },
      {
        status: 'watched',
        mediaType: 'movie',
        isAnime: false,
        timesWatched: 1,
        genres: ['Action'],
      },
    ]);
    expect(library.genres).toEqual([
      { genre: 'Action', count: 2 },
      { genre: 'Adventure', count: 1 },
      { genre: 'Fantasy', count: 1 },
      { genre: 'Sci-Fi', count: 1 },
    ]);
  });

  it('counts statuses, kinds, ratings, rewatches and genres', () => {
    const library = analyzeLibrary([
      {
        status: 'watched',
        mediaType: 'tv',
        isAnime: true,
        rating: 4.5,
        timesWatched: 3,
        genres: ['Anime', 'Action', 'Comedy'],
      },
      { status: 'watching', mediaType: 'tv', isAnime: false, timesWatched: 0, genres: ['Action'] },
      { status: 'watchlist', mediaType: 'movie', isAnime: false, rating: 1, timesWatched: 0 },
    ]);
    expect(library.status).toEqual({ watched: 1, watching: 1, watchlist: 1, dropped: 0 });
    expect(library.kinds).toEqual({ anime: 1, tv: 1, movie: 1 });
    expect(library.ratings).toEqual([1, 0, 0, 1, 0]);
    expect(library.rewatches).toBe(2);
    expect(library.genres).toEqual([
      { genre: 'Action', count: 2 },
      { genre: 'Comedy', count: 1 },
    ]);
  });
});

describe('sortLibraryItems', () => {
  const items = [
    { title: 'Bravo', rating: 3, createdAt: 2, updatedAt: 9 },
    { title: 'alpha', createdAt: 3, updatedAt: 1 },
    { title: 'Charlie', rating: 5, createdAt: 1, updatedAt: 5 },
  ];
  const titles = (sorted: typeof items) => sorted.map((item) => item.title);

  it('keeps the saved order for the custom sort', () => {
    expect(titles(sortLibraryItems(items, 'custom'))).toEqual(['Bravo', 'alpha', 'Charlie']);
  });

  it('sorts by title, rating, date added and date updated', () => {
    expect(titles(sortLibraryItems(items, 'title'))).toEqual(['alpha', 'Bravo', 'Charlie']);
    expect(titles(sortLibraryItems(items, 'rating'))).toEqual(['Charlie', 'Bravo', 'alpha']);
    expect(titles(sortLibraryItems(items, 'added'))).toEqual(['alpha', 'Bravo', 'Charlie']);
    expect(titles(sortLibraryItems(items, 'updated'))).toEqual(['Bravo', 'Charlie', 'alpha']);
  });
});
