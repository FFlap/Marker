import { describe, expect, it } from "vitest";
import { parseTitlePreview } from "@/lib/catalog";

describe("title preview decoding", () => {
  it("retains valid preview fields and drops invalid optional metadata", () => {
    expect(parseTitlePreview(JSON.stringify({
      id: 42,
      mediaType: "tv",
      title: "Example",
      overview: "Valid overview",
      posterPath: { unexpected: "object" },
      runtime: "24",
      genres: ["Drama", 1],
    }))).toEqual({ id: 42, mediaType: "tv", title: "Example", overview: "Valid overview" });
    const preview = { id: 42, mediaType: "tv", title: "Example", runtime: 24, genres: ["Drama"] };
    expect(parseTitlePreview(JSON.stringify(preview))).toEqual(preview);
  });

  it.each([undefined, "{", "null", "[]", '{"id":1e400,"title":"Example","mediaType":"tv"}', '{"id":42,"title":{},"mediaType":"tv"}'])(
    "ignores malformed route previews: %s",
    (value) => expect(parseTitlePreview(value)).toBeUndefined(),
  );
});
