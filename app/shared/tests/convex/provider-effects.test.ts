import { afterEach, expect, it, vi } from 'vitest';
import { ConvexError } from 'convex/values';
import { Effect } from 'effect';
import { attempt, providerOutcome, runActionEffect } from '../../convex/actionEffects';
import {
  decodeProviderObject,
  providerFetch,
  providerFetchEffect,
} from '../../convex/providerHttp';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('preserves ConvexError identity and data at the action boundary', async () => {
  const error = new ConvexError({ code: 'stale_epoch', retryable: true });
  await expect(runActionEffect(attempt(() => Promise.reject(error)))).rejects.toBe(error);
  await expect(runActionEffect(providerOutcome(Effect.fail(error)))).resolves.toEqual({
    ok: false,
    error,
  });
});

it('honors Retry-After and caps its delay', async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'retry-after': '60' } }))
    .mockResolvedValueOnce(new Response('{}'));
  vi.stubGlobal('fetch', fetch);
  const pending = providerFetch(
    'https://example.test',
    {},
    { provider: 'tmdb', operation: '/test' },
  );
  await vi.advanceTimersByTimeAsync(1999);
  expect(fetch).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await expect(pending).resolves.toMatchObject({ status: 200 });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('does not replace HTTP errors with body cleanup errors', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          cancel() {
            throw new Error('cleanup failed');
          },
        }),
        { status: 503 },
      ),
    ),
  );
  await expect(
    providerFetch('https://example.test', {}, { provider: 'tmdb', operation: '/test', retries: 0 }),
  ).rejects.toMatchObject({ data: { code: 'upstream', status: 503 } });
});

it('enforces the deadline even if fetch ignores AbortSignal', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | null | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((_url, init: RequestInit) => {
      signal = init.signal;
      return new Promise(() => {});
    }),
  );
  const pending = expect(
    providerFetch(
      'https://example.test',
      {},
      { provider: 'tmdb', operation: '/test', timeoutMs: 20, retries: 0 },
    ),
  ).rejects.toMatchObject({ data: { code: 'timeout' } });
  await vi.advanceTimersByTimeAsync(20);
  await pending;
  expect(signal?.aborted).toBe(true);
});

it('aborts active sibling HTTP work before returning a parallel failure', async () => {
  let signal: AbortSignal | null | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((_url, init: RequestInit) => {
      signal = init.signal;
      return new Promise(() => {});
    }),
  );
  const error = new Error('required guide failed');
  await expect(
    runActionEffect(
      Effect.all(
        [
          providerFetchEffect('https://example.test', {}, { provider: 'tvdb', operation: '/test' }),
          Effect.sleep(5).pipe(Effect.andThen(Effect.fail(error))),
        ],
        { concurrency: 2 },
      ),
    ),
  ).rejects.toBe(error);
  expect(signal?.aborted).toBe(true);
});

it('never reserves budget for an already cancelled request', async () => {
  const controller = new AbortController();
  controller.abort();
  const beforeRequest = vi.fn().mockResolvedValue(true);
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  await expect(
    providerFetch(
      'https://example.test',
      { signal: controller.signal },
      {
        provider: 'tmdb',
        operation: '/test',
        beforeRequest,
      },
    ),
  ).rejects.toMatchObject({ data: { code: 'upstream' } });
  expect(beforeRequest).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['null', '[]', '42', 'broken JSON'])(
  'rejects malformed provider envelopes without exposing their contents: %s',
  async (body) => {
    await expect(runActionEffect(decodeProviderObject(new Response(body), 'tvdb'))).rejects.toThrow(
      'TVDB returned malformed data',
    );
  },
);

it('drains an already-started Convex call before a sibling failure leaves the action', async () => {
  let completed = false;
  const error = new Error('sibling failed');
  await expect(
    runActionEffect(
      Effect.all(
        [
          attempt(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            completed = true;
          }),
          Effect.fail(error),
        ],
        { concurrency: 2 },
      ),
    ),
  ).rejects.toBe(error);
  expect(completed).toBe(true);
});

it('preserves arbitrary budget failures without HTTP retries or network-error logs', async () => {
  const cause = new Error('budget backend bug');
  const beforeRequest = vi.fn().mockRejectedValue(cause);
  const fetch = vi.fn();
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.stubGlobal('fetch', fetch);
  try {
    await expect(
      providerFetch(
        'https://example.test',
        {},
        {
          provider: 'tmdb',
          operation: '/test',
          beforeRequest,
        },
      ),
    ).rejects.toBe(cause);
    expect(beforeRequest).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      '[metadata-provider]',
      expect.stringContaining('"outcome":"budget-error"'),
    );
    expect(log).not.toHaveBeenCalledWith(
      '[metadata-provider]',
      expect.stringContaining('network-error'),
    );
  } finally {
    log.mockRestore();
  }
});

it('preserves the original budget conflict after its bounded retry is exhausted', async () => {
  vi.useFakeTimers();
  const cause = new Error(
    'Documents read from or written to the "requestThrottle" table changed while this mutation was being run and on every subsequent retry.',
  );
  const beforeRequest = vi.fn().mockRejectedValue(cause);
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const assertion = expect(
    providerFetch(
      'https://example.test',
      {},
      {
        provider: 'tmdb',
        operation: '/test',
        beforeRequest,
      },
    ),
  ).rejects.toBe(cause);
  await vi.runAllTimersAsync();
  await assertion;
  expect(beforeRequest).toHaveBeenCalledTimes(2);
  expect(fetch).not.toHaveBeenCalled();
});

it('keeps the deadline and abort active while consuming the response body', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | null | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init: RequestInit) => {
      signal = init.signal;
      return new Response(new ReadableStream({ start() {} }));
    }),
  );
  const assertion = expect(
    providerFetch(
      'https://example.test',
      {},
      {
        provider: 'tmdb',
        operation: '/test',
        timeoutMs: 20,
        retries: 0,
      },
    ),
  ).rejects.toMatchObject({ data: { code: 'timeout' } });
  await vi.advanceTimersByTimeAsync(20);
  await assertion;
  expect(signal?.aborted).toBe(true);
});

it('propagates caller abort during the body and removes its listener without retry', async () => {
  const caller = new AbortController();
  const remove = vi.spyOn(caller.signal, 'removeEventListener');
  let bodyStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    bodyStarted = resolve;
  });
  const fetch = vi.fn(
    async (_url, init: RequestInit) =>
      new Response(
        new ReadableStream({
          start(stream) {
            init.signal!.addEventListener('abort', () => stream.error(new Error('aborted')));
            bodyStarted();
          },
        }),
      ),
  );
  vi.stubGlobal('fetch', fetch);
  const assertion = expect(
    providerFetch(
      'https://example.test',
      { signal: caller.signal },
      {
        provider: 'tvdb',
        operation: '/test',
      },
    ),
  ).rejects.toMatchObject({ data: { code: 'timeout' } });
  await started;
  caller.abort();
  await assertion;
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
});

it('preserves request options and response details without adding propagation headers', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response('payload', {
        status: 202,
        statusText: 'Queued',
        headers: { 'x-provider': 'test' },
      }),
  );
  vi.stubGlobal('fetch', fetch);
  const response = await providerFetch(
    'https://example.test/path?q=1',
    {
      method: 'POST',
      body: 'request',
      redirect: 'manual',
      headers: { authorization: 'Bearer test', 'content-type': 'text/plain' },
    },
    { provider: 'tvdb', operation: '/test' },
  );
  expect(fetch).toHaveBeenCalledWith(
    'https://example.test/path?q=1',
    expect.objectContaining({
      method: 'POST',
      body: 'request',
      redirect: 'manual',
      headers: expect.objectContaining({
        authorization: 'Bearer test',
        'content-type': 'text/plain',
      }),
    }),
  );
  const headers = new Headers(fetch.mock.calls[0][1]?.headers);
  expect(headers.has('b3')).toBe(false);
  expect(headers.has('traceparent')).toBe(false);
  expect(response.status).toBe(202);
  expect(response.statusText).toBe('Queued');
  expect(response.headers.get('x-provider')).toBe('test');
  expect(await response.text()).toBe('payload');
});

it('does not retry POST even when a retry count is supplied', async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 503 }));
  const beforeRequest = vi.fn(async () => true);
  vi.stubGlobal('fetch', fetch);
  await expect(
    providerFetch(
      'https://example.test',
      { method: 'POST', body: '{}' },
      {
        provider: 'tvdb',
        operation: '/login',
        retries: 3,
        beforeRequest,
      },
    ),
  ).rejects.toMatchObject({ data: { status: 503 } });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(beforeRequest).toHaveBeenCalledTimes(1);
});

it.each([null, undefined, 'failure', { message: 'opaque' }])(
  'preserves arbitrary original RPC and budget failure identity: %s',
  async (cause) => {
    await expect(runActionEffect(attempt(() => Promise.reject(cause)))).rejects.toBe(cause);
    await expect(
      providerFetch(
        'https://example.test',
        {},
        {
          provider: 'tmdb',
          operation: '/test',
          beforeRequest: () => Promise.reject(cause),
        },
      ),
    ).rejects.toBe(cause);
  },
);
