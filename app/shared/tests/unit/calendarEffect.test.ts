import * as Effect from 'effect/Effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CalendarPaginationError,
  CalendarRequestError,
  currentCalendarMonth,
  loadCalendarPages,
  loadCalendarPagesEffect,
  type CalendarResult,
} from '../../lib/calendar';

const window = { startDate: '2026-11-01', endDate: '2026-11-30', region: 'CA' };
const empty: CalendarResult = { events: [], failedTitles: { count: 0, names: [] } };
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('calendar effects', () => {
  it.each([
    ['America/Edmonton', '2026-11-01T00:30:00Z', '2026-10'],
    ['Pacific/Auckland', '2026-10-31T12:30:00Z', '2026-11'],
  ])('uses the local month in %s across a UTC month boundary', (zone, instant, month) => {
    vi.stubEnv('TZ', zone);
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(instant));
    expect(currentCalendarMonth()).toBe(month);
  });

  it('retains the request cause as a typed failure at the Promise boundary', async () => {
    const cause = new Error('offline');
    const pending = loadCalendarPages(
      () => Promise.reject(cause),
      window,
      () => {},
    );
    await expect(pending).rejects.toBeInstanceOf(CalendarRequestError);
    await expect(pending).rejects.toMatchObject({ cause });
  });

  it('rejects a repeated cursor without continuing to request the same page', async () => {
    const fetch = vi.fn(async () => ({
      ...empty,
      nextCursor: { month: '2026-11', offset: 1, version: 'current' },
    }));
    await expect(loadCalendarPages(fetch, window, () => {})).rejects.toBeInstanceOf(
      CalendarPaginationError,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('interrupts polling without another request or a leftover timer', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetch = vi.fn(async () => ({ ...empty, refreshPending: true, retryAfterMs: 60_000 }));
    const progress = vi.fn();
    const pending = loadCalendarPages(fetch, window, progress, { signal: controller.signal });
    const rejection = expect(pending).rejects.toBeInstanceOf(Error);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    controller.abort();
    await rejection;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(progress).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('forwards interruption to the in-flight transport', async () => {
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const pending = loadCalendarPages(
      (_args, options) => {
        requestSignal = options?.signal;
        return new Promise<CalendarResult>(() => {});
      },
      window,
      () => {},
      { signal: controller.signal },
    );
    const rejection = expect(pending).rejects.toBeInstanceOf(Error);
    controller.abort();
    await rejection;
    expect(requestSignal?.aborted).toBe(true);
  });

  it('keeps pagination state local to each execution of the same effect', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ...empty, failedTitles: { count: 1, names: ['Unavailable'] } })
      .mockResolvedValueOnce(empty);
    const effect = loadCalendarPagesEffect(fetch, window, () => {});
    expect((await Effect.runPromise(effect)).failedTitles.count).toBe(1);
    expect((await Effect.runPromise(effect)).failedTitles.count).toBe(0);
  });
});
