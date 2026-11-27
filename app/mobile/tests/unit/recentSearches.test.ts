import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-file-system', () => ({ File: class {}, Paths: {} }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const { restoredRecentSearches, withRecentSearch, RECENT_SEARCH_LIMIT } =
  await import('../../src/lib/recentSearches');

describe('withRecentSearch', () => {
  it('puts the newest first and keeps one entry per query', () => {
    expect(withRecentSearch(['spy', 'frieren'], '  Frieren ')).toEqual(['Frieren', 'spy']);
  });

  it('ignores very short queries and caps the list', () => {
    expect(withRecentSearch(['spy'], 'a')).toEqual(['spy']);
    const many = Array.from({ length: RECENT_SEARCH_LIMIT }, (_, index) => `show ${index}`);
    expect(withRecentSearch(many, 'new show')).toHaveLength(RECENT_SEARCH_LIMIT);
  });
});

describe('restoredRecentSearches', () => {
  it('keeps searches made after clearing first and drops repeats', () => {
    expect(restoredRecentSearches(['Dune'], ['spy', 'DUNE', 'frieren'])).toEqual([
      'Dune',
      'spy',
      'frieren',
    ]);
  });

  it('stays within the limit', () => {
    const cleared = Array.from({ length: 8 }, (_, index) => `query ${index}`);
    expect(restoredRecentSearches(['new'], cleared)).toHaveLength(8);
  });
});
