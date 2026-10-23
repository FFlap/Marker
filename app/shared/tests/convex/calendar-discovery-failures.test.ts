import { convexTest } from 'convex-test';
import { getFunctionName } from 'convex/server';
import { Effect } from 'effect';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import schema from '../../convex/schema';
import { internal } from '../../convex/_generated/api';
import type { ActionCtx } from '../../convex/_generated/server';
import { continueDiscovery, ensureMonth } from '../../convex/calendarDiscovery';
import * as http from '../../convex/providerHttp';

const modules = import.meta.glob('../../convex/**/*.ts');
const job = { month: '2026-10', region: 'tv', token: 'discovery' };
const handler = (
  continueDiscovery as unknown as {
    _handler: (ctx: ActionCtx, args: typeof job) => Promise<null>;
  }
)._handler;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 9, 4));
  vi.stubEnv('TMDB_API_READ_ACCESS_TOKEN', 'test');
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function fixture(budget: () => Promise<boolean>) {
  const t = convexTest(schema, modules);
  await t.mutation(internal.calendarCatalog.claim, job);
  const runMutation = vi.fn<ActionCtx['runMutation']>(async (ref, args) => {
    if (getFunctionName(ref) === 'providerRateLimits:consumeGlobalProviderLimiter') return budget();
    return t.mutation(ref, args);
  });
  const ctx = { runQuery: t.query, runMutation } as unknown as ActionCtx;
  return { t, ctx, runMutation };
}

it.each([
  { name: 'denied budget', budget: async () => false, message: 'provider_global_limiter' },
  {
    name: 'rejected budget RPC',
    budget: async () => {
      throw new Error('Budget service unavailable');
    },
    message: 'Budget service unavailable',
  },
  {
    name: 'empty budget RPC error',
    budget: async () => {
      throw new Error('');
    },
    message: 'Release discovery failed',
  },
  {
    name: 'non-Error budget RPC rejection',
    budget: async () => {
      throw null;
    },
    message: 'Release discovery failed',
  },
])('persists $name and surfaces it after retry exhaustion', async ({ budget, message }) => {
  const { t, ctx, runMutation } = await fixture(budget);
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  for (let attempt = 1; attempt <= 5; attempt++) {
    await expect(handler(ctx, job)).resolves.toBeNull();
    const failure = runMutation.mock.calls.findLast(
      ([ref]) => getFunctionName(ref) === 'calendarRefresh:failed',
    );
    expect(failure?.[1]).toMatchObject({
      ...job,
      permanent: false,
      message: expect.stringContaining(message),
    });
    const row = await t.run((ctx) => ctx.db.query('calendarMonths').unique());
    expect(row?.discoveryFailures).toBe(attempt);
    if (attempt < 5) expect(row?.leaseToken).toBe(job.token);
    else expect(row?.leaseToken).toBeUndefined();
  }
  const metadata = await t.query(internal.calendarCatalog.metadata, {
    month: job.month,
    region: job.region,
  });
  expect(metadata?.error).toContain(message);
  expect(metadata?.retryAt).toBeGreaterThan(Date.now());
  await expect(ensureMonth(ctx, job.month, 'CA', 'tv')).rejects.toThrow(metadata!.error);
  expect(fetch).not.toHaveBeenCalled();
});

it('propagates provider defects without recording a retryable discovery failure', async () => {
  const { t, ctx, runMutation } = await fixture(async () => true);
  const defect = new Error('Discovery implementation defect');
  vi.spyOn(http, 'providerFetchEffect').mockReturnValue(Effect.die(defect));
  await expect(handler(ctx, job)).rejects.toBe(defect);
  expect(runMutation).not.toHaveBeenCalled();
  const row = await t.run((ctx) => ctx.db.query('calendarMonths').unique());
  expect(row?.discoveryFailures).toBe(0);
  expect(row?.discoveryError).toBeUndefined();
});
