import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';

export type CalendarEvent = {
  id: string;
  date: string;
  kind: 'movie' | 'episode';
  title: string;
  season?: number;
  episode?: number;
  episodeName?: string;
};

export type CalendarCursor = {
  month: string;
  offset: number;
  version: string;
  mediaType?: 'movie' | 'tv';
  releaseOffset?: number;
  releaseVersion?: string;
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

export type CalendarWindow = {
  startDate: string;
  endDate: string;
  region: string;
  timeZoneOffsetMinutes?: number;
  cachedOnly?: boolean;
};

export type CalendarFetch = (
  args: CalendarWindow & { cursor?: CalendarCursor },
  options?: { signal?: AbortSignal },
) => Promise<CalendarResult>;

export class CalendarRequestError extends Schema.TaggedError<CalendarRequestError>()(
  'CalendarRequestError',
  { cause: Schema.Defect() },
) {
  get message() {
    return this.cause instanceof Error ? this.cause.message : 'Calendar could not be loaded';
  }
}

export class CalendarRefreshTimeout extends Schema.TaggedError<CalendarRefreshTimeout>()(
  'CalendarRefreshTimeout',
  {},
) {
  readonly message = 'Release dates are still updating. Please retry.';
}

export class CalendarPaginationError extends Schema.TaggedError<CalendarPaginationError>()(
  'CalendarPaginationError',
  { message: Schema.String },
) {}

export const currentCalendarMonth = () => {
  const now = DateTime.setZone(DateTime.nowUnsafe(), DateTime.zoneMakeLocal());
  return DateTime.formatIsoDate(now).slice(0, 7);
};

export const loadCalendarPagesEffect = Effect.fn('calendar.loadPages')(function* (
  fetch: CalendarFetch,
  args: CalendarWindow,
  onProgress: (result: CalendarResult) => void,
) {
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
    const page = yield* Effect.tryPromise({
      try: (signal) => fetch({ ...args, ...(cursor && { cursor }) }, { signal }),
      catch: (cause) => new CalendarRequestError({ cause }),
    });
    if (page.refreshPending) {
      // Discovery can span several provider windows and has no replacement data
      // to publish over a saved view while pending.
      const delay = Math.min(Math.max(page.retryAfterMs ?? 1_000, 250), 60_000);
      if (refreshWaitMs + delay > 5 * 60_000) return yield* new CalendarRefreshTimeout();
      refreshWaitMs += delay;
      yield* Effect.sleep(delay);
      continue;
    }
    const merged = new Map(events);
    for (const event of page.events) merged.set(event.id, event);
    result = {
      events: [...merged.values()].sort(
        (a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title),
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
      yield* Effect.sleep(delay);
      continue;
    }
    if (page.truncated && !page.nextCursor)
      return yield* new CalendarPaginationError({
        message: 'The calendar backend must be updated to load the full library',
      });
    retries = 0;
    needsRefresh ||= page.needsRefresh === true;
    for (const event of page.events) events.set(event.id, event);
    count += page.failedTitles.count;
    for (const name of page.failedTitles.names) if (names.size < 5) names.add(name);
    const next = page.nextCursor ?? undefined;
    if (next && JSON.stringify(next) === JSON.stringify(cursor))
      return yield* new CalendarPaginationError({ message: 'Calendar pagination did not advance' });
    cursor = next;
    if (!cursor) return result;
  }
});

/** Promise boundary for React/Convex callers. Polling and requests share cancellation. */
export const loadCalendarPages = (
  fetch: CalendarFetch,
  args: CalendarWindow,
  onProgress: (result: CalendarResult) => void,
  options?: { signal?: AbortSignal },
): Promise<CalendarResult> =>
  Effect.runPromise(loadCalendarPagesEffect(fetch, args, onProgress), options);
