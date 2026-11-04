import { expect, it, vi, afterEach } from 'vitest';
import { convexTest } from 'convex-test';
import { internal } from '../../convex/_generated/api';
import { batchedProviderBudget } from '../../convex/providerBudget';
import schema from '../../convex/schema';
const modules = import.meta.glob('../../convex/**/*.ts');
afterEach(() => vi.restoreAllMocks());

it('charges concurrent attempts once per prepaid batch and never exceeds the global budget', async () => {
  const t = convexTest({ schema, modules });
  await t.run((ctx) =>
    ctx.db.insert('requestThrottle', { key: 'tvdb-global', windowStart: Date.now(), count: 289 }),
  );
  const reserve = vi.fn(() =>
    t.mutation(internal.providerRateLimits.reserveProviderBudget, { provider: 'tvdb' }),
  );
  const take = batchedProviderBudget(reserve);
  const results = await Promise.all(Array.from({ length: 20 }, () => take()));
  expect(results.filter(Boolean)).toHaveLength(11);
  expect(await take()).toBe(false);
  const row = await t.run((ctx) => ctx.db.query('requestThrottle').first());
  expect(row?.count).toBe(300);
  // 8 slots, then three individual slots, then one exhausted reservation.
  expect(reserve).toHaveBeenCalledTimes(5);
});

it('expires unused slots with the original distributed window', async () => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const reserve = vi.fn(async () => ({ amount: 8, expiresAt: now + 500 }));
  const take = batchedProviderBudget(reserve);
  expect(await take()).toBe(true);
  now += 501;
  expect(await take()).toBe(true);
  expect(reserve).toHaveBeenCalledTimes(2);
});

it('refreshes a rejected cached TVDB token and keeps its replacement private to backend functions', async () => {
  const t = convexTest({ schema, modules });
  vi.stubEnv('TVDB_API_KEY', 'credential-test-key');
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode('credential-test-key'),
  );
  const keyHash = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
  await t.mutation(internal.providerCredentials.put, {
    keyHash,
    token: 'rejected',
    expiresAt: Date.now() + 1_000_000,
  });
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/login')) return Response.json({ data: { token: 'replacement' } });
    if (new Headers(init?.headers).get('authorization') === 'Bearer rejected')
      return new Response('{}', { status: 401 });
    return Response.json({ data: { characters: [] } });
  });
  vi.stubGlobal('fetch', fetchMock);
  try {
    await expect(
      t.action(internal.tvdb.getCharacterArtwork, {
        tmdbId: 91,
        tvdbId: 555,
        title: 'Known title',
        mediaType: 'tv',
      }),
    ).resolves.toEqual([]);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/login'))).toHaveLength(1);
    expect(await t.query(internal.providerCredentials.get, { keyHash })).toMatchObject({
      token: 'replacement',
    });
    // A concurrent failure from the old token cannot remove the new one.
    await t.mutation(internal.providerCredentials.invalidate, { keyHash, token: 'rejected' });
    expect(await t.query(internal.providerCredentials.get, { keyHash })).toMatchObject({
      token: 'replacement',
    });
  } finally {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
