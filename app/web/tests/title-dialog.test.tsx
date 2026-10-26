import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";

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

vi.mock("@marker/shared/api", () => ({
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

  it("refreshes metadata once per opening and resets the draft on reopen", async () => {
    const { rerender } = render(
      <StrictMode>
        <AddTitleDialog initialSelection={{ id: 1, mediaType: "movie", title: "Arrival" }}>
          <button type="button">Open</button>
        </AddTitleDialog>
      </StrictMode>,
    );
    expect(mocks.touchTitle).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(mocks.touchTitle).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("radio", { name: "Watched" }));
    rerender(
      <StrictMode>
        <AddTitleDialog initialSelection={{ id: 2, mediaType: "movie", title: "Dune" }}>
          <button type="button">Open</button>
        </AddTitleDialog>
      </StrictMode>,
    );
    expect(mocks.touchTitle).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(mocks.touchTitle).toHaveBeenCalledTimes(2));
    expect(mocks.touchTitle).toHaveBeenLastCalledWith({ mediaType: "movie", tmdbId: 2, title: "Dune" });
    fireEvent.click(screen.getByRole("button", { name: "Add to library" }));
    await waitFor(() => expect(mocks.addItem).toHaveBeenCalledWith(expect.objectContaining({ tmdbId: 2, status: "watchlist", timesWatched: 0 })));
  });

  it("refreshes each search selection, including selecting again after Back", async () => {
    mocks.searchTitles.mockResolvedValue([{ id: 1, mediaType: "movie", title: "Arrival" }]);
    render(<AddTitleDialog><button type="button">Open</button></AddTitleDialog>);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(mocks.touchTitle).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox", { name: "Search TMDB" }), { target: { value: "Arrival" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: /Arrival/ }));
    await waitFor(() => expect(mocks.touchTitle).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(await screen.findByRole("button", { name: /Arrival/ }));
    await waitFor(() => expect(mocks.touchTitle).toHaveBeenCalledTimes(2));
    expect(mocks.touchTitle).toHaveBeenLastCalledWith({ mediaType: "movie", tmdbId: 1, title: "Arrival" });
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
  it("preserves commas inside a tag", async () => {
    render(
      <AddTitleDialog initialSelection={{ id: 1, mediaType: "movie", title: "Arrival" }}>
        <button type="button">Open</button>
      </AddTitleDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.change(screen.getByPlaceholderText("Add a tag"), { target: { value: "science, fiction" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to library" }));
    await waitFor(() => expect(mocks.addItem).toHaveBeenCalledWith(expect.objectContaining({ tags: ["science, fiction"] })));
  });

});
