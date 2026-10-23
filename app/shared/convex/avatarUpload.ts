import { Effect } from 'effect';
import { attempt, providerOutcome, runActionEffect } from './actionEffects';
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

export const upload = httpAction((ctx, request) =>
  runActionEffect(
    Effect.gen(function* () {
      const identity = yield* attempt(() => ctx.auth.getUserIdentity());
      if (!identity) return json({ error: 'unauthorized' }, 401);
      const userId = yield* attempt(() =>
        ctx.runQuery(internal.clerkAuth.userIdForIdentity, {
          subject: identity.subject,
        }),
      );
      if (!userId) return json({ error: 'account-not-linked' }, 409);
      const uploadId = new URL(request.url).searchParams.get('uploadId');
      if (!uploadId) return json({ error: 'invalid-upload' }, 400);
      const pending = yield* providerOutcome(
        attempt(() =>
          ctx.runMutation(internal.profiles.pendingAvatarUpload, {
            userId,
            uploadId: uploadId as Id<'avatarUploads'>,
          }),
        ),
      );
      if (!pending.ok) return json({ error: 'invalid-upload' }, 400);
      const contentType = request.headers
        .get('content-type')
        ?.split(';', 1)[0]
        ?.toLocaleLowerCase();
      if (!contentType || !IMAGE_TYPES.has(contentType))
        return json({ error: 'invalid-image' }, 415);
      const contentLengthHeader = request.headers.get('content-length')?.trim();
      if (!contentLengthHeader || !/^[1-9]\d*$/.test(contentLengthHeader))
        return json({ error: 'invalid-image' }, 400);
      const contentLength = Number(contentLengthHeader);
      if (!Number.isSafeInteger(contentLength) || contentLength > MAX_AVATAR_BYTES)
        return json({ error: 'invalid-image' }, 413);
      const blob = yield* attempt(() => request.blob());
      if (blob.size > MAX_AVATAR_BYTES) return json({ error: 'invalid-image' }, 413);
      let published = false;
      return yield* Effect.acquireUseRelease(
        attempt(() => ctx.storage.store(blob)),
        (storageId) =>
          Effect.gen(function* () {
            const completed = yield* providerOutcome(
              attempt(async () => {
                await ctx.runMutation(internal.profiles.completeAvatarUpload, {
                  userId,
                  uploadId: uploadId as Id<'avatarUploads'>,
                  storageId,
                });
                // Record publication before the non-cancellable RPC yields back.
                published = true;
              }),
            );
            if (!completed.ok) return json({ error: 'invalid-upload' }, 400);
            return json({ storageId }, 200);
          }),
        (storageId) =>
          published
            ? Effect.void
            : attempt(() => ctx.storage.delete(storageId)).pipe(
                // Cleanup must not replace the failed upload's response.
                Effect.catch(() => Effect.void),
              ),
      );
    }),
  ),
);
