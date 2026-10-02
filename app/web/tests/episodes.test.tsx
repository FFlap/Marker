import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FunctionReturnType } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { api } from "../../mobile/convex/_generated/api";
import type { Id } from "../../mobile/convex/_generated/dataModel";

type Overview = FunctionReturnType<typeof api.episodeHub.overview>;
const mocks = vi.hoisted(() => ({
  refresh: vi.fn<() => Promise<null>>(),
  setEpisode: vi.fn<() => Promise<null>>(),
  overview: { watching: [], favorites: [] } as Overview,
}));

vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: () => mocks.overview,
    useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
      if (getFunctionName(ref) === "episodeHub:refreshWatching") return mocks.refresh;
      return mocks.setEpisode;
    },
  };
});

import { EpisodesPage } from "@/pages/episodes";

const episode = {
  itemId: "owned-item" as Id<"items">,
  title: "Example",
  isAnime: false,
  seasonName: "Season 1",
  season: 1,
  episode: 1,
  name: "Pilot",
  tags: [],
};

afterEach(cleanup);
beforeEach(() => {
  mocks.refresh.mockReset().mockResolvedValue(null);
  mocks.setEpisode.mockReset().mockResolvedValue(null);
  mocks.overview = { watching: [], favorites: [] };
});

describe("Episodes tab refresh", () => {
  it("requests missing metadata on entry and follows reactive watched progress", async () => {
    const { rerender } = render(<EpisodesPage />);
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledWith({}));

    mocks.overview = { watching: [episode], favorites: [] };
    rerender(<EpisodesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Example episode 1 watched" }));
    await waitFor(() => expect(mocks.setEpisode).toHaveBeenCalledWith(expect.objectContaining({
      itemId: "owned-item", season: 1, episode: 1, watched: true,
    })));

    mocks.overview = { watching: [{ ...episode, episode: 2, name: "Next" }], favorites: [] };
    rerender(<EpisodesPage />);
    expect(screen.getByRole("button", { name: "Mark Example episode 2 watched" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Mark Example episode 1 watched" })).not.toBeInTheDocument();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps available episodes visible and reports a failed refresh without retrying on render", async () => {
    mocks.refresh.mockRejectedValueOnce(new Error("Unavailable"));
    mocks.overview = { watching: [episode], favorites: [] };
    const { rerender } = render(<EpisodesPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t refresh your next episodes.");
    expect(screen.getByRole("button", { name: "Mark Example episode 1 watched" })).toBeEnabled();
    rerender(<EpisodesPage />);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
