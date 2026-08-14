type ConvexUrlOptions = {
  siteUrl?: string;
  convexUrl?: string;
};

export function getConvexSiteUrl({
  siteUrl = process.env.EXPO_PUBLIC_CONVEX_SITE_URL,
  convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL,
}: ConvexUrlOptions = {}) {
  const override = siteUrl?.trim();
  if (override) {
    try {
      const url = new URL(override);
      return /^https?:$/.test(url.protocol) ? url.origin : undefined;
    } catch {
      return undefined;
    }
  }

  const deploymentUrl = convexUrl?.trim();
  if (!deploymentUrl) return undefined;

  try {
    const url = new URL(deploymentUrl);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.endsWith('.convex.cloud')) {
      return undefined;
    }
    url.hostname = url.hostname.replace(/\.convex\.cloud$/, '.convex.site');
    return url.origin;
  } catch {
    return undefined;
  }
}
