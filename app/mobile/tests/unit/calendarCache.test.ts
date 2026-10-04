import { afterEach, describe, expect, it, vi } from 'vitest';
import { CalendarCache, monthRange } from '../../src/lib/calendarCache';

const result = (title = 'Arrival') => ({
  events: [{ id: title, date: '2026-09-02', kind: 'movie' as const, title }],
  failedTitles: { count: 0, names: [] },
});

afterEach(() => vi.restoreAllMocks());

describe('shared calendar schedules', () => {
  it('uses local month bounds including leap years and year transitions', () => {
    expect(monthRange('2028-02')).toEqual({ startDate: '2028-02-01', endDate: '2028-02-29' });
    expect(monthRange('2026-12').endDate).toBe('2026-12-31');
  });

  it('deduplicates in-flight requests and keeps regions and sessions separate', async () => {
    const cache = new CalendarCache();
    let resolve!: (value: ReturnType<typeof result>) => void;
    const fetch = vi.fn(
      () =>
        new Promise<ReturnType<typeof result>>((done) => {
          resolve = done;
        }),
    );
    const first = cache.load('2026-09', 'CA', fetch);
    const second = cache.load('2026-09', 'CA', fetch);
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
    resolve(result());
    await Promise.all([first, second]);
    await cache.load('2026-09', 'CA', fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cache.get('2026-09', 'CA').result?.events).toHaveLength(1);
    expect(cache.get('2026-09', 'US').result).toBeUndefined();
    expect(new CalendarCache().get('2026-09', 'CA').result).toBeUndefined();
  });

  it('retains releases throughout a refresh and after failure, then recovers', async () => {
    const cache = new CalendarCache();
    await cache.load('2026-09', 'US', async () => result());
    const refresh = cache.load(
      '2026-09',
      'US',
      async () => {
        throw new Error('offline');
      },
      true,
    );
    expect(cache.get('2026-09', 'US')).toMatchObject({ loading: true, result: result() });
    await refresh;
    expect(cache.get('2026-09', 'US')).toMatchObject({
      loading: false,
      error: true,
      result: result(),
    });
    await cache.load('2026-09', 'US', async () => result('Updated'), true);
    expect(cache.get('2026-09', 'US')).toMatchObject({ error: false, result: result('Updated') });
  });

  it('does not let an old request overwrite a different month', async () => {
    const cache = new CalendarCache();
    let resolve!: (value: ReturnType<typeof result>) => void;
    const old = cache.load(
      '2026-09',
      'US',
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await cache.load('2026-10', 'US', async () => result('October'));
    resolve(result('September'));
    await old;
    expect(cache.get('2026-10', 'US').result?.events[0].title).toBe('October');
    expect(cache.get('2026-09', 'US').result?.events[0].title).toBe('September');
  });

  it('accepts authoritative partial results without resurrecting removed releases', async () => {
    const cache = new CalendarCache();
    await cache.load('2026-09', 'US', async () => result());
    await cache.load(
      '2026-09',
      'US',
      async () => ({ events: [], failedTitles: { count: 1, names: ['Unrelated title'] } }),
      true,
    );
    expect(cache.get('2026-09', 'US').result?.events).toEqual([]);
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
    expect(cache.get('2026-01', 'US').result).toEqual(result());
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
    expect(cache.get('2025-12', 'US').result).toEqual(result());
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
    await cache.load('2027-01', 'US', async () => result());
    expect(cache.get('2025-12', 'US').result).toBeUndefined();
  });
});
