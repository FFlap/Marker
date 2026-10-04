export type CalendarEvent = {
  id: string;
  date: string;
  kind: "movie" | "episode";
  title: string;
  season?: number;
  episode?: number;
  episodeName?: string;
};

export type CalendarCursor = {
  status: "watching" | "watchlist" | "watched";
  after: string | null;
};

export type CalendarResult = {
  events: CalendarEvent[];
  failedTitles: { count: number; names: string[] };
  truncated?: boolean;
  nextCursor?: CalendarCursor | null;
  retryAfterMs?: number;
};

export type CalendarFetch = (args: {
  startDate: string;
  endDate: string;
  region: string;
  cursor?: CalendarCursor;
  timeZoneOffsetMinutes?: number;
}) => Promise<CalendarResult>;

export const currentCalendarMonth = () => {
  const now = new Date(Date.now());
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

/** Fetch every library page, publishing releases before the whole library finishes. */
export async function loadCalendarPages(
  fetch: CalendarFetch,
  args: {
    startDate: string;
    endDate: string;
    region: string;
    timeZoneOffsetMinutes?: number;
  },
  onProgress: (result: CalendarResult) => void,
): Promise<CalendarResult> {
  const events = new Map<string, CalendarEvent>();
  const names = new Set<string>();
  let count = 0;
  let cursor: CalendarCursor | undefined;
  let retries = 0;
  let result: CalendarResult = {
    events: [],
    failedTitles: { count, names: [] },
  };
  do {
    const page = await fetch({ ...args, ...(cursor && { cursor }) });
    const merged = new Map(events);
    for (const event of page.events) merged.set(event.id, event);
    result = {
      events: [...merged.values()].sort(
        (a, b) =>
          a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
      ),
      failedTitles: {
        count: count + page.failedTitles.count,
        names: [...new Set([...names, ...page.failedTitles.names])].slice(0, 5),
      },
      truncated: false,
    };
    onProgress(result);
    if (page.retryAfterMs && retries < 2) {
      retries++;
      const delay = Math.min(page.retryAfterMs, 60_000);
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
    if (page.truncated && !page.nextCursor)
      throw new Error(
        "The calendar backend must be updated to load the full library",
      );
    retries = 0;
    for (const event of page.events) events.set(event.id, event);
    count += page.failedTitles.count;
    for (const name of page.failedTitles.names)
      if (names.size < 5) names.add(name);
    const next = page.nextCursor ?? undefined;
    if (next && JSON.stringify(next) === JSON.stringify(cursor))
      throw new Error("Calendar pagination did not advance");
    cursor = next;
  } while (cursor || retries);
  return result;
}
