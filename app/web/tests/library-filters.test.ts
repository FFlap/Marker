import { describe, expect, it } from "vitest";
import { filterLibraryItems, matchesMediaType, uniqueTags } from "@/lib/library-filters";

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
    expect(matchesMediaType(animeSeries, "all")).toBe(true);
    expect(matchesMediaType(liveActionMovie, "all")).toBe(true);
    expect(matchesMediaType(liveActionSeries, "tv")).toBe(true);
    expect(matchesMediaType(liveActionSeries, "movie")).toBe(false);
    expect(matchesMediaType(liveActionMovie, "movie")).toBe(true);
  });
});


describe("library filters", () => {
  const items = [
    { title: "Arrival", mediaType: "movie" as const, status: "watched" as const, rating: 4, tags: ["Sci-Fi", "Favorites"] },
    { title: "Dune", mediaType: "movie" as const, status: "watchlist" as const, tags: ["sci-fi"] },
  ];

  it("matches canonical tags across differing display capitalization and spaces", () => {
    const filtered = filterLibraryItems(items, { media: "all", status: "all", minimum: 0, tags: ["  SCI-FI  "] }, "");
    expect(filtered.map((item) => item.title)).toEqual(["Arrival", "Dune"]);
    expect(uniqueTags(items.flatMap((item) => item.tags))).toHaveLength(2);
  });

  it("combines title, status, rating and all selected tags", () => {
    expect(filterLibraryItems(items, { media: "movie", status: "watched", minimum: 4, tags: ["sci-fi", "favorites"] }, "  ARR  ").map((item) => item.title)).toEqual(["Arrival"]);
    expect(filterLibraryItems(items, { media: "all", status: "all", minimum: 1, tags: [] }, "dune")).toEqual([]);
  });
});
