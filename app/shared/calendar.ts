export type CalendarEvent = {
  id: string;
  date: string;
  kind: "movie" | "episode";
  title: string;
  season?: number;
  episode?: number;
  episodeName?: string;
};

export type CalendarCursor =
  | {
      month: string;
      offset: number;
      version: string;
      mediaType?: "movie" | "tv";
      releaseOffset?: number;
      releaseVersion?: string;
    }
  | {
      status: "watching" | "watchlist" | "watched";
      after: string | null;
    };

export type CalendarResult = {
  events: CalendarEvent[];
  failedTitles: { count: number; names: string[] };
  truncated?: boolean;
  nextCursor?: CalendarCursor | null;
  retryAfterMs?: number;
  refreshPending?: boolean;
  needsRefresh?: boolean;
};

export type CalendarFetch = (args: {
  startDate: string;
  endDate: string;
  region: string;
  cursor?: CalendarCursor;
  timeZoneOffsetMinutes?: number;
  cachedOnly?: boolean;
}) => Promise<CalendarResult>;

export const currentCalendarMonth = () => {
  const now = new Date(Date.now());
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

/** Fetch every date-index page, publishing releases before the whole library finishes. */
export async function loadCalendarPages(
  fetch: CalendarFetch,
  args: {
    startDate: string;
    endDate: string;
    region: string;
    timeZoneOffsetMinutes?: number;
    cachedOnly?: boolean;
  },
  onProgress: (result: CalendarResult) => void,
): Promise<CalendarResult> {
  const events = new Map<string, CalendarEvent>();
  const names = new Set<string>();
  let count = 0;
  let needsRefresh = false;
  let cursor: CalendarCursor | undefined;
  let retries = 0;
  let refreshWaitMs = 0;
  let result: CalendarResult = {
    events: [],
    failedTitles: { count, names: [] },
  };
  while (true) {
    const page = await fetch({ ...args, ...(cursor && { cursor }) });
    if (page.refreshPending) {
      // Discovery progresses in background batches and can span several provider
      // windows. Its polling budget is independent of per-title retry attempts.
      // Pending discovery has no replacement data to publish over a saved view.
      const delay = Math.min(Math.max(page.retryAfterMs ?? 1_000, 250), 60_000);
      if (refreshWaitMs + delay > 5 * 60_000)
        throw new Error("Release dates are still updating. Please retry.");
      refreshWaitMs += delay;
      await new Promise((resolve) => setTimeout(resolve, delay));
      continue;
    }
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
      ...((needsRefresh || page.needsRefresh) && { needsRefresh: true }),
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
    needsRefresh ||= page.needsRefresh === true;
    for (const event of page.events) events.set(event.id, event);
    count += page.failedTitles.count;
    for (const name of page.failedTitles.names)
      if (names.size < 5) names.add(name);
    const next = page.nextCursor ?? undefined;
    if (next && JSON.stringify(next) === JSON.stringify(cursor))
      throw new Error("Calendar pagination did not advance");
    cursor = next;
    if (!cursor) return result;
  }
}
