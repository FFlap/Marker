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
});
