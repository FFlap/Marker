import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAuditCommandFailure } from "./audit-report.mjs";

describe("production audit report handling", () => {
  it("rejects a signal-terminated audit even when stdout is valid JSON", () => {
    assert.equal(
      isAuditCommandFailure(null, {
        vulnerabilities: {},
        metadata: { vulnerabilities: {} },
      }),
      true,
    );
  });

  it("rejects a parseable endpoint error returned with a failing status", () => {
    assert.equal(
      isAuditCommandFailure(1, {
        message: "audit endpoint returned an error",
        statusCode: 503,
        body: { error: "service unavailable" },
      }),
      true,
    );
  });

  it("accepts a normal vulnerability report returned with a failing status", () => {
    assert.equal(
      isAuditCommandFailure(1, {
        vulnerabilities: { package: { via: [] } },
        metadata: { vulnerabilities: { high: 1, critical: 0 } },
      }),
      false,
    );
  });
});
