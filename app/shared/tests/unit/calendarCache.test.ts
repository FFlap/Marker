import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CalendarResult } from '../../lib/calendar';
import { CalendarCache, monthRange } from '../../lib/calendarCache';

const result = (title = 'Arrival') => ({
  events: [{ id: title, date: '2026-09-02', kind: 'movie' as const, title }],
  failedTitles: { count: 0, names: [] },
});

beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2025, 10, 1)));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('shared calendar schedules', () => {
  it('bounds abandoned pending months and stops their pagination when they are evicted', async () => {
    const cache = new CalendarCache();
    const releases: ((value: CalendarResult) => void)[] = [];
    const fetch = vi.fn(() => new Promise<CalendarResult>((resolve) => releases.push(resolve)));
    const pending = [];
    for (let month = 1; month <= 12; month++) {
      pending.push(cache.load(`2026-${String(month).padStart(2, '0')}`, 'CA', fetch));
      await Promise.resolve();
    }
    pending.push(cache.load('2027-01', 'CA', fetch));
    await Promise.resolve();
    releases[0]({
      ...result('Evicted'),
      nextCursor: { month: '2026-01', offset: 20, version: 'saved' },
    });
    for (const resolve of releases.slice(1)) resolve(result('Retained'));
    await Promise.all(pending);
    expect(fetch).toHaveBeenCalledTimes(13);
    expect(cache.get('2026-01', 'CA').result).toBeUndefined();
    expect(cache.get('2027-01', 'CA').result).toMatchObject(result('Retained'));
  });

  it('keeps all saved pages when a manual retry encounters a capped page, then recovers', async () => {
    const cache = new CalendarCache();
    const saved = {
      ...result('First'),
      events: [...result('First').events, ...result('Last').events],
    };
    await cache.load('2026-09', 'CA', async () => saved);
    await cache.load(
      '2026-09',
      'CA',
      async () => {
        throw new Error('offline');
      },
      true,
    );
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ...result('First'),
        nextCursor: { month: '2026-09', offset: 20, version: 'saved' },
      })
      .mockResolvedValueOnce({ ...result('Last'), truncated: true });
    const retry = cache.load('2026-09', 'CA', fetch, true);
    expect(cache.get('2026-09', 'CA')).toMatchObject({ loading: true, result: saved });
    await retry;
    expect(cache.get('2026-09', 'CA')).toMatchObject({
      result: saved,
      loading: false,
      error: true,
    });
    await cache.load('2026-09', 'CA', async () => result('Updated'), true);
    expect(cache.get('2026-09', 'CA')).toMatchObject({ error: false, result: result('Updated') });
  });

  it('keeps the complete client schedule when a cached pass only recovers some releases', async () => {
    const cache = new CalendarCache();
    const saved = {
      ...result('First'),
      events: [...result('First').events, ...result('Last').events],
    };
    await cache.load('2026-09', 'CA', async () => saved);
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2025, 10, 1) + 6 * 60_000);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ...result('First'), needsRefresh: true })
      .mockRejectedValueOnce(new Error('offline'));
    await cache.load('2026-09', 'CA', fetch);
    expect(cache.get('2026-09', 'CA')).toMatchObject({
      result: saved,
      loading: false,
      error: true,
    });
  });

  it('leaves stale published catalogs retryable after the authoritative refresh pass', async () => {
    const cache = new CalendarCache();
    const stale = { ...result('Saved'), needsRefresh: true };
    const fetch = vi.fn().mockResolvedValue(stale);
    await cache.load('2026-09', 'CA', fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(cache.get('2026-09', 'CA')).toMatchObject({
      result: stale,
      error: true,
      loading: false,
    });
    fetch.mockClear();
    await cache.load('2026-09', 'CA', fetch, true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cache.get('2026-09', 'CA').error).toBe(true);
  });

  it('invalidates visible and prefetched months when library membership changes', async () => {
    const cache = new CalendarCache();
    cache.setLibraryRevision(3);
    const fetch = vi.fn(async () => result('Removed title'));
    await cache.load('2026-09', 'CA', fetch);
    await cache.load('2026-10', 'CA', fetch);
    const listener = vi.fn();
    cache.subscribe('2026-09', 'CA', listener);
    cache.setLibraryRevision(4);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(cache.get('2026-09', 'CA').result).toBeUndefined();
    expect(cache.get('2026-10', 'CA').result).toBeUndefined();
    fetch.mockResolvedValue(result('New title'));
    await cache.load('2026-09', 'CA', fetch);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(cache.get('2026-09', 'CA').result).toMatchObject(result('New title'));
    cache.setLibraryRevision(3);
    cache.setLibraryRevision(4);
    await cache.load('2026-09', 'CA', fetch);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('fences an in-flight page so it cannot restore removed titles or fetch more pages', async () => {
    const cache = new CalendarCache();
    cache.setLibraryRevision(0);
    let finish!: (value: CalendarResult) => void;
    const oldFetch = vi.fn(
      () =>
        new Promise<CalendarResult>((resolve) => {
          finish = resolve;
        }),
    );
    const old = cache.load('2026-09', 'US', oldFetch);
    await Promise.resolve();
    cache.setLibraryRevision(1);
    await cache.load('2026-09', 'US', async () => result('Current library'));
    finish({
      ...result('Removed title'),
      nextCursor: { month: '2026-09', offset: 20, version: 'saved' },
    });
    await old;
    expect(oldFetch).toHaveBeenCalledTimes(1);
    expect(cache.get('2026-09', 'US')).toMatchObject({
      loading: false,
      error: false,
      result: result('Current library'),
    });
  });

  it('uses local month bounds including leap years and year transitions', () => {
    expect(monthRange('2028-02')).toEqual({ startDate: '2028-02-01', endDate: '2028-02-29' });
    expect(monthRange('2026-12').endDate).toBe('2026-12-31');
  });

  it('shows saved releases while refreshing and deduplicates month and day requests', async () => {
    const cache = new CalendarCache();
    let finish!: (value: CalendarResult) => void;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ...result('Saved'),
        needsRefresh: true,
        nextCursor: { month: '2026-09', offset: 20, version: 'saved' },
      })
      .mockResolvedValueOnce({ ...result('Saved'), needsRefresh: false })
      .mockImplementationOnce(
        () =>
          new Promise<CalendarResult>((resolve) => {
            finish = resolve;
          }),
      );
    const loading = cache.load('2026-09', 'CA', fetch);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(cache.get('2026-09', 'CA')).toMatchObject({
      loading: true,
      error: false,
      result: { ...result('Saved'), needsRefresh: true },
    });
    const day = cache.load('2026-09', 'CA', fetch);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0][0].cachedOnly).toBe(true);
    expect(fetch.mock.calls[1][0].cachedOnly).toBe(true);
    expect(fetch.mock.calls[2][0].cachedOnly).toBeUndefined();
    expect(cache.get('2026-09', 'US').result).toBeUndefined();
    expect(new CalendarCache().get('2026-09', 'CA').result).toBeUndefined();
    finish(result('Moved'));
    await Promise.all([loading, day]);
    expect(cache.get('2026-09', 'CA')).toMatchObject({ loading: false, result: result('Moved') });
    expect(cache.get('2026-09', 'CA').result?.needsRefresh).toBeUndefined();
  });

  it('keeps saved releases when background discovery exhausts its retries', async () => {
    vi.useFakeTimers();
    try {
      const cache = new CalendarCache();
      const fetch = vi
        .fn()
        .mockResolvedValueOnce({ ...result(), needsRefresh: true })
        .mockResolvedValue({
          events: [],
          failedTitles: { count: 1, names: [] },
          refreshPending: true,
          retryAfterMs: 1_000,
        });
      const loading = cache.load('2026-09', 'CA', fetch);
      await vi.runAllTimersAsync();
      await loading;
      expect(fetch).toHaveBeenCalledTimes(302);
      expect(cache.get('2026-09', 'CA')).toMatchObject({
        loading: false,
        error: true,
        result: result(),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('retains the saved schedule when a manual retry is waiting for discovery', async () => {
    vi.useFakeTimers();
    try {
      const cache = new CalendarCache();
      await cache.load('2026-09', 'CA', async () => result('Saved'));
      await cache.load(
        '2026-09',
        'CA',
        async () => {
          throw new Error('offline');
        },
        true,
      );
      const pending = {
        events: [],
        failedTitles: { count: 1, names: [] },
        refreshPending: true,
      };
      const fetch = vi
        .fn()
        .mockResolvedValueOnce({ ...pending, retryAfterMs: 60_000 })
        .mockResolvedValueOnce({ ...pending, retryAfterMs: 1_000 })
        .mockResolvedValueOnce({ ...pending, retryAfterMs: 1_000 })
        .mockResolvedValue(result('Updated'));
      const retry = cache.load('2026-09', 'CA', fetch, true);
      await vi.advanceTimersByTimeAsync(59_999);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(cache.get('2026-09', 'CA')).toMatchObject({
        loading: true,
        result: result('Saved'),
      });
      await vi.runAllTimersAsync();
      await retry;
      expect(fetch).toHaveBeenCalledTimes(4);
      expect(cache.get('2026-09', 'CA')).toMatchObject({
        loading: false,
        error: false,
        result: result('Updated'),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the previous client schedule when server snapshots have been evicted', async () => {
    const cache = new CalendarCache();
    await cache.load('2026-09', 'CA', async () => result());
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2025, 10, 1) + 6 * 60_000);
    let finish!: (value: CalendarResult) => void;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        events: [],
        failedTitles: { count: 0, names: [] },
        needsRefresh: true,
      })
      .mockImplementationOnce(
        () =>
          new Promise<CalendarResult>((resolve) => {
            finish = resolve;
          }),
      );
    const loading = cache.load('2026-09', 'CA', fetch);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(cache.get('2026-09', 'CA')).toMatchObject({ loading: true, result: result() });
    finish({ events: [], failedTitles: { count: 0, names: [] } });
    await loading;
    expect(cache.get('2026-09', 'CA')).toMatchObject({ loading: false, result: { events: [] } });
  });

  it('publishes fresh pages and retries the same page without retaining temporary failures', async () => {
    vi.useFakeTimers();
    const cache = new CalendarCache();
    let finish!: (value: CalendarResult) => void;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        events: [],
        failedTitles: { count: 0, names: [] },
        needsRefresh: true,
      })
      .mockResolvedValueOnce({
        ...result('First'),
        nextCursor: { month: '2026-09', offset: 20, version: 'saved' },
      })
      .mockResolvedValueOnce({
        ...result('Stale second'),
        nextCursor: { month: '2026-09', offset: 40, version: 'saved' },
        needsRefresh: true,
        retryAfterMs: 1000,
        failedTitles: { count: 1, names: ['Temporary failure'] },
      })
      .mockResolvedValueOnce({
        ...result('Second'),
        nextCursor: { month: '2026-09', offset: 40, version: 'saved' },
        failedTitles: { count: 1, names: ['Unavailable title'] },
      })
      .mockImplementationOnce(
        () =>
          new Promise<CalendarResult>((resolve) => {
            finish = resolve;
          }),
      );
    const loading = cache.load('2026-09', 'CA', fetch);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(fetch.mock.calls[3][0]).toEqual(fetch.mock.calls[2][0]);
    expect(cache.get('2026-09', 'CA').loading).toBe(true);
    expect(cache.get('2026-09', 'CA').result?.events.map((event) => event.title)).toEqual([
      'First',
      'Second',
    ]);
    finish(result('Third'));
    await loading;
    expect(cache.get('2026-09', 'CA').result?.events).toHaveLength(3);
    expect(cache.get('2026-09', 'CA').result?.needsRefresh).toBeUndefined();
    expect(cache.get('2026-09', 'CA').result?.failedTitles).toEqual({
      count: 1,
      names: ['Unavailable title'],
    });
  });

  it('accepts authoritative partial results without resurrecting removed releases', async () => {
    vi.useFakeTimers();
    const cache = new CalendarCache();
    await cache.load('2026-09', 'US', async () => result());
    const fetch = vi.fn().mockResolvedValue({
      events: [],
      failedTitles: { count: 1, names: ['Unrelated title'] },
      retryAfterMs: 1000,
    });
    const loading = cache.load('2026-09', 'US', fetch, true);
    await vi.runAllTimersAsync();
    await loading;
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(cache.get('2026-09', 'US').result?.events).toEqual([]);
    expect(cache.get('2026-09', 'US').result?.failedTitles.count).toBe(1);
    await cache.load(
      '2026-09',
      'US',
      async () => ({ events: [], failedTitles: { count: 0, names: [] } }),
      true,
    );
    expect(cache.get('2026-09', 'US').result?.events).toEqual([]);
  });

  it('refreshes expired months while keeping the previous schedule visible', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const cache = new CalendarCache();
    const fetch = vi.fn(async () => result());
    await cache.load('2026-09', 'US', fetch);
    now.mockReturnValue(1_000_000 + 5 * 60_000 - 1);
    await cache.load('2026-09', 'US', fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_000_000 + 5 * 60_000);
    const refresh = cache.load('2026-09', 'US', fetch);
    expect(cache.get('2026-09', 'US')).toMatchObject({ result: result(), loading: true });
    await refresh;
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retains recently revisited months when the cache fills up', async () => {
    const cache = new CalendarCache();
    const fetch = vi.fn(async () => result());
    for (let month = 1; month <= 12; month++)
      await cache.load(`2026-${String(month).padStart(2, '0')}`, 'US', fetch);
    await cache.load('2026-01', 'US', fetch);
    await cache.load('2027-01', 'US', fetch);
    expect(cache.get('2026-01', 'US').result).toMatchObject(result());
    expect(cache.get('2026-02', 'US').result).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(13);
  });

  it('protects mounted screens and does not notify them for neighboring months', async () => {
    const cache = new CalendarCache();
    const listener = vi.fn();
    const unsubscribe = cache.subscribe('2025-12', 'US', listener);
    await cache.load('2025-12', 'US', async () => result());
    listener.mockClear();
    for (let month = 1; month <= 12; month++)
      await cache.load(`2026-${String(month).padStart(2, '0')}`, 'US', async () => result());
    expect(cache.get('2025-12', 'US').result).toMatchObject(result());
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
    await cache.load('2027-01', 'US', async () => result());
    expect(cache.get('2025-12', 'US').result).toBeUndefined();
  });

  it('skips past months even when explicitly refreshed', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 9, 15));
    const fetch = vi.fn(async () => result());
    const cache = new CalendarCache();
    await cache.load('2026-09', 'US', fetch, true);
    expect(fetch).not.toHaveBeenCalled();
    expect(cache.get('2026-09', 'US')).toMatchObject({
      loading: false,
      error: false,
      result: { events: [] },
    });
    await cache.load('2026-10', 'US', fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the first library page visible if a later page fails and retries on demand', async () => {
    const cache = new CalendarCache();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ...result(),
        nextCursor: { month: '2026-09', offset: 20, version: 'saved' },
      })
      .mockRejectedValueOnce(new Error('Connection lost'));
    await cache.load('2026-09', 'US', fetch);
    expect(cache.get('2026-09', 'US')).toMatchObject({
      loading: false,
      error: true,
      result: result(),
    });
    await cache.load('2026-09', 'US', async () => result('Recovered'), true);
    expect(cache.get('2026-09', 'US')).toMatchObject({ error: false, result: result('Recovered') });
  });
});
