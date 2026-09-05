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
  useAction: (ref: string) => {
    if (ref === "library.addItemAndMarkWatched")
      return mocks.addItemAndMarkWatched;
    if (ref === "tmdb.searchMulti") return mocks.searchTitles;
    throw new Error(`Unexpected action: ${ref}`);
  },
  useMutation: (ref: string) => {
    if (ref === "library.addItem") return mocks.addItem;
    if (ref === "resolvedMetadata.touchTitle") return mocks.touchTitle;
    throw new Error(`Unexpected mutation: ${ref}`);
  },
  useQuery: (ref: string) => {
    if (ref === "resolvedMetadata.getTitle")
      return { genres: ["Animation"], episodeRunTime: [24] };
    if (ref === "library.listTagSuggestions") return [];
    throw new Error(`Unexpected query: ${ref}`);
  },
}));

vi.mock("../../mobile/convex/_generated/api", () => ({
  api: {
    library: {
      items: { addItem: "library.addItem", listTagSuggestions: "library.listTagSuggestions" },
      seasonWatched: { addItemAndMarkWatched: "library.addItemAndMarkWatched" },
    },
    resolvedMetadata: {
      reads: { getTitle: "resolvedMetadata.getTitle" },
      touch: { touchTitle: "resolvedMetadata.touchTitle" },
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
