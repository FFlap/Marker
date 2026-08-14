import type { Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { httpAction } from './_generated/server';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

const headers = {
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
  'Content-Type': 'application/json',
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers });

export const options = httpAction(async () => new Response(null, { status: 204, headers }));

export const upload = httpAction(async (ctx, request) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return json({ error: 'unauthorized' }, 401);
  const userId = await ctx.runQuery(internal.clerkAuth.userIdForIdentity, {
    subject: identity.subject,
  });
  if (!userId) return json({ error: 'account-not-linked' }, 409);
  const uploadId = new URL(request.url).searchParams.get('uploadId');
  if (!uploadId) return json({ error: 'invalid-upload' }, 400);
  try {
    await ctx.runMutation(internal.profiles.pendingAvatarUpload, {
      userId,
      uploadId: uploadId as Id<'avatarUploads'>,
    });
  } catch {
    return json({ error: 'invalid-upload' }, 400);
  }
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.toLocaleLowerCase();
  if (!contentType || !IMAGE_TYPES.has(contentType)) return json({ error: 'invalid-image' }, 415);
  const contentLengthHeader = request.headers.get('content-length')?.trim();
  if (!contentLengthHeader || !/^[1-9]\d*$/.test(contentLengthHeader))
    return json({ error: 'invalid-image' }, 400);
  const contentLength = Number(contentLengthHeader);
  if (!Number.isSafeInteger(contentLength) || contentLength > MAX_AVATAR_BYTES)
    return json({ error: 'invalid-image' }, 413);
  const blob = await request.blob();
  if (blob.size > MAX_AVATAR_BYTES) return json({ error: 'invalid-image' }, 413);
  const storageId = await ctx.storage.store(blob);
  try {
    await ctx.runMutation(internal.profiles.completeAvatarUpload, {
      userId,
      uploadId: uploadId as Id<'avatarUploads'>,
      storageId,
    });
  } catch {
    await ctx.storage.delete(storageId);
    return json({ error: 'invalid-upload' }, 400);
  }
  return json({ storageId }, 200);
});
