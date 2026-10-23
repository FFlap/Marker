import { Effect, Result } from 'effect';
import { afterEach, expect, it, vi } from 'vitest';
import { AvatarError, linkAccount, searchTitles, uploadAvatar } from '../../lib/clientEffects';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('cancels a debounced search before issuing the request', async () => {
  vi.useFakeTimers();
  const search = vi.fn(async () => []);
  const controller = new AbortController();
  const pending = Effect.runPromiseExit(searchTitles(search, 300), { signal: controller.signal });
  controller.abort();
  await vi.advanceTimersByTimeAsync(300);
  expect((await pending)._tag).toBe('Failure');
  expect(search).not.toHaveBeenCalled();
});

it('does not accept an account result after the linking timeout', async () => {
  vi.useFakeTimers();
  let resolve!: () => void;
  const linked = new Promise<void>((done) => {
    resolve = done;
  });
  const success = vi.fn();
  const pending = Effect.runPromiseExit(
    linkAccount(() => linked).pipe(Effect.tap(() => Effect.sync(success))),
  );
  await vi.advanceTimersByTimeAsync(15_000);
  expect((await pending)._tag).toBe('Failure');
  resolve();
  await Promise.resolve();
  expect(success).not.toHaveBeenCalled();
});

const avatar = (publish: (id: string) => Promise<unknown>) => ({
  blob: new Blob(['image']),
  contentType: 'image/png',
  uploadPath: async () => '/upload',
  token: async () => 'test-token',
  resolveUrl: (path: string) => `https://example.test${path}`,
  publish,
});

it('starts both credential requests and never publishes malformed upload responses', async () => {
  const publish = vi.fn(async () => undefined);
  let resolvePath!: (path: string) => void;
  const uploadPath = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        resolvePath = resolve;
      }),
  );
  const token = vi.fn(async () => 'test-token');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ storageId: 123 }))),
  );
  const pending = Effect.runPromiseExit(uploadAvatar({ ...avatar(publish), uploadPath, token }));
  expect(uploadPath).toHaveBeenCalledTimes(1);
  expect(token).toHaveBeenCalledTimes(1);
  resolvePath('/upload');
  expect((await pending)._tag).toBe('Failure');
  expect(publish).not.toHaveBeenCalled();
});

it('times out body consumption and aborts the transport without publishing', async () => {
  vi.useFakeTimers();
  let signal: AbortSignal | undefined;
  const publish = vi.fn(async () => undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn((_url, init) => {
      signal = init.signal;
      return Promise.resolve({ status: 200, arrayBuffer: () => new Promise(() => {}) });
    }),
  );
  const pending = Effect.runPromiseExit(uploadAvatar(avatar(publish)));
  await vi.advanceTimersByTimeAsync(30_000);
  expect((await pending)._tag).toBe('Failure');
  expect(signal?.aborted).toBe(true);
  expect(publish).not.toHaveBeenCalled();
});

it('cancels upload staging on view disposal and does not publish its late result', async () => {
  const { ClientOperations, ClientWriteSession } = await import('../../lib/clientOperations');
  const operations = new ClientOperations(new ClientWriteSession('a', () => 'a'));
  let finish!: (value: unknown) => void;
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn((_url, init) => {
      signal = init.signal;
      return Promise.resolve({
        status: 200,
        arrayBuffer: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      });
    }),
  );
  const publish = vi.fn(async () => undefined);
  const success = vi.fn();
  const pending = operations.run(uploadAvatar(avatar(publish)), { success });
  await vi.waitFor(() => expect(finish).toBeDefined());
  operations.dispose();
  finish(new TextEncoder().encode(JSON.stringify({ storageId: 'uploaded' })).buffer);
  await pending;
  expect(signal?.aborted).toBe(true);
  expect(publish).not.toHaveBeenCalled();
  expect(success).not.toHaveBeenCalled();
});

it('does not publish a staged avatar after the live session changes', async () => {
  const { ClientOperations, ClientWriteSession } = await import('../../lib/clientOperations');
  let identity = 'a';
  const operations = new ClientOperations(new ClientWriteSession(identity, () => identity));
  let finish!: (value: unknown) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      status: 200,
      arrayBuffer: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    })),
  );
  const publish = vi.fn(async () => undefined);
  const pending = operations.run(uploadAvatar(avatar(publish)));
  await vi.waitFor(() => expect(finish).toBeDefined());
  identity = 'b';
  finish(new TextEncoder().encode(JSON.stringify({ storageId: 'uploaded' })).buffer);
  await pending;
  expect(publish).not.toHaveBeenCalled();
});

it('uploads once without propagation headers and closes the transport after the body', async () => {
  const publish = vi.fn(async () => undefined);
  const request = vi.fn(async () => new Response(JSON.stringify({ storageId: 'saved' })));
  vi.stubGlobal('fetch', request);
  await Effect.runPromise(uploadAvatar(avatar(publish)));
  expect(request).toHaveBeenCalledTimes(1);
  const init = (request.mock.calls[0] as unknown as [URL, RequestInit])[1];
  expect(new Headers(init.headers).has('b3')).toBe(false);
  expect(new Headers(init.headers).has('traceparent')).toBe(false);
  expect(init.signal?.aborted).toBe(true);
  expect(publish).toHaveBeenCalledWith('saved');
});

it.each([undefined, null, Symbol('failure'), { message: 'original' }])(
  'preserves raw transport failures (%s)',
  async (cause) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(cause)),
    );
    const result = await Effect.runPromise(Effect.result(uploadAvatar(avatar(vi.fn()))));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(AvatarError);
      expect((result.failure as AvatarError).cause).toBe(cause);
    }
  },
);

it('preserves body-read failure identity and aborts without publishing or retrying', async () => {
  const cause = { message: 'body failed' };
  const publish = vi.fn(async () => undefined);
  const request = vi.fn(async (_input: unknown, _init?: RequestInit) => ({
    status: 200,
    arrayBuffer: () => Promise.reject(cause),
  }));
  vi.stubGlobal('fetch', request);
  const result = await Effect.runPromise(Effect.result(uploadAvatar(avatar(publish))));
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) expect((result.failure as AvatarError).cause).toBe(cause);
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(publish).not.toHaveBeenCalled();
});

it('checks the live session immediately before HTTP dispatch', async () => {
  const { ClientOperations, ClientWriteSession } = await import('../../lib/clientOperations');
  let identity = 'a';
  const operations = new ClientOperations(new ClientWriteSession(identity, () => identity));
  const request = vi.fn();
  vi.stubGlobal('fetch', request);
  const publish = vi.fn();
  await operations.run(
    uploadAvatar({
      ...avatar(publish),
      resolveUrl: () => {
        identity = 'b';
        return 'https://example.test/upload';
      },
    }),
  );
  expect(request).not.toHaveBeenCalled();
  expect(publish).not.toHaveBeenCalled();
});
