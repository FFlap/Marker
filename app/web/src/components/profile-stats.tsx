import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../mobile/convex/_generated/api";
import {
  formatActivityDate,
  summarizeWatchActivity,
} from "../../../mobile/convex/watchActivityStats";
import { WatchHeatmap } from "@/components/watch-heatmap";
import { useLocalToday } from "@/hooks/use-local-today";

type ProfileStats = Omit<
  FunctionReturnType<typeof api.stats.profile>,
  "favorites"
>;

const dayCount = (count: number) =>
  `${count.toLocaleString()} ${count === 1 ? "day" : "days"}`;

export function ProfileStatsPanel({ stats }: { stats: ProfileStats }) {
  const today = useLocalToday();
  const activity = summarizeWatchActivity(stats.watchActivity, today);
  const cards = [
    {
      label: "Daily streak",
      value: dayCount(activity.currentStreak),
      detail: activity.watchedToday
        ? "Watched today"
        : activity.currentStreak
          ? "Watch today to keep it"
          : undefined,
    },
    {
      label: "Highest streak",
      value: dayCount(activity.longestStreak),
      detail: undefined,
    },
    {
      label: "Avg daily episodes",
      value: activity.dailyAverage.toFixed(1),
      detail: activity.firstDate
        ? `Since ${formatActivityDate(activity.firstDate)}`
        : undefined,
    },
    {
      label: "This week",
      value: activity.thisWeek.toLocaleString(),
      detail: `Last week: ${activity.lastWeek.toLocaleString()}`,
    },
    {
      label: "Watch time",
      value: `${Math.floor(stats.totalWatchMinutes / 1440)}d ${Math.floor((stats.totalWatchMinutes % 1440) / 60)}h`,
      detail: `${stats.totalWatchMinutes.toLocaleString()} minutes`,
    },
    {
      label: "Episodes",
      value: stats.episodesWatched.toLocaleString(),
      detail: undefined,
    },
    {
      label: "Movies Watched",
      value: stats.moviesWatched.toLocaleString(),
      detail: undefined,
    },
    {
      label: "Shows Watched",
      value: stats.showsWatched.toLocaleString(),
      detail: undefined,
    },
    {
      label: "Library Items",
      value: stats.totalItems.toLocaleString(),
      detail: undefined,
    },
    {
      label: "Average Rating",
      value: stats.avgRating.toFixed(1),
      detail: undefined,
    },
  ];
  return (
    <div className="grid gap-7">
      <WatchHeatmap days={stats.watchActivity} today={today} />
      <div className="grid grid-cols-2 gap-x-[4%] gap-y-1">
        {cards.map(({ label, value, detail }) => (
          <div
            key={label}
            className="min-h-[110px] border-b border-border py-[18px]"
          >
            <strong className="block text-[25px] font-bold tabular-nums">
              {value}
            </strong>
            <span className="mt-2 block text-xs text-muted-foreground">
              {label}
            </span>
            {detail && (
              <span className="mt-1 block text-[11px] text-muted-foreground">
                {detail}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
