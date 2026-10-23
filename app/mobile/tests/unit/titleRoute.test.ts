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

  it.each([
    { originalTitle: { text: 'Title' } },
    { voteAverage: '8.5' },
    { voteAverage: { value: 8.5 } },
    { posterPath: '/folder/../poster.jpg' },
    { posterPath: '/../poster.jpg' },
    { posterPath: '/folder/..' },
    { mediaType: 'person' },
  ])('rejects malformed preview fields %j', (invalid) => {
    expect(
      parseTitlePreview(
        JSON.stringify({
          id: 42,
          mediaType: 'tv',
          title: 'Title',
          ...invalid,
        }),
      ),
    ).toBeUndefined();
  });

  it('preserves validated preview metadata and discards unknown fields', () => {
    const preview = {
      id: 42,
      mediaType: 'tv',
      title: ' Title ',
      originalTitle: 'Original title',
      posterPath: '/folder/poster..jpg',
      overview: 'Overview',
      releaseDate: '2026-01-01',
      voteAverage: 8.5,
    };
    expect(parseTitlePreview(JSON.stringify({ ...preview, untrusted: { nested: true } }))).toEqual(
      preview,
    );
  });

  it.each([undefined, '', ' ', 'null', '{}', '[]', '{invalid'])(
    'ignores an invalid preview %s',
    (value) => {
      expect(parseTitlePreview(value)).toBeUndefined();
    },
  );

  it.each([undefined, '', ' ', 'NaN', 'Infinity', '42x'])(
    'rejects an invalid route id %s',
    (tmdbId) => {
      expect(parseTitleRoute({ mediaType: 'tv', tmdbId })).toMatchObject({
        validId: false,
        routeKey: 'tv:invalid',
      });
    },
  );

  it('decodes route parameters into their existing canonical key', () => {
    expect(parseTitleRoute({ mediaType: 'tv', tmdbId: ' 0042 ' })).toEqual({
      mediaType: 'tv',
      tmdbId: 42,
      validId: true,
      routeKey: 'tv:42',
    });
    expect(parseTitleRoute({ mediaType: 'person', tmdbId: '42' }).mediaType).toBeUndefined();
  });
});
