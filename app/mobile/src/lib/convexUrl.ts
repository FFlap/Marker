type ConvexUrlOptions = {
  siteUrl?: string;
  convexUrl?: string;
};

export function getConvexSiteUrl({
  siteUrl = process.env.EXPO_PUBLIC_CONVEX_SITE_URL,
  convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL,
}: ConvexUrlOptions = {}) {
  const override = siteUrl?.trim();
  const source = override || convexUrl?.trim();
  if (!source) return undefined;

  try {
    const url = new URL(source);
    if (!override) {
      if (!url.hostname.endsWith('.convex.cloud')) return undefined;
      url.hostname = url.hostname.replace(/\.convex\.cloud$/, '.convex.site');
    }
    const localDevelopment =
      typeof __DEV__ !== 'undefined' &&
      __DEV__ &&
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return url.protocol === 'https:' || localDevelopment ? url.origin : undefined;
  } catch {
    return undefined;
  }
}
