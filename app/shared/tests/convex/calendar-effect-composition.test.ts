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
  vi.unstubAllGlobals();
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

it.each(['budget', 'http'] as const)(
  'drains a cancelled calendar batch while awaiting %s',
  async (phase) => {
    vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'test');
    const caller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let releaseBudget!: () => void;
    const budget = new Promise<void>((resolve) => {
      releaseBudget = resolve;
    });
    let httpSignal: AbortSignal | null | undefined;
    const fetch = vi.fn((_url: unknown, init: RequestInit) => {
      httpSignal = init.signal;
      entered();
      return new Promise<Response>((_resolve, reject) => {
        httpSignal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    });
    vi.stubGlobal('fetch', fetch);
    const runMutation = vi.fn(async () => {
      if (phase === 'budget') {
        entered();
        await budget;
      }
      return true;
    });
    const context = {
      runQuery: async (_ref: unknown, { keys }: { keys: string[] }) =>
        keys.map((key) =>
          key === 'calendar:tv:v2:88'
            ? {
                entry: { kind: 'calendarTvSchedule', value: [{ season: 1 }, { season: 2 }] },
                refreshedAt: Date.now(),
              }
            : null,
        ),
      runMutation,
    } as unknown as ActionCtx;
    let finished = false;
    const pending = Effect.runPromiseExit(
      loadTitleSchedulesEffect(
        context,
        [
          {
            item: { tmdbId: 88, title: 'Show', mediaType: 'tv', status: 'watching' },
            hasSavedSchedule: false,
          },
        ],
        '2026-10-01',
        '2026-10-31',
        'US',
        false,
      ),
      { signal: caller.signal },
    ).then((exit) => {
      finished = true;
      return exit;
    });
    try {
      await started;
      caller.abort();
      if (phase === 'budget') {
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(finished).toBe(false);
        releaseBudget();
      }
      expect(Exit.hasInterrupts(await pending)).toBe(true);
      expect(runMutation).toHaveBeenCalledTimes(1);
      if (phase === 'budget') expect(fetch).not.toHaveBeenCalled();
      else {
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(httpSignal?.aborted).toBe(true);
      }
    } finally {
      caller.abort();
      releaseBudget();
      await pending;
    }
  },
);

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
