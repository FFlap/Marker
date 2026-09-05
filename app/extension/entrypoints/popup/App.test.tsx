import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => vi.restoreAllMocks());

  it("shows a useful empty state", () => {
    render(
      <App
        bookmarks={[]}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByText("No episodes tracked yet")).toBeInTheDocument();
    expect(
      screen.getByText(/Open any episode on Crunchyroll or Netflix/i),
    ).toBeInTheDocument();
  });

  it("renders series, season, episode, and episode title", () => {
    render(
      <App
        bookmarks={[bookmark]}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    expect(screen.getByText(bookmark.seriesTitle)).toBeInTheDocument();
    expect(screen.getByText("Season 1")).toBeInTheDocument();
    expect(screen.getByText("Episode 2")).toBeInTheDocument();
    expect(screen.getByText("Meeting the Goblins")).toBeInTheDocument();
  });

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

  it("does not render platform labels", () => {
    render(
      <App
        bookmarks={[{ ...bookmark, platform: "netflix" }]}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    expect(screen.queryByText("Netflix")).not.toBeInTheDocument();
    expect(screen.queryByText("Crunchyroll")).not.toBeInTheDocument();
  });

  it("opens the exact last watched episode from the card", () => {
    const onOpen = vi.fn();
    render(
      <App
        bookmarks={[bookmark]}
        onOpen={onOpen}
        onRemove={vi.fn()}
        onClear={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /continue that time/i }),
    );
    expect(onOpen).toHaveBeenCalledWith(bookmark.watchUrl);
  });

  it("removes one bookmark without opening it", () => {
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    render(
      <App
        bookmarks={[bookmark]}
        onOpen={onOpen}
        onRemove={onRemove}
        onClear={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /remove that time/i }));
    expect(onRemove).toHaveBeenCalledWith(bookmarkKey(bookmark));
    expect(onOpen).not.toHaveBeenCalled();
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

  it("clears all bookmarks", () => {
    const onClear = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <App
        bookmarks={[bookmark]}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onClear={onClear}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("renders a specific unmatched sync reason", () => {
    render(
      <App
        bookmarks={[]}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onClear={vi.fn()}
        sync={{
          signedIn: true,
          accountLabel: "@viewer",
          lastResult: { ok: false, at: 100, reason: "unmatched" },
          onConnect: vi.fn(),
          onSignOut: vi.fn(),
        }}
      />,
    );
    expect(
      screen.getByText(/Last episode couldn't be matched to a show/),
    ).toBeInTheDocument();
  });

  it.each([
    ["unsupported-episode", "Last sync unsupported episode"],
    ["not-signed-in", "Last sync waiting for sign-in"],
    ["rejected", "Last sync was rejected"],
  ])("renders the %s sync reason", (reason, expected) => {
    render(
      <App
        bookmarks={[]}
        onOpen={vi.fn()}
        onRemove={vi.fn()}
        onClear={vi.fn()}
        sync={{
          signedIn: true,
          lastResult: { ok: false, at: 100, reason },
          onConnect: vi.fn(),
          onSignOut: vi.fn(),
        }}
      />,
    );
    expect(
      screen.getByText((content) => content.startsWith(expected)),
    ).toBeInTheDocument();
  });

  it("connects through the website and never renders credential fields", async () => {
    const onConnect = vi.fn().mockResolvedValue(undefined);
    render(<App bookmarks={[]} onOpen={vi.fn()} onRemove={vi.fn()} onClear={vi.fn()} sync={{ signedIn: false, onConnect, onSignOut: vi.fn() }} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Marker" }));
    await waitFor(() => expect(onConnect).toHaveBeenCalledOnce());
    expect(screen.queryByLabelText(/email|password|token/i)).not.toBeInTheDocument();
  });

  it("shows the signed-in account and signs out", () => {
    const onSignOut = vi.fn().mockResolvedValue(undefined);
    render(<App bookmarks={[]} onOpen={vi.fn()} onRemove={vi.fn()} onClear={vi.fn()} sync={{ signedIn: true, accountLabel: "@viewer", onConnect: vi.fn(), onSignOut }} />);
    expect(screen.getByText("@viewer")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it("shows a session-expired notice after a live session update", () => {
    const { rerender } = render(<App bookmarks={[]} onOpen={vi.fn()} onRemove={vi.fn()} onClear={vi.fn()} sync={{ signedIn: true, accountLabel: "@viewer", onConnect: vi.fn(), onSignOut: vi.fn() }} />);
    rerender(<App bookmarks={[]} onOpen={vi.fn()} onRemove={vi.fn()} onClear={vi.fn()} sync={{ signedIn: false, notice: "Session expired — connect again", onConnect: vi.fn(), onSignOut: vi.fn() }} />);
    expect(screen.getByText("Session expired — connect again")).toBeInTheDocument();
    expect(screen.getByText("Not signed in")).toBeInTheDocument();
  });
});
