import type { CalendarEvent } from './calendar';

export type CalendarResult = {
  events: CalendarEvent[];
  failedTitles: { count: number; names: string[] };
  truncated?: boolean;
};
type Snapshot = { result?: CalendarResult; loading: boolean; error: boolean };
type Entry = { snapshot: Snapshot; updatedAt: number; pending?: Promise<void> };
const EMPTY: Snapshot = { loading: true, error: false };
const FRESH_MS = 5 * 60 * 1000;
const MAX_MONTHS = 12;

export const monthRange = (month: string) => {
  const [year, number] = month.split('-').map(Number);
  return {
    startDate: `${month}-01`,
    endDate: `${month}-${new Date(year, number, 0).getDate()}`,
  };
};

/** One session's schedules, shared by the month grid and day routes. */
export class CalendarCache {
  private entries = new Map<string, Entry>();
  private listeners = new Map<string, Set<() => void>>();

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
    this.entries.get(`${region}:${month}`)?.snapshot ?? EMPTY;

  private prune() {
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= MAX_MONTHS) break;
      // Mounted month and day screens must never lose their current snapshot.
      if (!entry.pending && !this.listeners.has(key)) this.entries.delete(key);
    }
  }

  async load(
    month: string,
    region: string,
    fetch: (args: {
      startDate: string;
      endDate: string;
      region: string;
    }) => Promise<CalendarResult>,
    force = false,
  ): Promise<void> {
    const key = `${region}:${month}`;
    const previous = this.entries.get(key);
    if (previous) {
      // Fresh cache hits count as visits too, so eviction follows recent use.
      this.entries.delete(key);
      this.entries.set(key, previous);
    }
    if (previous?.pending) return previous.pending;
    const ttl =
      previous?.snapshot.error || previous?.snapshot.result?.failedTitles.count ? 30_000 : FRESH_MS;
    if (!force && previous && Date.now() - previous.updatedAt < ttl) return;
    const entry: Entry = {
      snapshot: { result: previous?.snapshot.result, loading: true, error: false },
      updatedAt: 0,
    };
    this.entries.delete(key);
    this.entries.set(key, entry);
    entry.pending = Promise.resolve().then(async () => {
      try {
        const result = await fetch({ ...monthRange(month), region });
        // The server retains stale data only for failed providers. Merging here
        // would resurrect removed titles or episodes whose release date moved.
        entry.snapshot = { result, loading: false, error: false };
      } catch {
        entry.snapshot = { ...entry.snapshot, loading: false, error: true };
      } finally {
        entry.updatedAt = Date.now();
        entry.pending = undefined;
        this.prune();
        this.listeners.get(key)?.forEach((listener) => listener());
      }
    });
    this.listeners.get(key)?.forEach((listener) => listener());
    return entry.pending;
  }
}
