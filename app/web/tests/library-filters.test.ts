import { describe, expect, it } from "vitest";
import { matchesMediaType } from "@/lib/library-filters";

describe("matchesMediaType", () => {
  const animeSeries = { mediaType: "tv" as const, isAnime: true };
  const liveActionSeries = { mediaType: "tv" as const, isAnime: false };
  const animeMovie = { mediaType: "movie" as const, isAnime: true };
  const liveActionMovie = { mediaType: "movie" as const, isAnime: false };

  it("keeps anime separate from movie and TV filters", () => {
    expect(matchesMediaType(animeSeries, "anime")).toBe(true);
    expect(matchesMediaType(animeMovie, "anime")).toBe(true);
    expect(matchesMediaType(animeSeries, "tv")).toBe(false);
    expect(matchesMediaType(animeMovie, "movie")).toBe(false);
  });

  it("matches non-anime movies and TV shows normally", () => {
    expect(matchesMediaType(liveActionSeries, "tv")).toBe(true);
    expect(matchesMediaType(liveActionMovie, "movie")).toBe(true);
  });
});
