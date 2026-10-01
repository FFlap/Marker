import { describe, expect, it } from 'vitest';
import { currentSeasonPages } from '../../src/features/title/seasonPages';

const page = (chunkIndex: number, overrides = {}) => ({
  season: 1,
  metadataProvider: 'tvdb',
  orderEpoch: 2,
  seasonVersion: 'current',
  totalCount: 240,
  chunkIndex,
  episodes: [{ episode: chunkIndex * 120 + 1 }],
  ...overrides,
});

describe('reactive season pagination', () => {
  it('deduplicates restarted cursors and rejects old season/provider/order/version pages', () => {
    const first = page(0);
    const second = page(1);
    const result = currentSeasonPages(
      [
        first,
        page(0),
        page(1, { seasonVersion: 'old' }),
        page(1, { orderEpoch: 1 }),
        page(1, { metadataProvider: 'tmdb' }),
        page(1, { season: 2 }),
        page(1, { totalCount: 120 }),
        second,
      ],
      1,
    );
    expect(result).toEqual([first, second]);
    expect(result.flatMap((entry) => entry.episodes)).toEqual([{ episode: 1 }, { episode: 121 }]);
  });

  it('requires the first page of the selected season', () => {
    expect(currentSeasonPages([page(1)], 1)).toEqual([]);
    expect(currentSeasonPages([page(0)], 2)).toEqual([]);
    expect(currentSeasonPages([page(0)], undefined)).toEqual([]);
  });

  it('stops at a version gap until the missing current chunk arrives', () => {
    const first = page(0);
    const second = page(1);
    const third = page(2);
    const results = [first, page(1, { seasonVersion: 'old' }), third];
    expect(currentSeasonPages(results, 1)).toEqual([first]);
    expect(currentSeasonPages([...results, second], 1)).toEqual([first, second, third]);
  });

  it('accepts old server responses without a version', () => {
    expect(currentSeasonPages([page(0, { seasonVersion: undefined })], 1)).toHaveLength(1);
  });
});
