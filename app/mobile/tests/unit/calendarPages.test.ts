import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadCalendarPages,
  type CalendarCursor,
  type CalendarResult,
} from '../../../shared/calendar';

const args = { startDate: '2026-10-01', endDate: '2026-10-31', region: 'CA' };
const cursor: CalendarCursor = { status: 'watchlist', after: 'next' };
const page = (id: string, nextCursor: CalendarCursor | null = null): CalendarResult => ({
  events: [{ id, title: id, date: '2026-10-02', kind: 'movie' }],
  failedTitles: { count: 0, names: [] },
  nextCursor,
  truncated: nextCursor !== null,
});

afterEach(() => vi.useRealTimers());

describe('complete library calendar loading', () => {
  it('publishes each page and loads beyond 100 titles without losing failures or duplicating events', async () => {
    const fetch = vi.fn(async ({ cursor: position }: { cursor?: CalendarCursor }) => {
      const offset = Number(position && 'after' in position ? position.after : 0);
      return {
        ...page(
          String(offset),
          offset < 120 ? { status: 'watching' as const, after: String(offset + 20) } : null,
        ),
        failedTitles: {
          count: offset === 20 ? 1 : 0,
          names: offset === 20 ? ['Unavailable title'] : [],
        },
      };
    });
    const progress = vi.fn();
    const result = await loadCalendarPages(fetch, args, progress);
    expect(fetch).toHaveBeenCalledTimes(7);
    expect(progress.mock.calls[0][0].events).toHaveLength(1);
    expect(result.events.map((event) => event.id)).toContain('120');
    expect(result.failedTitles).toEqual({ count: 1, names: ['Unavailable title'] });
    expect(result.truncated).toBe(false);
  });

  it('retains the refresh requirement across saved library pages', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ...page('first', cursor), needsRefresh: true })
      .mockResolvedValueOnce({ ...page('second'), needsRefresh: false });
    const result = await loadCalendarPages(fetch, { ...args, cachedOnly: true }, () => {});
    expect(result.needsRefresh).toBe(true);
    expect(result.events).toHaveLength(2);
    expect(fetch.mock.calls.every(([request]) => request.cachedOnly === true)).toBe(true);
  });

  it('waits for provider budget and retries the same page before continuing', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ...page('first', cursor),
        failedTitles: { count: 1, names: ['Temporary failure'] },
        retryAfterMs: 1000,
      })
      .mockResolvedValueOnce(page('first', cursor))
      .mockResolvedValueOnce(page('second'));
    const result = loadCalendarPages(fetch, args, () => {});
    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({
      events: [{ id: 'first' }, { id: 'second' }],
      failedTitles: { count: 0, names: [] },
    });
    expect(fetch.mock.calls[0][0]).toEqual(args);
    expect(fetch.mock.calls[1][0]).toEqual(args);
    expect(fetch.mock.calls[2][0]).toEqual({ ...args, cursor });
  });

  it('stops retrying a persistently limited page and reports the incomplete result', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValue({
      ...page('cached'),
      retryAfterMs: 1000,
      failedTitles: { count: 1, names: ['Unavailable'] },
    });
    const result = loadCalendarPages(fetch, args, () => {});
    await vi.runAllTimersAsync();
    await expect(result).resolves.toMatchObject({ failedTitles: { count: 1 } });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('does not silently accept a capped response from an old backend', async () => {
    await expect(
      loadCalendarPages(
        async () => ({ ...page('first'), truncated: true }),
        args,
        () => {},
      ),
    ).rejects.toThrow('full library');
  });
});
