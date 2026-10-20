import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadCalendarPages,
  type CalendarCursor,
  type CalendarResult,
} from '../../../shared/calendar';

const args = { startDate: '2026-10-01', endDate: '2026-10-31', region: 'CA' };
const cursor: CalendarCursor = { month: '2026-10', offset: 20, version: 'saved' };
const page = (id: string, nextCursor: CalendarCursor | null = null): CalendarResult => ({
  events: [{ id, title: id, date: '2026-10-02', kind: 'movie' }],
  failedTitles: { count: 0, names: [] },
  nextCursor,
  truncated: nextCursor !== null,
});

afterEach(() => vi.useRealTimers());

describe('complete library calendar loading', () => {
  it('waits through background discovery batches and provider windows without counting them as failures', async () => {
    vi.useFakeTimers();
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
      .mockResolvedValueOnce(page('ready'));
    const loading = loadCalendarPages(fetch, args, () => {});
    await vi.runAllTimersAsync();
    await expect(loading).resolves.toMatchObject({
      events: [{ id: 'ready' }],
      failedTitles: { count: 0, names: [] },
    });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('passes release cursors through without losing events from the same title', async () => {
    const next: CalendarCursor = {
      month: '2026-10',
      offset: 0,
      version: 'saved',
      releaseOffset: 500,
      releaseVersion: 'releases-v1',
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(page('first', next))
      .mockResolvedValueOnce(page('last'));
    const result = await loadCalendarPages(fetch, args, () => {});
    expect(fetch.mock.calls[1][0].cursor).toEqual(next);
    expect(result.events.map((event) => event.id)).toEqual(['first', 'last']);
  });

  it('publishes each page and loads beyond 100 titles without losing failures or duplicating events', async () => {
    const fetch = vi.fn(async ({ cursor: position }: { cursor?: CalendarCursor }) => {
      const offset = position?.offset ?? 0;
      return {
        ...page(
          String(offset),
          offset < 120 ? { month: '2026-10', offset: offset + 20, version: 'saved' } : null,
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

  it('clears a transient refresh requirement when the same page succeeds on retry', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ...page('old'), needsRefresh: true, retryAfterMs: 1000 })
      .mockResolvedValueOnce(page('corrected'));
    const result = loadCalendarPages(fetch, args, () => {});
    await vi.runAllTimersAsync();
    await expect(result).resolves.toMatchObject({ events: [{ id: 'corrected' }] });
    expect((await result).needsRefresh).toBeUndefined();
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
