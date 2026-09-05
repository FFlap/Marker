import { describe, expect, it } from "vitest";
import { convexSiteOrigin } from "./config";

describe("extension runtime configuration", () => {
  it("normalizes trailing slashes and preserves explicit ports", () => {
    expect(
      convexSiteOrigin("https://marker.convex.cloud:8443/"),
    ).toBe("https://marker.convex.site:8443");
  });
});
