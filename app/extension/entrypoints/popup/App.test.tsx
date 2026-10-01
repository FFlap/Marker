import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { EpisodeBookmark } from "../../src/domain/types";
import { bookmarkKey } from "../../src/domain/bookmarks";

const bookmark: EpisodeBookmark = {
  platform: "crunchyroll",
  seriesId: "GYZJ43JMR",
  seriesTitle: "That Time I Got Reincarnated as a Slime",
  seriesUrl: "https://www.crunchyroll.com/series/GYZJ43JMR/slime",
  seasonNumber: "1",
  episodeNumber: "2",
  episodeTitle: "Meeting the Goblins",
  episodeId: "G6245P09Y",
  watchUrl: "https://www.crunchyroll.com/watch/G6245P09Y/meeting-the-goblins",
  updatedAt: 200,
};

describe("App", () => {
  it("renders non-numbered categories without adding the word Season", () => {
    render(
      <App
        bookmarks={[{ ...bookmark, seasonNumber: "Specials" }]}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByText("Specials")).toBeInTheDocument();
    expect(screen.queryByText("Season Specials")).not.toBeInTheDocument();
  });

  it("keeps same-series bookmarks on different platforms distinct", () => {
    const onRemove = vi.fn();
    const netflix = {
      ...bookmark,
      platform: "netflix" as const,
      seriesTitle: "Netflix Slime",
    };
    render(
      <App
        bookmarks={[bookmark, netflix]}
        onOpen={vi.fn()}
        onRemove={onRemove}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(
      screen.getByRole("button", { name: `Remove ${bookmark.seriesTitle}` }),
    );
    expect(onRemove).toHaveBeenCalledWith(bookmarkKey(bookmark));
    expect(onRemove).not.toHaveBeenCalledWith(bookmarkKey(netflix));
  });
});
