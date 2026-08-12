import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addItem: vi.fn<(args: Record<string, unknown>) => Promise<string>>(),
  addItemAndMarkWatched:
    vi.fn<(args: Record<string, unknown>) => Promise<string>>(),
  searchTitles: vi.fn<(args: { query: string }) => Promise<unknown[]>>(),
  touchTitle: vi.fn<(args: Record<string, unknown>) => Promise<void>>(),
}));

vi.mock("convex/react", () => ({
  useAction: (ref: string) =>
    ref === "library.addItemAndMarkWatched"
      ? mocks.addItemAndMarkWatched
      : mocks.searchTitles,
  useMutation: (ref: string) =>
    ref === "library.addItem" ? mocks.addItem : mocks.touchTitle,
  useQuery: (ref: string) =>
    ref === "resolvedMetadata.getTitle"
      ? { genres: ["Animation"], episodeRunTime: [24] }
      : [],
}));

vi.mock("../../mobile/convex/_generated/api", () => ({
  api: {
    library: {
      addItem: "library.addItem",
      listTagSuggestions: "library.listTagSuggestions",
      addItemAndMarkWatched: "library.addItemAndMarkWatched",
    },
    resolvedMetadata: {
      getTitle: "resolvedMetadata.getTitle",
      touchTitle: "resolvedMetadata.touchTitle",
    },
    tmdb: { searchMulti: "tmdb.searchMulti" },
  },
}));

import { AddTitleDialog } from "@/components/title-dialog";

afterEach(cleanup);

describe("add title dialog", () => {
  beforeEach(() => {
    mocks.addItem.mockReset().mockResolvedValue("new-item");
    mocks.addItemAndMarkWatched.mockReset().mockResolvedValue("new-item");
    mocks.searchTitles.mockReset().mockResolvedValue([]);
    mocks.touchTitle.mockReset().mockResolvedValue(undefined);
  });

  it("marks every episode watched when a TV show is added as Watched", async () => {
    render(
      <AddTitleDialog
        initialSelection={{ id: 209867, mediaType: "tv", title: "Frieren" }}
      >
        <button type="button">Open</button>
      </AddTitleDialog>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("radio", { name: "Watched" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to library" }));

    await waitFor(() =>
      expect(mocks.addItemAndMarkWatched).toHaveBeenCalledWith(
        expect.objectContaining({
          mediaType: "tv",
          status: "watched",
          timesWatched: 1,
        }),
      ),
    );
    expect(mocks.addItem).not.toHaveBeenCalled();
  });
});
