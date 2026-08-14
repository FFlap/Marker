import { describe, expect, it } from 'vitest';
import { getConvexSiteUrl } from '../../src/lib/convexUrl';

describe('getConvexSiteUrl', () => {
  it('prefers an explicit site URL override', () => {
    expect(
      getConvexSiteUrl({
        siteUrl: ' https://uploads.example.com ',
        convexUrl: 'https://marker.convex.cloud',
      }),
    ).toBe('https://uploads.example.com');
  });

  it('normalizes an explicit site URL to a safe HTTP origin', () => {
    expect(getConvexSiteUrl({ siteUrl: 'https://uploads.example.com/avatar/path?draft=1' })).toBe(
      'https://uploads.example.com',
    );
    expect(getConvexSiteUrl({ siteUrl: 'ftp://uploads.example.com' })).toBeUndefined();
    expect(getConvexSiteUrl({ siteUrl: 'not a URL' })).toBeUndefined();
  });

  it('derives the HTTP actions origin from a Convex cloud URL', () => {
    expect(
      getConvexSiteUrl({
        siteUrl: '',
        convexUrl: 'https://marker.convex.cloud',
      }),
    ).toBe('https://marker.convex.site');
  });

  it.each([undefined, '', 'not a URL', 'https://convex.example.com'])(
    'returns undefined when the deployment URL cannot be derived: %s',
    (convexUrl) => {
      expect(getConvexSiteUrl({ siteUrl: '', convexUrl })).toBeUndefined();
    },
  );
});
