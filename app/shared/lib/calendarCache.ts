import {
  currentCalendarMonth,
  loadCalendarPages,
  type CalendarFetch,
  type CalendarResult,
} from './calendar';
type Snapshot = { result?: CalendarResult; loading: boolean; error: boolean };
type Entry = { snapshot: Snapshot; updatedAt: number; pending?: Promise<void> };
const EMPTY: Snapshot = { loading: true, error: false };
const PAST: Snapshot = {
  loading: false,
  error: false,
  result: { events: [], failedTitles: { count: 0, names: [] } },
};
const FRESH_MS = 5 * 60 * 1000;
const MAX_MONTHS = 12;

export const monthRange = (month: string) => {
  const [year, number] = month.split('-').map(Number);
  return {
    startDate: `${month}-01`,
    endDate: `${month}-${new Date(year, number, 0).getDate()}`,
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
    this.entries.clear();
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
      if (!this.listeners.has(key)) this.entries.delete(key);
    }
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
    if (!force && previous && Date.now() - previous.updatedAt < ttl) return;
    const entry: Entry = {
      snapshot: {
        result: previous?.snapshot.result,
        loading: true,
        error: false,
      },
      updatedAt: 0,
    };
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.prune();
    const current = () => this.entries.get(key) === entry;
    const fetchCurrent: CalendarFetch = async (args) => {
      if (!current()) throw new Error('Calendar library changed');
      const page = await fetch(args);
      if (!current()) throw new Error('Calendar library changed');
      return page;
    };
    entry.pending = Promise.resolve().then(async () => {
      try {
        const args = {
          ...monthRange(month),
          region,
          timeZoneOffsetMinutes: new Date(Date.now()).getTimezoneOffset(),
        };
        let result = await loadCalendarPages(
          fetchCurrent,
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
              this.listeners.get(key)?.forEach((listener) => listener());
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
          this.listeners.get(key)?.forEach((listener) => listener());
          result = await loadCalendarPages(fetchCurrent, args, (progress) => {
            if (!hasSavedEvents) {
              entry.snapshot = {
                result: progress,
                loading: true,
                error: false,
              };
              this.listeners.get(key)?.forEach((listener) => listener());
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
      } catch {
        if (current()) entry.snapshot = { ...entry.snapshot, loading: false, error: true };
      } finally {
        entry.updatedAt = Date.now();
        entry.pending = undefined;
        if (current()) {
          this.prune();
          this.listeners.get(key)?.forEach((listener) => listener());
        }
      }
    });
    this.listeners.get(key)?.forEach((listener) => listener());
    return entry.pending;
  }
}
