import { describe, expect, it } from "vitest";
import { isAuditCommandFailure } from "./audit-report.mjs";

describe("production audit report handling", () => {
  it("rejects a signal-terminated audit even when stdout is valid JSON", () => {
    expect(
      isAuditCommandFailure(null, {
        vulnerabilities: {},
        metadata: { vulnerabilities: {} },
      }),
    ).toBe(true);
  });

  it("rejects a parseable endpoint error returned with a failing status", () => {
    expect(
      isAuditCommandFailure(1, {
        message: "audit endpoint returned an error",
        statusCode: 503,
        body: { error: "service unavailable" },
      }),
    ).toBe(true);
  });

  it("accepts a normal vulnerability report returned with a failing status", () => {
    expect(
      isAuditCommandFailure(1, {
        vulnerabilities: { package: { via: [] } },
        metadata: { vulnerabilities: { high: 1, critical: 0 } },
      }),
    ).toBe(false);
  });
});
