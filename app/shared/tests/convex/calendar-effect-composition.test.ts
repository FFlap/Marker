import { afterEach, expect, it, vi } from 'vitest';
import { Effect, Exit } from 'effect';
import * as http from '../../convex/providerHttp';
import { loadTitleSchedulesEffect } from '../../convex/calendarProviders';
import { findSeriesEffect } from '../../convex/tvdbSeriesLookup';
import type { ActionCtx } from '../../convex/_generated/server';

const ctx = {
  runQuery: vi.fn(async () => [null]),
  runMutation: vi.fn(async () => true),
} as unknown as ActionCtx;
const schedules = () =>
  loadTitleSchedulesEffect(
    ctx,
    [
      {
        item: { tmdbId: 1, title: 'Movie', mediaType: 'movie', status: 'watchlist' },
        hasSavedSchedule: false,
      },
    ],
    '2026-10-01',
    '2026-10-31',
    'US',
    false,
  );

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('keeps optional expected provider failures as calendar fallback values', async () => {
  vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'test');
  vi.spyOn(http, 'providerFetchEffect').mockReturnValue(
    Effect.fail(new http.ProviderFailure({ provider: 'tmdb', code: 'provider_global_limiter' })),
  );
  await expect(Effect.runPromise(schedules())).resolves.toMatchObject({
    retryAfterMs: 60_000,
    results: [{ failed: true, unavailableTitle: true, events: [] }],
  });
});

it('propagates provider defects through the complete calendar cache and fallback chain', async () => {
  vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'test');
  const defect = new Error('provider implementation defect');
  vi.spyOn(http, 'providerFetchEffect').mockReturnValue(Effect.die(defect));
  await expect(Effect.runPromise(schedules())).rejects.toBe(defect);
});

it('propagates provider interruption through calendar helpers', async () => {
  vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'test');
  vi.spyOn(http, 'providerFetchEffect').mockReturnValue(Effect.interrupt);
  const exit = await Effect.runPromiseExit(schedules());
  expect(Exit.hasInterrupts(exit)).toBe(true);
});

it('does not perform TVDB title fallback after a remote-lookup defect or interruption', async () => {
  const defect = new Error('lookup defect');
  const request = vi.fn(() => Effect.die(defect));
  await expect(Effect.runPromise(findSeriesEffect(request, 1, ['Title'], new Set()))).rejects.toBe(
    defect,
  );
  expect(request).toHaveBeenCalledTimes(1);
  request.mockReturnValue(Effect.interrupt);
  expect(
    Exit.hasInterrupts(
      await Effect.runPromiseExit(findSeriesEffect(request, 1, ['Title'], new Set())),
    ),
  ).toBe(true);
  expect(request).toHaveBeenCalledTimes(2);
});
