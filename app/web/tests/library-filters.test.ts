import { describe, expect, it } from "vitest";
import { filterLibraryItems, uniqueTags, type LibraryFilters } from "@/lib/library-filters";

describe("library media filters", () => {
  const defaults: LibraryFilters = { media: "all", minimum: 0, status: "all", tags: [] };
  const animeSeries = { title: "Anime show", status: "watching" as const, mediaType: "tv" as const, isAnime: true };
  const liveActionSeries = { ...animeSeries, title: "Live action show", isAnime: false };
  const animeMovie = { ...animeSeries, title: "Anime movie", mediaType: "movie" as const };
  const liveActionMovie = { ...animeMovie, title: "Live action movie", isAnime: false };
  const items = [animeSeries, liveActionSeries, animeMovie, liveActionMovie];

  it("keeps anime separate from movie and TV filters", () => {
    expect(filterLibraryItems(items, { ...defaults, media: "anime" }, "")).toEqual([animeSeries, animeMovie]);
  });

  it("matches non-anime movies and TV shows normally", () => {
    expect(filterLibraryItems(items, defaults, "")).toEqual(items);
    expect(filterLibraryItems(items, { ...defaults, media: "movie" }, "")).toEqual([liveActionMovie]);
    expect(filterLibraryItems(items, { ...defaults, media: "tv" }, "")).toEqual([liveActionSeries]);
  });
});


describe("library filters", () => {
  const items = [
    { title: "Arrival", mediaType: "movie" as const, isAnime: false, status: "watched" as const, rating: 4, tags: ["Sci-Fi", "Favorites"] },
    { title: "Dune", mediaType: "movie" as const, isAnime: false, status: "watchlist" as const, tags: ["sci-fi"] },
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
