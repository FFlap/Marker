import { describe, expect, it } from "vitest";
import { resolveExtensionBuild } from "./build-config";

const liveKey = "pk_live_Y2xlcmsubWFya2VyLmV4YW1wbGUuY29tJA";
const productionEnvironment = {
  WXT_CONVEX_URL: "https://marker-production.convex.cloud",
  WXT_WEBSITE_URL: "https://marker.example.com",
  WXT_CLERK_PUBLISHABLE_KEY: liveKey,
};

describe("extension build configuration", () => {
  it.each(["WXT_CONVEX_URL", "WXT_WEBSITE_URL", "WXT_CLERK_PUBLISHABLE_KEY"])(
    "requires %s in production",
    (name) => {
      expect(() =>
        resolveExtensionBuild("production", {
          ...productionEnvironment,
          [name]: undefined,
        }),
      ).toThrow(`${name} is required for production extension builds`);
    },
  );

  it("pins production permissions to configured origins", () => {
    const result = resolveExtensionBuild("production", productionEnvironment);
    expect(result.hostPermissions).toEqual([
      "https://www.crunchyroll.com/*",
      "https://www.netflix.com/*",
      "https://marker-production.convex.cloud/*",
      "https://marker-production.convex.site/*",
      "https://clerk.marker.example.com/*",
      "https://marker.example.com/*",
    ]);
    expect(result.hostPermissions.join(" ")).not.toMatch(
      /localhost|\*\.convex/u,
    );
  });

  it("allows development-only local and test defaults", () => {
    const result = resolveExtensionBuild("development", {});
    expect(result.publishableKey).toMatch(/^pk_test_/u);
    expect(result.websiteOrigin).toBe("http://localhost:4173");
    expect(result.hostPermissions).toContain("http://localhost/*");
  });

  it("normalizes Convex trailing slashes and preserves explicit ports", () => {
    const result = resolveExtensionBuild("production", {
      ...productionEnvironment,
      WXT_CONVEX_URL: "https://marker-production.convex.cloud:8443/",
    });
    expect(result.convexOrigin).toBe(
      "https://marker-production.convex.cloud:8443",
    );
    expect(result.convexSiteOrigin).toBe(
      "https://marker-production.convex.site:8443",
    );
  });

  it("adds a distinct Clerk sync host to permissions", () => {
    const result = resolveExtensionBuild("production", {
      ...productionEnvironment,
      WXT_CLERK_SYNC_HOST: "https://accounts.marker.example.com",
    });
    expect(result.syncHostOrigin).toBe(
      "https://accounts.marker.example.com",
    );
    expect(result.hostPermissions).toContain(
      "https://accounts.marker.example.com/*",
    );
  });

  it("rejects a Convex URL outside an exact deployment hostname", () => {
    expect(() =>
      resolveExtensionBuild("production", {
        ...productionEnvironment,
        WXT_CONVEX_URL: "https://evil-convex.cloud",
      }),
    ).toThrow("WXT_CONVEX_URL must use an exact .convex.cloud deployment origin");
  });

  it("rejects non-HTTPS production origins", () => {
    expect(() =>
      resolveExtensionBuild("production", {
        ...productionEnvironment,
        WXT_WEBSITE_URL: "http://marker.example.com",
      }),
    ).toThrow("WXT_WEBSITE_URL must be an absolute HTTPS origin");
  });

  it.each([
    "not-a-key",
    "pk_live_@@@",
    `pk_live_${Buffer.from("user@marker.example.com$").toString("base64url")}`,
    `pk_live_${Buffer.from("marker.example.com?admin=true$").toString("base64url")}`,
  ])("rejects a malformed Clerk key: %s", (publishableKey) => {
    expect(() =>
      resolveExtensionBuild("production", {
        ...productionEnvironment,
        WXT_CLERK_PUBLISHABLE_KEY: publishableKey,
      }),
    ).toThrow(
      "WXT_CLERK_PUBLISHABLE_KEY does not contain a valid Clerk frontend host",
    );
  });
});
