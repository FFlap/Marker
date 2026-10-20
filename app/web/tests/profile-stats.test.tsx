import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileStatsPanel } from "@/components/profile-stats";
import { localDateKey } from "@/hooks/use-local-today";
import { formatActivityDate } from "../../mobile/convex/watchActivityStats";

const today = new Date();
const daysAgo = (count: number) =>
  localDateKey(
    new Date(today.getFullYear(), today.getMonth(), today.getDate() - count),
  );

const stats = {
  totalWatchMinutes: 1560,
  episodesWatched: 12,
  moviesWatched: 3,
  showsWatched: 4,
  totalItems: 19,
  avgRating: 4.25,
  topTags: [],
  watchActivity: [
    { date: daysAgo(9), episodes: 6 },
    { date: daysAgo(8), episodes: 2 },
    { date: daysAgo(7), episodes: 1 },
    { date: daysAgo(1), episodes: 1 },
  ],
};

describe("profile stats panel", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 800,
    } as DOMRect);
  });

  it("derives streaks, the daily average and weekly totals from watch activity", () => {
    render(<ProfileStatsPanel stats={stats} />);
    expect(screen.getByText("Daily streak").previousSibling).toHaveTextContent(
      "1 day",
    );
    expect(screen.getByText("Watch today to keep it")).toBeInTheDocument();
    expect(
      screen.getByText("Highest streak").previousSibling,
    ).toHaveTextContent("3 days");
    // 10 episodes across the 10 days since the first logged day.
    expect(
      screen.getByText("Avg daily episodes").previousSibling,
    ).toHaveTextContent("1.0");
    expect(screen.getByText("This week")).toBeInTheDocument();
    expect(screen.getByText(/^Last week: \d+$/)).toBeInTheDocument();
    expect(
      screen.getByText(/10 episodes in the last 50 weeks/),
    ).toBeInTheDocument();
    expect(
      screen.getByTitle(`6 episodes on ${formatActivityDate(daysAgo(9))}`),
    ).toBeInTheDocument();
  });
});
