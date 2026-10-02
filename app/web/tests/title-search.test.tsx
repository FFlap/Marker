import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResult } from "@/lib/catalog";

const mocks = vi.hoisted(() => ({ search: vi.fn<(args: { query: string }) => Promise<SearchResult[]>>() }));
vi.mock("convex/react", () => ({ useAction: () => mocks.search }));
import { useTitleSearch } from "@/hooks/use-title-search";

afterEach(cleanup);
beforeEach(() => mocks.search.mockReset().mockResolvedValue([]));

function deferred() {
  let resolve!: (value: SearchResult[]) => void;
  const promise = new Promise<SearchResult[]>((done) => { resolve = done; });
  return { resolve, promise };
}

describe("title search", () => {
  it("retries the same query after a provider error", async () => {
    mocks.search.mockRejectedValueOnce(new Error("Unavailable"));
    const { result } = renderHook(() => useTitleSearch("arrival"));
    await waitFor(() => expect(result.current.error).toContain("unavailable"));
    await act(async () => { result.current.retry(); });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBe("");
  });

  it("ignores out-of-order responses and clears results for a changed query", async () => {
    const older = deferred();
    const newer = deferred();
    mocks.search.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const { result, rerender } = renderHook(({ query }) => useTitleSearch(query), { initialProps: { query: "older" } });
    rerender({ query: "newer" });
    await act(async () => { newer.resolve([{ id: 2, title: "Newer", mediaType: "tv" }]); });
    expect(result.current.results.map((entry) => entry.title)).toEqual(["Newer"]);
    await act(async () => { older.resolve([{ id: 1, title: "Older", mediaType: "tv" }]); });
    expect(result.current.results.map((entry) => entry.title)).toEqual(["Newer"]);
    rerender({ query: "" });
    expect(result.current.results).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("never submits queries outside the backend limit", async () => {
    const { result, rerender } = renderHook(({ query }) => useTitleSearch(query), { initialProps: { query: "a".repeat(101) } });
    expect(mocks.search).not.toHaveBeenCalled();
    expect(result.current.error).toContain("100 characters");
    rerender({ query: `  ${"a".repeat(100)}  ` });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mocks.search).toHaveBeenCalledWith({ query: "a".repeat(100) });
  });

  it("does not publish a result after the dialog closes", async () => {
    const request = deferred();
    mocks.search.mockReturnValue(request.promise);
    const { result, rerender } = renderHook(({ enabled }) => useTitleSearch("arrival", enabled), { initialProps: { enabled: true } });
    rerender({ enabled: false });
    await act(async () => { request.resolve([{ id: 1, title: "Arrival", mediaType: "movie" }]); });
    expect(result.current.results).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
