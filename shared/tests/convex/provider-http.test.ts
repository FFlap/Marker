import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerFetch } from '../../convex/providerHttp';

describe('provider HTTP reliability', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retries a retryable provider response and returns the successful attempt', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const beforeRequest = vi.fn().mockResolvedValue(true);
    const request = providerFetch(
      'https://example.test/title',
      {},
      {
        provider: 'tmdb',
        operation: '/title',
        retries: 1,
        timeoutMs: 1_000,
        beforeRequest,
      },
    );
    await vi.runAllTimersAsync();

    await expect(request).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(beforeRequest).toHaveBeenCalledTimes(2);
  });

  it('recovers from a rate-limiter write conflict before sending the provider request', async () => {
    vi.useFakeTimers();
    const beforeRequest = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          'Documents read from or written to the "requestThrottle" table changed while this mutation was being run and on every subsequent retry.',
        ),
      )
      .mockResolvedValue(true);
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const request = providerFetch(
      'https://example.test/calendar',
      {},
      {
        provider: 'tmdb',
        operation: '/calendar',
        beforeRequest,
      },
    );
    await vi.runAllTimersAsync();
    await expect(request).resolves.toMatchObject({ status: 200 });
    expect(beforeRequest).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never bypasses exhausted provider budget', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      providerFetch(
        'https://example.test/calendar',
        {},
        {
          provider: 'tmdb',
          operation: '/calendar',
          beforeRequest: async () => false,
        },
      ),
    ).rejects.toMatchObject({ data: { code: 'provider_global_limiter' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['status', 'body'] as const)(
    'does not repeat POST after a response %s failure',
    async (failure) => {
      const response =
        failure === 'status'
          ? new Response('{}', { status: 503 })
          : new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(new Error('Body interrupted'));
                },
              }),
            );
      const fetchMock = vi.fn().mockResolvedValue(response);
      vi.stubGlobal('fetch', fetchMock);
      await expect(
        providerFetch(
          'https://example.test/login',
          { method: 'POST', body: '{}' },
          {
            provider: 'tvdb',
            operation: '/login',
            retries: 1,
          },
        ),
      ).rejects.toMatchObject({ data: { code: 'upstream', provider: 'tvdb' } });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('aborts a stalled provider request at the configured deadline', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted', 'AbortError')),
            );
          }),
      ),
    );

    const request = providerFetch(
      'https://example.test/season',
      {},
      {
        provider: 'tvdb',
        operation: '/season',
        retries: 0,
        timeoutMs: 50,
      },
    );
    const assertion = expect(request).rejects.toMatchObject({
      data: { code: 'timeout', provider: 'tvdb', retryable: true },
    });
    await vi.advanceTimersByTimeAsync(50);

    await assertion;
  });
});

it('keeps the timeout active while a successful response body is stalled', async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener('abort', () =>
                controller.error(new DOMException('The operation was aborted', 'AbortError')),
              );
            },
          }),
          { status: 200 },
        ),
    ),
  );
  try {
    const request = providerFetch(
      'https://example.test/title',
      {},
      {
        provider: 'tmdb',
        operation: '/title',
        retries: 0,
        timeoutMs: 50,
      },
    );
    const assertion = expect(request).rejects.toMatchObject({
      data: { code: 'timeout', provider: 'tmdb', retryable: true },
    });
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
