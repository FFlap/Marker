import { describe, expect, it } from 'vitest';
import { parseNetflixPage, parseNetflixWatchPath } from './netflix-parser';

function makeDocument(html: string) {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('parseNetflixWatchPath', () => {
  it('recognizes a Netflix watch URL', () => {
    expect(parseNetflixWatchPath('/watch/81295950')).toEqual({
      videoId: '81295950',
    });
  });

  it('rejects non-watch URLs', () => {
    expect(parseNetflixWatchPath('/browse')).toBeNull();
  });
});

describe('parseNetflixPage', () => {
  it('extracts a series episode from stable player metadata', () => {
    const document = makeDocument(`
      <script>
        window.netflix = window.netflix || {};
        netflix.falcorCache = {
          "videos": {
            "81295950": {
              "summary": {
                "\\x24type": "atom",
                "value": {
                  "type": "episode",
                  "id": 81295950,
                  "episode": 1,
                  "season": 9
                }
              }
            }
          }
        };
      </script>
      <div data-uia="watch-video">
        <div data-uia="video-title">
          <h4>SpongeBob SquarePants</h4>
          <span>E1</span>
          <span>Extreme Spots/Squirrel Record</span>
        </div>
        <button data-uia="control-episodes" aria-label="Episodes"></button>
      </div>
    `);

    expect(
      parseNetflixPage(
        document,
        new URL('https://www.netflix.com/watch/81295950?trackId=1'),
        100,
      ),
    ).toEqual({
      platform: 'netflix',
      seriesId: 'spongebob-squarepants',
      seriesTitle: 'SpongeBob SquarePants',
      seriesUrl: 'https://www.netflix.com/title/81295950',
      seasonNumber: '9',
      episodeNumber: '1',
      episodeTitle: 'Extreme Spots/Squirrel Record',
      episodeId: '81295950',
      watchUrl: 'https://www.netflix.com/watch/81295950',
      updatedAt: 100,
    });
  });

  it('returns null while autoplay has changed the URL but the title is still stale', () => {
    const document = makeDocument(`
      <script>
        netflix.falcorCache = {
          "videos": {
            "111": {
              "summary": {
                "value": { "type": "episode", "episode": 2, "season": 1 }
              }
            }
          }
        };
      </script>
      <div data-uia="video-title" data-video-id="111">
        <h4>Example Show</h4><span>E2</span><span>Old Episode</span>
      </div>
    `);

    expect(
      parseNetflixPage(document, new URL('https://www.netflix.com/watch/222')),
    ).toBeNull();
  });

  it('returns null until the embedded cache contains the current watch ID', () => {
    const document = makeDocument(`
      <script>
        netflix.falcorCache = {
          "videos": {
            "111": {
              "summary": {
                "value": { "type": "episode", "episode": 2, "season": 1 }
              }
            }
          }
        };
      </script>
      <div data-uia="video-title">
        <h4>Example Show</h4><span>E3</span><span>New Episode</span>
      </div>
    `);

    expect(
      parseNetflixPage(document, new URL('https://www.netflix.com/watch/222')),
    ).toBeNull();
  });

  it('uses the visible episode when bridged metadata is stale after a transition', () => {
    const document = makeDocument(`
      <html data-netflix-video-summary='{"type":"episode","id":111,"episode":2,"season":1}'>
        <body>
          <div data-uia="video-title">
            <h4>Example Show</h4><span>E3</span><span>New Episode</span>
          </div>
        </body>
      </html>
    `);

    expect(
      parseNetflixPage(document, new URL('https://www.netflix.com/watch/222')),
    ).toMatchObject({
      platform: 'netflix',
      seriesId: 'example-show',
      seriesTitle: 'Example Show',
      seasonNumber: '1',
      episodeNumber: '3',
      episodeTitle: 'New Episode',
      episodeId: '222',
      watchUrl: 'https://www.netflix.com/watch/222',
    });
  });

  it('supports movies without season or episode labels', () => {
    const document = makeDocument(`
      <script>
        netflix.falcorCache = {
          "videos": {
            "999": {
              "summary": {
                "value": { "type": "movie", "id": 999 }
              }
            }
          }
        };
      </script>
      <div data-uia="video-title">
        <h4>Example Movie</h4>
      </div>
    `);

    expect(
      parseNetflixPage(
        document,
        new URL('https://www.netflix.com/watch/999'),
        200,
      ),
    ).toMatchObject({
      platform: 'netflix',
      seriesTitle: 'Example Movie',
      seasonNumber: 'Movie',
      episodeNumber: '1',
      episodeTitle: 'Example Movie',
    });
  });

  it('extracts a movie title from the Netflix movie player heading', () => {
    const document = makeDocument(`
      <script>
        netflix.falcorCache = {
          "videos": {
            "81776693": {
              "summary": {
                "value": { "type": "movie", "id": 81776693 }
              }
            }
          }
        };
      </script>
      <div>
        <div>You're watching</div>
        <h2>Despicable Me 4</h2>
        <h3>2024 PG 1h 34m</h3>
      </div>
    `);

    expect(
      parseNetflixPage(
        document,
        new URL('https://www.netflix.com/watch/81776693?trackId=1'),
        300,
      ),
    ).toMatchObject({
      platform: 'netflix',
      seriesId: 'despicable-me-4',
      seriesTitle: 'Despicable Me 4',
      seasonNumber: 'Movie',
      episodeNumber: '1',
      episodeTitle: 'Despicable Me 4',
      episodeId: '81776693',
      watchUrl: 'https://www.netflix.com/watch/81776693',
    });
  });
});
