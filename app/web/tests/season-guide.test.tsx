import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SeasonPage } from "@/lib/catalog";

const mocks = vi.hoisted(() => ({
  request: null as { state: "inFlight" | "succeeded" | "failed" | "notFound" } | null,
  pages: [] as (SeasonPage & { seasonVersion?: string })[],
  query: vi.fn<(args: unknown) => void>(),
  loadMore: vi.fn<(count: number) => void>(),
}));
vi.mock("convex/react", () => ({
  useQuery: () => mocks.request,
  usePaginatedQuery: (_ref: unknown, args: unknown) => {
    mocks.query(args);
    return { results: mocks.pages, status: "Exhausted", loadMore: mocks.loadMore };
  },
}));
import { useSeasonGuide } from "@/hooks/use-season-guide";

afterEach(cleanup);
beforeEach(() => { mocks.request = null; mocks.pages = []; mocks.query.mockClear(); });
const seasons = [
  { season: 0, name: "Specials", episodeCount: 1 },
  { season: 1, name: "Season 1", episodeCount: 2 },
  { season: 3, name: "Season 3", episodeCount: 1 },
];
const chunk = (chunkIndex: number, name: string, extra = {}) => ({
  season: 1, totalCount: 4, chunkIndex, metadataProvider: "tmdb" as const,
  orderEpoch: 2, seasonVersion: "current", ...extra,
  episodes: [{ season: 1, episode: chunkIndex + 1, name }],
});

describe("season guide", () => {
  it("ignores repeated and mismatched chunks during a refresh and waits for gaps", () => {
    mocks.pages = [
      chunk(0, "Current first"),
      chunk(0, "Duplicate first"),
      chunk(1, "Old epoch", { orderEpoch: 1 }),
      chunk(1, "Old provider", { metadataProvider: "tvdb" }),
      chunk(1, "Old version", { seasonVersion: "previous" }),
      chunk(1, "Old count", { totalCount: 3 }),
      chunk(2, "Current third"),
    ];
    const { result, rerender } = renderHook(() => useSeasonGuide({ mediaType: "tv", tmdbId: 1, title: { seasons } }));
    expect(result.current.episodes.map((episode) => episode.name)).toEqual(["Current first"]);
    expect(result.current.loadedPageCount).toBe(1);
    mocks.pages = [...mocks.pages, chunk(1, "Current second")];
    rerender();
    expect(result.current.episodes.map((episode) => episode.name)).toEqual(["Current first", "Current second", "Current third"]);
    expect(result.current.loadedPageCount).toBe(3);
  });

  it("waits for a queued refresh even when the cache query is exhausted", () => {
    const { result, rerender } = renderHook(() => useSeasonGuide({ mediaType: "tv", tmdbId: 1, title: { seasons } }));
    expect(result.current.loading).toBe(true);
    mocks.request = { state: "inFlight" };
    rerender();
    expect(result.current.loading).toBe(true);
    mocks.request = { state: "succeeded" };
    mocks.pages = [{ season: 1, totalCount: 0, chunkIndex: 0, metadataProvider: "tmdb", orderEpoch: 1, episodes: [] }];
    rerender();
    expect(result.current.loading).toBe(false);
    expect(result.current.failed).toBe(false);
    expect(result.current.episodes).toEqual([]);
  });

  it("keeps the chosen season within one title, then resets on navigation", () => {
    const { result, rerender } = renderHook(({ tmdbId }) => useSeasonGuide({ mediaType: "tv", tmdbId, title: { seasons } }), { initialProps: { tmdbId: 1 } });
    void act(() => result.current.setSeason(3));
    expect(result.current.season).toBe(3);
    rerender({ tmdbId: 2 });
    expect(result.current.season).toBe(1);
    expect(mocks.query).toHaveBeenLastCalledWith({ tmdbId: 2, season: 1 });
    void act(() => result.current.setSeason(0));
    expect(result.current.season).toBe(0);
  });

  it("keeps a season selectable when its episode count could not be verified", () => {
    const { result } = renderHook(() => useSeasonGuide({ mediaType: "tv", tmdbId: 1, title: { seasons: [{ season: 2, name: "Unknown count", episodeCount: 0, episodeCountVerified: false }] } }));
    expect(result.current.season).toBe(2);
    expect(result.current.seasons.map((entry) => entry.season)).toEqual([2]);
  });

  it("allows a failed touch to exit loading without hiding cached episodes", () => {
    const { result, rerender } = renderHook(() => useSeasonGuide({ mediaType: "tv", tmdbId: 1, title: { seasons }, refreshError: true }));
    expect(result.current.failed).toBe(true);
    expect(result.current.loading).toBe(false);
    mocks.pages = [{ season: 1, totalCount: 1, chunkIndex: 0, metadataProvider: "tmdb", orderEpoch: 1, episodes: [{ season: 1, episode: 1, name: "Pilot" }] }];
    rerender();
    expect(result.current.failed).toBe(false);
    expect(result.current.episodes[0]?.name).toBe("Pilot");
  });
});
