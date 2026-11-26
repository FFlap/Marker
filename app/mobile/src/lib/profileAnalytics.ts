import {
  activityDateFromDayNumber,
  activityDayNumber,
  type WatchActivityDay,
} from '@marker/shared/watchActivityStats';

export type StatsPeriod = 'week' | 'month' | 'year';

export const STATS_PERIODS = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
] as const satisfies readonly { value: StatsPeriod; label: string }[];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** `label` fits under one bar; `long` is used when only a few labels are shown. */
export type ActivityBucket = { key: string; label: string; long: string; episodes: number };

type DayRange = { start: number; end: number };

function monthIndex(day: number) {
  const date = activityDateFromDayNumber(day);
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

function monthStartDay(index: number) {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return activityDayNumber(`${year}-${String(month).padStart(2, '0')}-01`);
}

function sumRange(counts: Map<number, number>, range: DayRange) {
  let total = 0;
  for (const [day, episodes] of counts)
    if (day >= range.start && day <= range.end) total += episodes;
  return total;
}

/**
 * Buckets daily episode counts for a period ending today, along with the same-length
 * period before it for comparison.
 */
export function analyzeActivity(days: WatchActivityDay[], today: string, period: StatsPeriod) {
  const todayDay = activityDayNumber(today);
  const counts = new Map<number, number>();
  for (const day of days) {
    const number = activityDayNumber(day.date);
    if (day.episodes > 0 && number <= todayDay)
      counts.set(number, (counts.get(number) ?? 0) + day.episodes);
  }
  let range: DayRange;
  let previous: DayRange;
  const buckets: ActivityBucket[] = [];

  if (period === 'week' || period === 'month') {
    const length = period === 'week' ? 7 : 30;
    range = { start: todayDay - length + 1, end: todayDay };
    previous = { start: range.start - length, end: range.start - 1 };
    for (let day = range.start; day <= range.end; day += 1) {
      const date = activityDateFromDayNumber(day);
      const weekday = (day + 4) % 7;
      const long = `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8))}`;
      buckets.push({
        key: date,
        // Three letters ("Mon"), not an ambiguous single "T" or "S".
        label: period === 'week' ? WEEKDAYS[weekday]! : long,
        // Week ticks name the weekday; a picked bar still reads its date ("Mon Nov 23").
        long: period === 'week' ? `${WEEKDAYS[weekday]!} ${long}` : long,
        episodes: counts.get(day) ?? 0,
      });
    }
  } else {
    const lastMonth = monthIndex(todayDay);
    const firstMonth = lastMonth - 11;
    range = { start: monthStartDay(firstMonth), end: todayDay };
    // Compare against the same number of days just before, so a part-finished month
    // isn't measured against a full one.
    const length = range.end - range.start + 1;
    previous = { start: range.start - length, end: range.start - 1 };
    for (let month = firstMonth; month <= lastMonth; month += 1)
      buckets.push({
        key: String(month),
        // Every other month by name ("Sep", "Nov"), always including this one: twelve
        // three-letter names don't fit, and single letters are ambiguous.
        label: (lastMonth - month) % 2 === 0 ? MONTHS[month % 12]! : '',
        // "Nov 2026", not "Nov 26", which reads like a day of the month.
        long: `${MONTHS[month % 12]} ${Math.floor(month / 12)}`,
        episodes: sumRange(counts, {
          start: monthStartDay(month),
          end: monthStartDay(month + 1) - 1,
        }),
      });
  }

  const total = sumRange(counts, range);
  const previousTotal = sumRange(counts, previous);
  let activeDays = 0;
  let bestDay: { date: string; episodes: number } | undefined;
  let bestDayNumber = -1;
  const weekdays = Array.from({ length: 7 }, (_, index) => ({
    label: WEEKDAYS[index]!,
    episodes: 0,
  }));
  for (const [day, episodes] of counts) {
    if (day < range.start || day > range.end) continue;
    activeDays += 1;
    weekdays[(day + 4) % 7]!.episodes += episodes;
    // Ties go to the most recent day, matching the highlighted bar in the chart.
    if (
      !bestDay ||
      episodes > bestDay.episodes ||
      (episodes === bestDay.episodes && day > bestDayNumber)
    ) {
      bestDay = { date: activityDateFromDayNumber(day), episodes };
      bestDayNumber = day;
    }
  }
  // The daily average covers the whole period; the active-day average only days with activity.
  const periodDays = range.end - range.start + 1;
  return {
    buckets,
    total,
    previousTotal,
    /** The span the comparison covers, so its label can name it exactly. */
    previousRange: {
      start: activityDateFromDayNumber(previous.start),
      end: activityDateFromDayNumber(previous.end),
    },
    activeDays,
    periodDays,
    perDay: total / periodDays,
    perActiveDay: activeDays ? total / activeDays : 0,
    bestDay,
    weekdays,
  };
}

type AnalyticsItem = {
  status: 'watched' | 'watching' | 'watchlist' | 'dropped';
  mediaType: 'movie' | 'tv';
  isAnime: boolean;
  rating?: number;
  genres?: string[];
  timesWatched: number;
};

const HIDDEN_GENRES = new Set(['anime', 'animation']);

/** TMDB pairs TV genres ("Action & Adventure"); count each half once per title. */
function itemGenres(genres: readonly string[] = []) {
  const names = new Set<string>();
  for (const genre of genres)
    for (const part of genre.split(/\s*&\s*/)) {
      const name = part.trim();
      if (name && !HIDDEN_GENRES.has(name.toLocaleLowerCase())) names.add(name);
    }
  return names;
}

/** Library composition for the owner's own profile. */
export function analyzeLibrary(items: readonly AnalyticsItem[]) {
  const status = { watched: 0, watching: 0, watchlist: 0, dropped: 0 };
  const kinds = { anime: 0, tv: 0, movie: 0 };
  // Index 0 holds ½–1½★, then 2–2½★, 3–3½★, 4–4½★ and 5★.
  const ratings = [0, 0, 0, 0, 0];
  const genres = new Map<string, number>();
  let rewatches = 0;
  for (const item of items) {
    status[item.status] += 1;
    kinds[item.isAnime ? 'anime' : item.mediaType] += 1;
    if (item.rating !== undefined && item.rating > 0)
      ratings[Math.min(4, Math.max(0, Math.floor(item.rating) - 1))]! += 1;
    if (item.status === 'watched') rewatches += Math.max(0, item.timesWatched - 1);
    for (const genre of itemGenres(item.genres)) genres.set(genre, (genres.get(genre) ?? 0) + 1);
  }
  return {
    status,
    kinds,
    ratings,
    rewatches,
    genres: [...genres.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 5)
      .map(([genre, count]) => ({ genre, count })),
  };
}
