import { describe, expect, it } from 'vitest';
import {
  captionFromLines,
  clipSynopsis,
  compareTitles,
  displayEpisodeName,
  displayGenres,
} from '../../src/lib/text';

describe('displayEpisodeName', () => {
  it('title-cases names stored in capitals', () => {
    expect(displayEpisodeName('SECURE A WIFE')).toBe('Secure a Wife');
    expect(displayEpisodeName('THE COUNTER-SECRET POLICE')).toBe('The Counter-Secret Police');
    expect(displayEpisodeName('WHAT ARE YOU LOOKING AT')).toBe('What Are You Looking At');
    expect(displayEpisodeName('THE END OF THE WORLD')).toBe('The End of the World');
    expect(displayEpisodeName('THE PRESTIGIOUS SCHOOL’S INTERVIEW')).toBe(
      'The Prestigious School’s Interview',
    );
  });

  it('leaves mixed case and short names alone', () => {
    expect(displayEpisodeName('Operation Strix')).toBe('Operation Strix');
    expect(displayEpisodeName('USA')).toBe('USA');
  });
});

describe('clipSynopsis', () => {
  it('cuts long text at a whole word with an ellipsis', () => {
    const clipped = clipSynopsis(`${'word '.repeat(100)}end`);
    expect(clipped.length).toBeLessThanOrEqual(400);
    expect(clipped.endsWith('word…')).toBe(true);
  });

  it('tidies text that was stored cut mid-word', () => {
    const stored = `${'word '.repeat(79)}wor`;
    expect(stored.length).toBe(398);
    expect(clipSynopsis(`${stored}d`.padEnd(399, 'x'))).toMatch(/word…$/);
    expect(clipSynopsis('A complete sentence.')).toBe('A complete sentence.');
  });

  it('never exceeds the limit, even without spaces', () => {
    for (const length of [399, 400, 401])
      expect(clipSynopsis('界'.repeat(length)).length).toBeLessThanOrEqual(400);
  });
});

describe('displayGenres', () => {
  it('splits paired genres, removes repeats and redundant Animation', () => {
    expect(displayGenres(['Animation', 'Action & Adventure', 'Comedy', 'Anime', 'Action'])).toEqual(
      ['Action', 'Adventure', 'Comedy', 'Anime'],
    );
    expect(displayGenres(['Animation', 'Family'])).toEqual(['Animation', 'Family']);
  });
});

describe('captionFromLines', () => {
  const line = (text: string, width: number) => ({ text, width });

  it('leaves titles that fit', () => {
    expect(captionFromLines([line('Paprika', 40)], 60, 10)).toBeUndefined();
    expect(captionFromLines([line('SPY x ', 30), line('FAMILY', 40)], 60, 10)).toBeUndefined();
  });

  it('keeps the last word when the ellipsis still fits beside it', () => {
    expect(
      captionFromLines(
        [line('Frieren: ', 44), line('Beyond ', 38), line('Journey’s End', 70)],
        60,
        10,
      ),
    ).toBe('Frieren: Beyond…');
  });

  it('drops the last word when the ellipsis would not fit', () => {
    expect(
      captionFromLines(
        [line('Frieren: ', 44), line('Beyond Journey’s ', 70), line('End', 18)],
        60,
        10,
      ),
    ).toBe('Frieren: Beyond…');
  });

  it('never ends on a connecting word', () => {
    expect(
      captionFromLines([line('Inception: ', 55), line('The Cobol ', 56), line('Job', 18)], 60, 10),
    ).toBe('Inception…');
  });
});

describe('compareTitles', () => {
  it('ignores leading brackets and case, and orders numbers naturally', () => {
    expect(
      ['【OSHI NO KO】', 'Chainsaw Man', 'paprika', 'Season 10', 'Season 2'].sort(compareTitles),
    ).toEqual(['Chainsaw Man', '【OSHI NO KO】', 'paprika', 'Season 2', 'Season 10']);
  });
});
