import { describe, expect, it, vi } from 'vitest';
import { persistDetectedEpisode } from './tracking';
import type { EpisodeBookmark } from './types';

const episode: EpisodeBookmark = {
  seriesId: 'GT00258001',
  seriesTitle: 'Witch Hat Atelier',
  seriesUrl: 'https://www.crunchyroll.com/series/GT00258001/witch-hat-atelier',
  seasonNumber: '1',
  episodeNumber: '2',
  episodeTitle: 'The School of the Grassland',
  episodeId: 'GE00258181JAJP',
  watchUrl:
    'https://www.crunchyroll.com/watch/GE00258181JAJP/the-school-of-the-grassland',
  updatedAt: 100,
};

describe('persistDetectedEpisode', () => {
  it('writes a newly detected episode directly to local extension storage', async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    };

    const changed = await persistDetectedEpisode(storage, episode);

    expect(changed).toBe(true);
    expect(storage.set).toHaveBeenCalledWith({
      markerBookmarks: {
        version: 1,
        bookmarks: { 'crunchyroll:GT00258001': episode },
      },
    });
  });

  it('does not rewrite an unchanged episode', async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({
        markerBookmarks: {
          version: 1,
          bookmarks: { 'crunchyroll:GT00258001': episode },
        },
      }),
      set: vi.fn().mockResolvedValue(undefined),
    };

    const changed = await persistDetectedEpisode(storage, episode);

    expect(changed).toBe(false);
    expect(storage.set).not.toHaveBeenCalled();
  });

});
