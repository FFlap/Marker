import { expect, it, vi } from 'vitest';
import type { ActionCtx } from '../../convex/_generated/server';
import { upload } from '../../convex/avatarUpload';

// Exercise HTTP resource ownership independently from the database ownership integration tests.
const handler = (
  upload as unknown as {
    _handler: (ctx: ActionCtx, request: Request) => Promise<Response>;
  }
)._handler;

it.each([false, true])(
  'preserves the failed publication response when cleanup fails: %s',
  async (cleanupFails) => {
    const remove = cleanupFails
      ? vi.fn().mockRejectedValue(new Error('storage unavailable'))
      : vi.fn().mockResolvedValue(undefined);
    const ctx = {
      auth: { getUserIdentity: async () => ({ subject: 'owner' }) },
      runQuery: async () => 'user-id',
      runMutation: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('publication rejected')),
      storage: { store: async () => 'storage-id', delete: remove },
    } as unknown as ActionCtx;
    const response = await handler(
      ctx,
      new Request('https://example.test/avatar/upload?uploadId=upload-id', {
        method: 'POST',
        headers: { 'content-type': 'image/png', 'content-length': '5' },
        body: 'image',
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid-upload' });
    expect(remove).toHaveBeenCalledExactlyOnceWith('storage-id');
  },
);

it('keeps the stored file after successful publication', async () => {
  const remove = vi.fn();
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: 'owner' }) },
    runQuery: async () => 'user-id',
    runMutation: async () => undefined,
    storage: { store: async () => 'storage-id', delete: remove },
  } as unknown as ActionCtx;
  const response = await handler(
    ctx,
    new Request('https://example.test/avatar/upload?uploadId=upload-id', {
      method: 'POST',
      headers: { 'content-type': 'image/png', 'content-length': '5' },
      body: 'image',
    }),
  );
  expect(response.status).toBe(200);
  expect(remove).not.toHaveBeenCalled();
});
