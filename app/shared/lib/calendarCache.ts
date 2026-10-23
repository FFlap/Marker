import * as Cause from 'effect/Cause';
import * as DateTime from 'effect/DateTime';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import {
  currentCalendarMonth,
  loadCalendarPagesEffect,
  type CalendarFetch,
  type CalendarResult,
} from './calendar';
type Snapshot = { result?: CalendarResult; loading: boolean; error: boolean };
type Entry = {
  snapshot: Snapshot;
  updatedAt: number;
  pending?: Promise<void>;
  controller: AbortController;
};
const EMPTY: Snapshot = { loading: true, error: false };
const PAST: Snapshot = {
  loading: false,
  error: false,
  result: { events: [], failedTitles: { count: 0, names: [] } },
};
const FRESH_MS = 5 * 60 * 1000;
const MAX_MONTHS = 12;

export const monthRange = (month: string) => {
  const start = DateTime.makeUnsafe(`${month}-01`);
  return {
    startDate: DateTime.formatIsoDateUtc(start),
    endDate: DateTime.formatIsoDateUtc(DateTime.endOf(start, 'month')),
  };
};

export class CalendarCache {
  private entries = new Map<string, Entry>();
  private listeners = new Map<string, Set<() => void>>();
  private libraryRevision: number | undefined;

  setLibraryRevision(revision: number) {
    if (this.libraryRevision !== undefined && revision <= this.libraryRevision) return;
    const changed = this.libraryRevision !== undefined;
    this.libraryRevision = revision;
    if (!changed) return;
    // Detaching the entries fences requests started before a title was removed or dropped.
    const obsolete = [...this.entries.values()];
    this.entries.clear();
    obsolete.forEach((entry) => entry.controller.abort());
    this.listeners.forEach((listeners) => listeners.forEach((listener) => listener()));
  }

  subscribe = (month: string, region: string, listener: () => void) => {
    const key = `${region}:${month}`;
    const listeners = this.listeners.get(key) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(key);
      this.prune();
    };
  };

  get = (month: string, region: string) =>
    month < currentCalendarMonth()
      ? PAST
      : (this.entries.get(`${region}:${month}`)?.snapshot ?? EMPTY);

  private prune() {
    for (const key of this.entries.keys()) {
      if (this.entries.size <= MAX_MONTHS) break;
      if (!this.listeners.has(key)) {
        const entry = this.entries.get(key);
        this.entries.delete(key);
        entry?.controller.abort();
      }
    }
  }

  /** Release session-owned requests and timers when the account/provider unmounts. */
  dispose() {
    const entries = [...this.entries.values()];
    this.entries.clear();
    this.listeners.clear();
    this.libraryRevision = undefined;
    entries.forEach((entry) => entry.controller.abort());
  }

  async load(month: string, region: string, fetch: CalendarFetch, force = false): Promise<void> {
    if (month < currentCalendarMonth()) return;
    const key = `${region}:${month}`;
    const previous = this.entries.get(key);
    if (previous) {
      this.entries.delete(key);
      this.entries.set(key, previous);
    }
    if (previous?.pending) return previous.pending;
    const ttl =
      previous?.snapshot.error || previous?.snapshot.result?.failedTitles.count ? 30_000 : FRESH_MS;
    if (
      !force &&
      previous &&
      DateTime.toEpochMillis(DateTime.nowUnsafe()) - previous.updatedAt < ttl
    )
      return;
    const entry: Entry = {
      snapshot: {
        result: previous?.snapshot.result,
        loading: true,
        error: false,
      },
      updatedAt: 0,
      controller: new AbortController(),
    };
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.prune();
    const current = () => this.entries.get(key) === entry;
    const program = Effect.gen(function* () {
      const now = yield* DateTime.now;
      const args = {
        ...monthRange(month),
        region,
        timeZoneOffsetMinutes:
          -DateTime.zonedOffset(DateTime.setZone(now, DateTime.zoneMakeLocal())) / 60_000,
      };
      let result = yield* loadCalendarPagesEffect(
        fetch,
        {
          ...args,
          ...(!force && { cachedOnly: true }),
        },
        (progress) => {
          if (!previous?.snapshot.result) {
            entry.snapshot = {
              result: progress,
              loading: true,
              error: false,
            };
            notify();
          }
        },
      );
      if (!force && result.needsRefresh) {
        const saved = previous?.snapshot.result ?? result;
        const hasSavedEvents = saved.events.length > 0;
        entry.snapshot = {
          result: { ...saved, needsRefresh: true },
          loading: true,
          error: false,
        };
        notify();
        result = yield* loadCalendarPagesEffect(fetch, args, (progress) => {
          if (!hasSavedEvents) {
            entry.snapshot = {
              result: progress,
              loading: true,
              error: false,
            };
            notify();
          }
        });
      }
      // The server retains stale data only for failed providers. Merging here
      // would resurrect removed titles or episodes whose release date moved.
      entry.snapshot = {
        result,
        loading: false,
        error: result.needsRefresh === true,
      };
    });
    const notify = () => {
      if (current()) this.listeners.get(key)?.forEach((listener) => listener());
    };
    const failed = () =>
      Effect.sync(() => {
        if (current()) entry.snapshot = { ...entry.snapshot, loading: false, error: true };
      });
    const load = program.pipe(
      Effect.catchTags({
        CalendarRequestError: failed,
        CalendarRefreshTimeout: failed,
        CalendarPaginationError: failed,
      }),
      Effect.onExit((exit) =>
        Effect.map(DateTime.now, (now) => {
          entry.updatedAt = DateTime.toEpochMillis(now);
          entry.pending = undefined;
          if (current()) {
            if (Exit.isFailure(exit))
              entry.snapshot = { ...entry.snapshot, loading: false, error: true };
            this.prune();
            notify();
          }
        }),
      ),
    );
    // Register the pending promise before starting work: observers may reenter load().
    entry.pending = Promise.resolve()
      .then(() => Effect.runPromiseExit(load, { signal: entry.controller.signal }))
      .then((exit) => {
        if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause))
          throw Cause.squash(exit.cause);
      });
    this.listeners.get(key)?.forEach((listener) => listener());
    return entry.pending;
  }
}
