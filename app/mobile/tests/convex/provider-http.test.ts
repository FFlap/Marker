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
