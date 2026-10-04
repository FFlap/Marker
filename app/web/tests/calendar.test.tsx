import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarFetch } from "../../shared/calendar";

const upcoming = vi.fn<CalendarFetch>();

vi.mock("convex/react", () => ({ useAction: () => upcoming }));
vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
}));

import { CalendarPage } from "@/pages/calendar";

describe("calendar partial failures", () => {
  afterEach(cleanup);
  beforeEach(() => {
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
      nextCursor: { status: "watchlist", after: "more" },
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
