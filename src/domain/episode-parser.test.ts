import { describe, expect, it } from 'vitest';
import { parseEpisodePage, parseWatchPath } from './episode-parser';

function makeDocument(html: string, title: string) {
  const document = new DOMParser().parseFromString(html, 'text/html');
  Object.defineProperty(document, 'title', { value: title, configurable: true });
  return document;
}

describe('parseWatchPath', () => {
  it('recognizes a Crunchyroll watch URL', () => {
    expect(parseWatchPath('/watch/GRQW9GW7R/the-storm-dragon-veldora')).toEqual({
      episodeId: 'GRQW9GW7R',
      slug: 'the-storm-dragon-veldora',
    });
  });

  it('rejects non-watch paths', () => {
    expect(parseWatchPath('/series/GYZJ43JMR/slime')).toBeNull();
  });
});

describe('parseEpisodePage', () => {
  it('extracts stable series, season, and episode metadata', () => {
    const document = makeDocument(
      `
        <a href="/series/GYZJ43JMR/that-time-i-got-reincarnated-as-a-slime">
          <h4>That Time I Got Reincarnated as a Slime</h4>
        </a>
        <h1>E1 - The Storm Dragon, Veldora</h1>
      `,
      'Season 1 The Storm Dragon, Veldora - Watch on Crunchyroll',
    );

    expect(
      parseEpisodePage(
        document,
        new URL('https://www.crunchyroll.com/watch/GRQW9GW7R/the-storm-dragon-veldora'),
        1719000000000,
      ),
    ).toEqual({
      seriesId: 'GYZJ43JMR',
      seriesTitle: 'That Time I Got Reincarnated as a Slime',
      seriesUrl:
        'https://www.crunchyroll.com/series/GYZJ43JMR/that-time-i-got-reincarnated-as-a-slime',
      seasonNumber: '1',
      episodeNumber: '1',
      episodeTitle: 'The Storm Dragon, Veldora',
      episodeId: 'GRQW9GW7R',
      watchUrl:
        'https://www.crunchyroll.com/watch/GRQW9GW7R/the-storm-dragon-veldora',
      updatedAt: 1719000000000,
    });
  });

  it('supports special and decimal episode labels', () => {
    const document = makeDocument(
      `
        <a href="/series/GABC12345/example-show">Example Show</a>
        <h1>E12.5 - A Special Story</h1>
      `,
      'Season 2 A Special Story - Watch on Crunchyroll',
    );

    expect(
      parseEpisodePage(
        document,
        new URL('https://www.crunchyroll.com/watch/GEP123456/a-special-story'),
        10,
      )?.episodeNumber,
    ).toBe('12.5');
  });

  it('tracks a Specials category when Crunchyroll does not provide a season number', () => {
    const document = makeDocument(
      `
        <a href="/series/GY4PD7Z06/the-quintessential-quintuplets">
          The Quintessential Quintuplets
        </a>
        <h1>E2 - No Coincidences in This Summer Break (Part 2)</h1>
      `,
      'Specials No Coincidences in This Summer Break (Part 2) - Watch on Crunchyroll',
    );

    expect(
      parseEpisodePage(
        document,
        new URL(
          'https://www.crunchyroll.com/watch/GE00347955JAJP/no-coincidences-in-this-summer-break-part-2',
        ),
        20,
      ),
    ).toMatchObject({
      seriesId: 'GY4PD7Z06',
      seasonNumber: 'Specials',
      episodeNumber: '2',
      episodeTitle: 'No Coincidences in This Summer Break (Part 2)',
    });
  });

  it('returns null until required SPA metadata has rendered', () => {
    const document = makeDocument('<main>Loading…</main>', 'Crunchyroll');

    expect(
      parseEpisodePage(
        document,
        new URL('https://www.crunchyroll.com/watch/GRQW9GW7R/the-storm-dragon-veldora'),
      ),
    ).toBeNull();
  });
});
