import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const upcoming = vi.fn<
  (args: { startDate: string; endDate: string; region: string }) => Promise<{
    events: never[];
    failedTitles: { count: number; names: string[] };
    truncated: boolean;
    region: string;
  }>
>();

vi.mock("convex/react", () => ({ useAction: () => upcoming }));
vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
}));

import { CalendarPage } from "@/pages/calendar";

describe("calendar partial failures", () => {
  beforeEach(() => {
    upcoming.mockReset();
    upcoming.mockResolvedValue({
      events: [],
      failedTitles: { count: 1, names: ["Broken title"] },
      truncated: false,
      region: "US",
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
});
