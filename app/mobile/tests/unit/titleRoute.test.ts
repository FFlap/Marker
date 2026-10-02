import { describe, expect, it } from 'vitest';
import { parseTitlePreview, parseTitleRoute } from '../../src/features/title/titleRoute';

describe('title route input', () => {
  it.each([-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid preview id %s', (id) => {
    expect(
      parseTitlePreview(JSON.stringify({ id, mediaType: 'tv', title: 'Title' })),
    ).toBeUndefined();
    expect(parseTitleRoute({ mediaType: 'tv', tmdbId: String(id) }).validId).toBe(false);
  });

  it('uses the same validated preview for detail and add routes', () => {
    const preview = { id: 42, mediaType: 'tv', title: 'Title', posterPath: '/poster.jpg' };
    expect(parseTitlePreview(JSON.stringify(preview))).toEqual(preview);
    expect(
      parseTitlePreview(JSON.stringify({ ...preview, posterPath: '//host/image' })),
    ).toBeUndefined();
    expect(parseTitlePreview(JSON.stringify({ ...preview, title: ' ' }))).toBeUndefined();
    expect(parseTitlePreview('null')).toBeUndefined();
  });
});
