import { describe, expect, it } from "vitest";
import { transitionAccount } from "./sync-lifecycle";
import { transitionInspection } from "./tracking";

describe("extension ownership transitions", () => {
  it("keeps session lookups blocked until every overlapping sign-out settles", () => {
    const first = transitionAccount(
      { state: "available", revision: 0 },
      "signOut",
    );
    const second = transitionAccount(first, "signOut");
    const settling = transitionAccount(second, "signedOut");
    expect(settling).toEqual({ state: "signingOut", pending: 1, revision: 3 });
    expect(transitionAccount(settling, "signedOut")).toEqual({
      state: "available",
      revision: 4,
    });
  });
  it("retains one deferred inspection while saving and resets deduplication on navigation", () => {
    const saving = transitionInspection(
      { state: "tracked", lastEpisode: "old" },
      { type: "save" },
    );
    const repeated = transitionInspection(saving, { type: "inspect" });
    expect(transitionInspection(repeated, { type: "navigate" })).toEqual({
      state: "saving",
      lastEpisode: null,
      inspectAgain: true,
    });
    expect(transitionInspection(repeated, { type: "failed" })).toEqual({
      state: "error",
      lastEpisode: "old",
    });
  });
});
