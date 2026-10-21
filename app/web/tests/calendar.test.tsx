import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarFetch } from "@marker/shared/calendar";

const upcoming = vi.fn<CalendarFetch>();
let libraryRevision: number | undefined = 0;

vi.mock("convex/react", () => ({
  useAction: () => upcoming,
  useQuery: () => libraryRevision,
}));
vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
}));

import { CalendarPage } from "@/pages/calendar";

describe("calendar partial failures", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  beforeEach(() => {
    libraryRevision = 0;
    upcoming.mockReset();
    upcoming.mockResolvedValue({
      events: [],
      failedTitles: { count: 1, names: ["Broken title"] },
      truncated: false,
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  it("surfaces a partial result notice", async () => {
    render(<CalendarPage />);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Some titles could not be loaded: Broken title",
      ),
    );
  });

  it("lets a partial calendar retry missing titles", async () => {
    render(<CalendarPage />);
    const retry = await screen.findByRole("button", {
      name: "Retry missing release dates",
    });
    upcoming.mockResolvedValue({
      events: [],
      failedTitles: { count: 0, names: [] },
    });
    fireEvent.click(retry);
    await waitFor(() => expect(upcoming).toHaveBeenCalledTimes(2));
    expect(upcoming.mock.calls[1][0].cachedOnly).toBeUndefined();
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("loads the selected adjacent month instead of showing a false empty day", async () => {
    vi.spyOn(Date, "now").mockReturnValue(new Date(2026, 9, 15).getTime());
    upcoming.mockResolvedValue({
      events: [],
      failedTitles: { count: 0, names: [] },
    });
    render(<CalendarPage />);
    await waitFor(() => expect(upcoming).toHaveBeenCalledTimes(1));
    upcoming.mockResolvedValue({
      events: [
        {
          id: "next",
          date: "2026-11-01",
          kind: "movie",
          title: "November premiere",
        },
      ],
      failedTitles: { count: 0, names: [] },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: `${new Date(2026, 10, 1).toLocaleDateString()}, 0 releases`,
      }),
    );
    await waitFor(() =>
      expect(screen.getAllByText("November premiere")).toHaveLength(2),
    );
    expect(upcoming.mock.calls[1][0].startDate).toBe("2026-11-01");
    expect(
      screen.getByRole("heading", { name: "November 2026" }),
    ).toBeInTheDocument();
  });

  it("advances an obsolete month when the tab regains focus after month end", async () => {
    const clock = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date(2026, 9, 31).getTime());
    upcoming.mockResolvedValue({
      events: [],
      failedTitles: { count: 0, names: [] },
    });
    render(<CalendarPage />);
    await waitFor(() => expect(upcoming).toHaveBeenCalledTimes(1));
    clock.mockReturnValue(new Date(2026, 10, 1).getTime());
    fireEvent.focus(window);
    await waitFor(() => expect(upcoming).toHaveBeenCalledTimes(2));
    expect(upcoming.mock.calls[1][0].startDate).toBe("2026-11-01");
    expect(
      screen.getByRole("heading", { name: "November 2026" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Previous month" }),
    ).toBeDisabled();
  });

  it("reloads fresh calendar data when library membership changes", async () => {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    upcoming.mockResolvedValue({
      events: [{ id: "removed", date, kind: "movie", title: "Removed title" }],
      failedTitles: { count: 0, names: [] },
    });
    const view = render(<CalendarPage />);
    await waitFor(() =>
      expect(screen.getAllByText("Removed title")).toHaveLength(2),
    );
    upcoming.mockResolvedValue({
      events: [{ id: "added", date, kind: "movie", title: "Added title" }],
      failedTitles: { count: 0, names: [] },
    });
    libraryRevision = 1;
    view.rerender(<CalendarPage />);
    await waitFor(() =>
      expect(screen.getAllByText("Added title")).toHaveLength(2),
    );
    expect(screen.queryByText("Removed title")).toBeNull();
    expect(upcoming).toHaveBeenCalledTimes(2);
  });

  it("loads every page and reuses saved months without requesting past months", async () => {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    upcoming.mockResolvedValue({
      events: [],
      failedTitles: { count: 0, names: [] },
      nextCursor: null,
    });
    upcoming.mockResolvedValueOnce({
      events: [],
      failedTitles: { count: 0, names: [] },
      nextCursor: { month: date.slice(0, 7), offset: 20, version: "saved" },
      truncated: true,
    });
    upcoming.mockResolvedValueOnce({
      events: [
        { id: "later", date, kind: "movie", title: "Later library title" },
      ],
      failedTitles: { count: 0, names: [] },
      nextCursor: null,
    });
    render(<CalendarPage />);
    expect(
      screen.getByRole("button", { name: "Previous month" }),
    ).toBeDisabled();
    await waitFor(() =>
      expect(screen.getAllByText("Later library title")).toHaveLength(2),
    );
    expect(upcoming).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => expect(upcoming).toHaveBeenCalledTimes(3));
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() =>
      expect(screen.getAllByText("Later library title").length).toBeGreaterThan(
        0,
      ),
    );
    expect(upcoming).toHaveBeenCalledTimes(3);
  });
});
