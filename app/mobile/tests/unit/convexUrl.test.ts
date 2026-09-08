import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConvexSiteUrl } from '../../src/lib/convexUrl';

describe('getConvexSiteUrl', () => {
  afterEach(() => vi.unstubAllGlobals());
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

  it.each([false, true])('rejects cleartext remote hosts with development=%s', (development) => {
    vi.stubGlobal('__DEV__', development);
    for (const siteUrl of [
      'http://uploads.example.com',
      'http://localhost.example.com',
      'http://192.168.1.2',
    ]) {
      expect(getConvexSiteUrl({ siteUrl })).toBeUndefined();
    }
    expect(
      getConvexSiteUrl({ siteUrl: '', convexUrl: 'http://marker.convex.cloud' }),
    ).toBeUndefined();
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])('allows HTTP %s only in development', (host) => {
    const siteUrl = `http://${host}:3211`;
    vi.stubGlobal('__DEV__', false);
    expect(getConvexSiteUrl({ siteUrl })).toBeUndefined();
    vi.stubGlobal('__DEV__', true);
    expect(getConvexSiteUrl({ siteUrl })).toBe(siteUrl);
  });
});
