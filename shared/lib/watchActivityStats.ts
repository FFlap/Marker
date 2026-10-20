/**
 * Pure watch-activity math shared by the Convex backend and both clients.
 * Dates are local calendar days in `YYYY-MM-DD` form.
 */
export type WatchActivityDay = { date: string; episodes: number };

export type HeatmapCell = { date: string; episodes: number; level: 0 | 1 | 2 | 3 | 4 };

const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const activityDayNumber = (date: string) =>
  Math.floor(
    Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) /
      DAY_MS,
  );

export const activityDateFromDayNumber = (day: number) =>
  new Date(day * DAY_MS).toISOString().slice(0, 10);

export const formatActivityDate = (date: string) =>
  `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`;

export function summarizeWatchActivity(days: WatchActivityDay[], today: string) {
  const active = days
    // Stored local dates may be ahead of a public-profile viewer's calendar.
    .filter((day) => day.episodes > 0 && day.date <= today)
    .map((day) => ({ ...day, day: activityDayNumber(day.date) }))
    .sort((left, right) => left.day - right.day);
  const todayNumber = activityDayNumber(today);
  let longestStreak = 0;
  let run = 0;
  let totalEpisodes = 0;
  // Weeks run Sunday to Saturday, matching the heatmap columns.
  const weekStart = todayNumber - ((todayNumber + 4) % 7);
  let thisWeek = 0;
  let lastWeek = 0;
  for (const [index, day] of active.entries()) {
    run = index > 0 && day.day === active[index - 1]!.day + 1 ? run + 1 : 1;
    longestStreak = Math.max(longestStreak, run);
    totalEpisodes += day.episodes;
    if (day.day >= weekStart && day.day <= todayNumber) thisWeek += day.episodes;
    else if (day.day >= weekStart - 7 && day.day < weekStart) lastWeek += day.episodes;
  }
  // A streak stays alive until a full local day passes without an episode.
  const latest = active.at(-1);
  const currentStreak = latest && latest.day >= todayNumber - 1 ? run : 0;
  const firstDate = active[0]?.date;
  const spanDays = active[0] ? Math.max(1, todayNumber - active[0].day + 1) : 0;
  return {
    currentStreak,
    longestStreak,
    watchedToday: latest?.day === todayNumber,
    totalEpisodes,
    activeDays: active.length,
    dailyAverage: spanDays ? totalEpisodes / spanDays : 0,
    firstDate,
    thisWeek,
    lastWeek,
  };
}

/**
 * Lays out a Sunday-first contribution grid ending with the week that contains
 * `today`. Days after today are null so the final column stays ragged.
 */
export function buildActivityHeatmap(days: WatchActivityDay[], today: string, weekCount: number) {
  const counts = new Map(days.map((day) => [day.date, day.episodes]));
  const todayNumber = activityDayNumber(today);
  // 1970-01-01 was a Thursday, so day 0 sits four places after Sunday.
  const weekStart = todayNumber - ((todayNumber + 4) % 7);
  const firstDay = weekStart - (Math.max(1, weekCount) - 1) * 7;
  const raw: ({ date: string; episodes: number } | null)[][] = [];
  let max = 0;
  let total = 0;
  for (let week = 0; week < Math.max(1, weekCount); week += 1) {
    const column: ({ date: string; episodes: number } | null)[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const day = firstDay + week * 7 + weekday;
      if (day > todayNumber) {
        column.push(null);
        continue;
      }
      const date = activityDateFromDayNumber(day);
      const episodes = counts.get(date) ?? 0;
      max = Math.max(max, episodes);
      total += episodes;
      column.push({ date, episodes });
    }
    raw.push(column);
  }
  const level = (episodes: number) =>
    (episodes === 0 ? 0 : Math.min(4, Math.ceil((episodes / max) * 4))) as HeatmapCell['level'];
  const weeks: (HeatmapCell | null)[][] = raw.map((column) =>
    column.map((cell) => cell && { ...cell, level: level(cell.episodes) }),
  );
  const months: { week: number; label: string }[] = [];
  for (const [week, column] of weeks.entries()) {
    const monthStart = column.find((cell) => cell?.date.endsWith('-01'))?.date;
    // The first column names its partial month unless a new month starts right after it.
    const leading =
      week === 0 && !weeks.slice(1, 3).some((next) => next.some((c) => c?.date.endsWith('-01')))
        ? column[0]?.date
        : undefined;
    const labelDate = monthStart ?? leading;
    if (labelDate) months.push({ week, label: MONTHS[Number(labelDate.slice(5, 7)) - 1]! });
  }
  return { weeks, months, total };
}
