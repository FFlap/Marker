const DEV_CONVEX_URL = "https://valuable-minnow-297.convex.cloud";
const DEV_WEBSITE_URL = "http://localhost:4173";
const DEV_CLERK_PUBLISHABLE_KEY =
  "pk_test_d2FybS10ZXJtaXRlLTE2LmNsZXJrLmFjY291bnRzLmRldiQ";

type BuildEnvironment = Record<string, string | undefined>;

function configuredValue(
  environment: BuildEnvironment,
  name: string,
  isDevelopment: boolean,
  developmentFallback: string,
) {
  const value = environment[name]?.trim();
  if (value) return value;
  if (isDevelopment) return developmentFallback;
  throw new Error(`${name} is required for production extension builds`);
}

function configuredOrigin(name: string, value: string, isDevelopment: boolean) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL origin`);
  }
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (!isDevelopment && url.protocol !== "https:") ||
    (isDevelopment && url.protocol !== "https:" && url.protocol !== "http:")
  ) {
    throw new Error(
      `${name} must be an absolute ${isDevelopment ? "HTTP(S)" : "HTTPS"} origin`,
    );
  }
  return url.origin;
}

function clerkOrigin(publishableKey: string) {
  const match = /^pk_(?:test|live)_([A-Za-z0-9_-]+)$/u.exec(publishableKey);
  const encoded = match?.[1];
  if (!encoded) {
    throw new Error(
      "WXT_CLERK_PUBLISHABLE_KEY does not contain a valid Clerk frontend host",
    );
  }
  const decoded = Buffer.from(encoded, "base64url").toString("utf8");
  const canonical = Buffer.from(decoded, "utf8").toString("base64url");
  const hostname = decoded.endsWith("$") ? decoded.slice(0, -1) : "";
  const hostnamePattern =
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
  if (canonical !== encoded || !hostnamePattern.test(hostname)) {
    throw new Error(
      "WXT_CLERK_PUBLISHABLE_KEY does not contain a valid Clerk frontend host",
    );
  }
  return new URL(`https://${hostname}`).origin;
}

const originPattern = (origin: string) => `${origin}/*`;

export function resolveExtensionBuild(
  mode: string,
  environment: BuildEnvironment,
) {
  const isDevelopment = mode === "development";
  const convexOrigin = configuredOrigin(
    "WXT_CONVEX_URL",
    configuredValue(
      environment,
      "WXT_CONVEX_URL",
      isDevelopment,
      DEV_CONVEX_URL,
    ),
    isDevelopment,
  );
  const convexUrl = new URL(convexOrigin);
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.convex\.cloud$/u.test(convexUrl.hostname)) {
    throw new Error(
      "WXT_CONVEX_URL must use an exact .convex.cloud deployment origin",
    );
  }
  const convexSiteUrl = new URL(convexOrigin);
  convexSiteUrl.hostname = convexUrl.hostname.replace(
    /\.convex\.cloud$/u,
    ".convex.site",
  );
  const convexSiteOrigin = convexSiteUrl.origin;
  const websiteOrigin = configuredOrigin(
    "WXT_WEBSITE_URL",
    configuredValue(
      environment,
      "WXT_WEBSITE_URL",
      isDevelopment,
      DEV_WEBSITE_URL,
    ),
    isDevelopment,
  );
  const syncHostValue =
    environment.WXT_CLERK_SYNC_HOST?.trim() || websiteOrigin;
  const syncHostOrigin = configuredOrigin(
    "WXT_CLERK_SYNC_HOST",
    syncHostValue,
    isDevelopment,
  );
  const publishableKey = configuredValue(
    environment,
    "WXT_CLERK_PUBLISHABLE_KEY",
    isDevelopment,
    DEV_CLERK_PUBLISHABLE_KEY,
  );

  const hostPermissions = [...new Set([
    "https://www.crunchyroll.com/*",
    "https://www.netflix.com/*",
    originPattern(convexOrigin),
    originPattern(convexSiteOrigin),
    originPattern(clerkOrigin(publishableKey)),
    originPattern(websiteOrigin),
    originPattern(syncHostOrigin),
    ...(isDevelopment ? ["http://localhost/*", "http://127.0.0.1/*"] : []),
  ])];

  return {
    convexOrigin,
    convexSiteOrigin,
    websiteOrigin,
    syncHostOrigin,
    publishableKey,
    hostPermissions,
  };
}
