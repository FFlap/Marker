import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SeasonPage } from "@/lib/catalog";

const mocks = vi.hoisted(() => ({
  itemId: "owned-item",
  tmdbId: 1,
  touch: vi.fn<(args: Record<string, unknown>) => Promise<void>>(),
  episode: vi.fn<(args: Record<string, unknown>) => Promise<void>>(),
  mutation: vi.fn<() => Promise<void>>(),
  request: null as { state: "inFlight" | "succeeded" | "failed" } | null,
  pages: [] as SeasonPage[],
  loadMore: vi.fn<(count: number) => void>(),
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ itemId: mocks.itemId, mediaType: "tv", tmdbId: String(mocks.tmdbId) }),
  useSearch: () => ({}),
  Navigate: () => null,
  useNavigate: () => vi.fn<() => void>(),
  useRouter: () => ({ history: { canGoBack: () => false } }),
}));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === "resolvedMetadata/touch:touchItemView" || name === "resolvedMetadata/touch:touchTitle") return mocks.touch;
      if (name === "library/episodes:setEpisodeState") return mocks.episode;
      return mocks.mutation;
    },
    useAction: () => mocks.mutation,
    useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(ref);
      const title = {
        title: "Example", tmdbId: mocks.tmdbId, mediaType: "tv",
        seasons: [1, 2].map((season) => ({ season, name: `Season ${season}`, episodeCount: 2 })),
        genres: [], cast: [], episodeRunTime: [],
      };
      if (name === "resolvedMetadata/reads:getItemView") return {
        item: { _id: mocks.itemId, title: "Example", tmdbId: mocks.tmdbId, mediaType: "tv", status: "watching", tags: [], timesWatched: 0 },
        title,
      };
      if (name === "resolvedMetadata/reads:getTitleView") return { title };
      if (name === "library/items:getOwnedItemByTmdb") return null;
      if (name.endsWith("RequestState")) return mocks.request;
      if (name === "library/episodes:listEpisodes" || name === "library/episodes:listEpisodeProgress") return [];
      throw new Error(`Unexpected query: ${name}`);
    },
    usePaginatedQuery: () => ({ results: mocks.pages, status: "Exhausted", loadMore: mocks.loadMore }),
  };
});
import { ItemDetailPage } from "@/pages/item-detail";
import { TitleDetailPage } from "@/pages/title-detail";

afterEach(cleanup);
beforeEach(() => {
  mocks.itemId = "owned-item";
  mocks.tmdbId = 1;
  mocks.touch.mockReset().mockResolvedValue(undefined);
  mocks.episode.mockReset().mockResolvedValue(undefined);
  mocks.request = null;
  mocks.pages = [];
});

describe.each([
  ["library item", ItemDetailPage],
  ["catalog title", TitleDetailPage],
] as const)("%s retry scope", (_name, DetailPage) => {
  it.each(["season", "title", "leave and return"])("ignores a late retry failure after changing %s", async (change) => {
    let rejectRetry!: (error: Error) => void;
    mocks.touch.mockRejectedValueOnce(new Error("Initial failure"))
      .mockReturnValueOnce(new Promise<void>((_resolve, reject) => { rejectRetry = reject; }));
    const { rerender } = render(<DetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mocks.touch).toHaveBeenCalledTimes(2));
    if (change === "title") {
      mocks.itemId = "other-item";
      mocks.tmdbId = 2;
      rerender(<DetailPage />);
    } else {
      fireEvent.change(screen.getByRole("combobox", { name: "Season" }), { target: { value: "2" } });
      if (change === "leave and return")
        fireEvent.change(screen.getByRole("combobox", { name: "Season" }), { target: { value: "1" } });
    }
    await act(async () => { rejectRetry(new Error("Late failure")); });
    expect(screen.queryByText("Episodes couldn’t be loaded.")).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn’t retry loading episodes.")).not.toBeInTheDocument();
    expect(screen.queryByText("No episodes available")).not.toBeInTheDocument();
  });

  it("still reports a retry failure for the current season", async () => {
    mocks.touch.mockRejectedValue(new Error("Unavailable"));
    render(<DetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Episodes couldn’t be loaded.")).toBeInTheDocument();
  });

  it("ignores a superseded retry for the same season", async () => {
    let rejectRetry!: (error: Error) => void;
    mocks.request = { state: "failed" };
    mocks.touch.mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(new Promise<void>((_resolve, reject) => { rejectRetry = reject; }));
    const { rerender } = render(<DetailPage />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mocks.touch).toHaveBeenCalledTimes(3));
    mocks.request = { state: "inFlight" };
    rerender(<DetailPage />);
    await act(async () => { rejectRetry(new Error("Old retry failed")); });
    expect(screen.queryByText("Episodes couldn’t be loaded.")).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn’t retry loading episodes.")).not.toBeInTheDocument();
  });
});

describe("item detail metadata lifecycle", () => {
  it("surfaces a rejected refresh and retries it instead of showing an empty guide", async () => {
    mocks.touch.mockRejectedValueOnce(new Error("Unavailable"));
    render(<ItemDetailPage />);
    expect(screen.queryByText("No episodes available")).not.toBeInTheDocument();
    expect(await screen.findByText("Episodes couldn’t be loaded.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mocks.touch).toHaveBeenCalledWith({ itemId: "owned-item", season: 1, force: true }));
    expect(screen.queryByText("Episodes couldn’t be loaded.")).not.toBeInTheDocument();
    expect(screen.queryByText("No episodes available")).not.toBeInTheDocument();
  });

  it("keeps each episode disabled until its own watched mutation completes", async () => {
    mocks.pages = [{ season: 1, totalCount: 2, chunkIndex: 0, metadataProvider: "tmdb", orderEpoch: 1, seasonVersion: "current", episodes: [
      { season: 1, episode: 1, name: "First" }, { season: 1, episode: 2, name: "Second" },
    ] }];
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    mocks.episode.mockReturnValueOnce(new Promise<void>((resolve) => { finishFirst = resolve; })).mockReturnValueOnce(new Promise<void>((resolve) => { finishSecond = resolve; }));
    render(<ItemDetailPage />);
    const first = screen.getByRole("button", { name: "Mark episode 1 watched" });
    const second = screen.getByRole("button", { name: "Mark episode 2 watched" });
    fireEvent.click(first);
    fireEvent.click(second);
    expect(first).toBeDisabled();
    expect(second).toBeDisabled();
    await act(async () => { finishFirst(); });
    expect(first).toBeEnabled();
    expect(second).toBeDisabled();
    await act(async () => { finishSecond(); });
    expect(second).toBeEnabled();
  });
});
