import { describe, expect, it } from 'vitest';
import {
  mergeBookmark,
  normalizeBookmarkStore,
  sortBookmarks,
} from './bookmarks';
import type { EpisodeBookmark } from './types';

const slimeEpisode1: EpisodeBookmark = {
  seriesId: 'GYZJ43JMR',
  seriesTitle: 'That Time I Got Reincarnated as a Slime',
  seriesUrl: 'https://www.crunchyroll.com/series/GYZJ43JMR/slime',
  seasonNumber: '1',
  episodeNumber: '1',
  episodeTitle: 'The Storm Dragon, Veldora',
  episodeId: 'GRQW9GW7R',
  watchUrl: 'https://www.crunchyroll.com/watch/GRQW9GW7R/the-storm-dragon-veldora',
  updatedAt: 100,
};

describe('mergeBookmark', () => {
  it('replaces the previous episode for the same series', () => {
    const episode2 = {
      ...slimeEpisode1,
      episodeId: 'G6245P09Y',
      episodeNumber: '2',
      episodeTitle: 'Meeting the Goblins',
      watchUrl: 'https://www.crunchyroll.com/watch/G6245P09Y/meeting-the-goblins',
      updatedAt: 200,
    };

    expect(
      mergeBookmark({ version: 1, bookmarks: { GYZJ43JMR: slimeEpisode1 } }, episode2),
    ).toEqual({
      version: 1,
      bookmarks: { GYZJ43JMR: episode2 },
    });
  });

  it('preserves bookmarks for other series', () => {
    const other = { ...slimeEpisode1, seriesId: 'OTHER', seriesTitle: 'Other Show' };
    const result = mergeBookmark(
      { version: 1, bookmarks: { OTHER: other } },
      slimeEpisode1,
    );

    expect(Object.keys(result.bookmarks)).toEqual(['OTHER', 'GYZJ43JMR']);
  });
});

describe('sortBookmarks', () => {
  it('orders bookmarks from most recently updated', () => {
    const older = { ...slimeEpisode1, seriesId: 'OLDER', updatedAt: 1 };
    const newer = { ...slimeEpisode1, seriesId: 'NEWER', updatedAt: 2 };

    expect(sortBookmarks({ OLDER: older, NEWER: newer }).map((item) => item.seriesId)).toEqual([
      'NEWER',
      'OLDER',
    ]);
  });
});

describe('normalizeBookmarkStore', () => {
  it('returns an empty versioned store for malformed data', () => {
    expect(normalizeBookmarkStore({ version: 2, bookmarks: 'bad' })).toEqual({
      version: 1,
      bookmarks: {},
    });
    expect(normalizeBookmarkStore(null)).toEqual({ version: 1, bookmarks: {} });
  });
});

