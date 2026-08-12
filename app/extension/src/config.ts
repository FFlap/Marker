const CHECKED_IN_CONVEX_URL = "https://valuable-minnow-297.convex.cloud";
const CHECKED_IN_CLERK_PUBLISHABLE_KEY =
  "pk_test_d2FybS10ZXJtaXRlLTE2LmNsZXJrLmFjY291bnRzLmRldiQ";

/** Pinned when the extension bundle is built; never sourced from runtime storage. */
const requiredBuildValue = (
  name: string,
  value: string | undefined,
  developmentFallback: string,
) => {
  if (value) return value;
  if (import.meta.env.DEV) return developmentFallback;
  throw new Error(`${name} is required in production extension bundles`);
};

const CONVEX_URL = requiredBuildValue(
  "WXT_CONVEX_URL",
  import.meta.env.WXT_CONVEX_URL,
  CHECKED_IN_CONVEX_URL,
);
export const CONVEX_SITE_URL = CONVEX_URL.replace(
  /\.convex\.cloud$/u,
  ".convex.site",
);
export const CLERK_PUBLISHABLE_KEY = requiredBuildValue(
  "WXT_CLERK_PUBLISHABLE_KEY",
  import.meta.env.WXT_CLERK_PUBLISHABLE_KEY,
  CHECKED_IN_CLERK_PUBLISHABLE_KEY,
);
export const WEBSITE_URL = requiredBuildValue(
  "WXT_WEBSITE_URL",
  import.meta.env.WXT_WEBSITE_URL,
  "http://localhost:4173",
);
export const CLERK_SYNC_HOST =
  import.meta.env.WXT_CLERK_SYNC_HOST || WEBSITE_URL;
