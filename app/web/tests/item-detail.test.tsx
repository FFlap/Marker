import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SeasonPage } from "@/lib/catalog";

const mocks = vi.hoisted(() => ({
  touch: vi.fn<(args: Record<string, unknown>) => Promise<void>>(),
  episode: vi.fn<(args: Record<string, unknown>) => Promise<void>>(),
  mutation: vi.fn<() => Promise<void>>(),
  request: null as { state: "inFlight" | "succeeded" | "failed" } | null,
  pages: [] as SeasonPage[],
  loadMore: vi.fn<(count: number) => void>(),
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ itemId: "owned-item" }),
  useNavigate: () => vi.fn<() => void>(),
  useRouter: () => ({ history: { canGoBack: () => false } }),
}));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref);
      if (name === "resolvedMetadata/touch:touchItemView") return mocks.touch;
      if (name === "library/episodes:setEpisodeState") return mocks.episode;
      return mocks.mutation;
    },
    useAction: () => mocks.mutation,
    useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
      if (args === "skip") return undefined;
      const name = getFunctionName(ref);
      if (name === "resolvedMetadata/reads:getItemView") return {
        item: { _id: "owned-item", title: "Example", tmdbId: 1, mediaType: "tv", status: "watching", tags: [], timesWatched: 0 },
        title: { title: "Example", seasons: [{ season: 1, name: "Season 1", episodeCount: 2 }], genres: [], cast: [], episodeRunTime: [] },
      };
      if (name.endsWith("RequestState")) return mocks.request;
      if (name === "library/episodes:listEpisodes" || name === "library/episodes:listEpisodeProgress") return [];
      throw new Error(`Unexpected query: ${name}`);
    },
    usePaginatedQuery: () => ({ results: mocks.pages, status: "Exhausted", loadMore: mocks.loadMore }),
  };
});
import { ItemDetailPage } from "@/pages/item-detail";

afterEach(cleanup);
beforeEach(() => {
  mocks.touch.mockReset().mockResolvedValue(undefined);
  mocks.episode.mockReset().mockResolvedValue(undefined);
  mocks.request = null;
  mocks.pages = [];
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
    mocks.pages = [{ season: 1, totalCount: 2, chunkIndex: 0, metadataProvider: "tmdb", orderEpoch: 1, episodes: [
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
