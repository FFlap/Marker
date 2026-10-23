import { Effect, Option, Schema } from 'effect';
import { actionFailureCause, attempt, providerOutcome, runActionEffect } from './actionEffects';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';

const MAX_BODY_BYTES = 4096;

function allowedExtensionOrigins() {
  return new Set(
    (process.env.EXTENSION_ORIGINS ?? '')
      .split(',')
      .map((origin: string) => origin.trim())
      .filter((origin: string) => /^chrome-extension:\/\/[a-p]{32}$/u.test(origin)),
  );
}

function responseHeaders(request: Request) {
  const origin = request.headers.get('origin') ?? '';
  const allowed = allowedExtensionOrigins();
  return {
    ...(allowed.has(origin) && {
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
    }),
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  };
}

export const options = httpAction(async (_ctx, request) => {
  const headers = responseHeaders(request);
  return new Response(null, {
    status: 'Access-Control-Allow-Origin' in headers ? 204 : 403,
    headers,
  });
});

const retryableCode = Schema.Literals([
  'upstream',
  'timeout',
  'provider_global_limiter',
  'stale_season_version',
  'stale_epoch',
  'refresh_in_progress',
  'refresh_superseded',
  'mapping_changed',
  'title_unavailable',
]);
const errorPayload = Schema.Record(Schema.String, Schema.Unknown);
const decodeErrorPayload = Schema.decodeUnknownOption(errorPayload);
const decodeSerializedError = Schema.decodeUnknownOption(Schema.fromJsonString(errorPayload));
const decodeRetryable = Schema.decodeUnknownOption(Schema.Boolean);
const decodeRetryableCode = Schema.decodeUnknownOption(retryableCode);
const decodeError = Schema.decodeUnknownOption(
  Schema.Struct({
    data: Schema.optional(Schema.Unknown),
  }),
);

function isRetryable(error: unknown) {
  const raw = Option.getOrUndefined(decodeError(error))?.data;
  // Action boundaries can preserve the ConvexError payload only in the message.
  const data = Option.getOrUndefined(
    raw === undefined
      ? decodeSerializedError(String(error).match(/\bConvexError:\s*(\{[^\n]*\})/u)?.[1])
      : decodeErrorPayload(raw),
  );
  if (!data) return false;
  return (
    Option.getOrUndefined(decodeRetryable(data.retryable)) ??
    Option.isSome(decodeRetryableCode(data.code))
  );
}

export const recordWatch = httpAction((ctx, request) =>
  runActionEffect(
    Effect.gen(function* () {
      const headers = responseHeaders(request);
      if (!('Access-Control-Allow-Origin' in headers))
        return new Response(JSON.stringify({ error: 'origin-not-allowed' }), {
          status: 403,
          headers,
        });
      const identity = yield* attempt(() => ctx.auth.getUserIdentity());
      if (!identity)
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers });
      const userId = yield* attempt(() =>
        ctx.runQuery(internal.clerkAuth.userIdForIdentity, {
          subject: identity.subject,
        }),
      );
      if (!userId)
        return new Response(JSON.stringify({ error: 'account-not-linked' }), {
          status: 409,
          headers,
        });
      const contentLength = request.headers.get('content-length');
      if (
        contentLength !== null &&
        Number.isFinite(Number(contentLength)) &&
        Number(contentLength) > MAX_BODY_BYTES
      )
        return new Response(JSON.stringify({ error: 'invalid-request' }), { status: 413, headers });
      const textResult = yield* providerOutcome(attempt(() => request.text()));
      if (!textResult.ok)
        return new Response(JSON.stringify({ error: 'invalid-request' }), { status: 400, headers });
      if (new TextEncoder().encode(textResult.value).byteLength > MAX_BODY_BYTES)
        return new Response(JSON.stringify({ error: 'invalid-request' }), { status: 413, headers });
      const body = yield* providerOutcome(
        Schema.decodeUnknownEffect(
          Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
        )(textResult.value),
      );
      if (!body.ok)
        return new Response(JSON.stringify({ error: 'invalid-request' }), { status: 400, headers });
      const result = yield* providerOutcome(
        attempt(() =>
          ctx.runAction(internal.sync.recordWatchFromExtensionInternal, {
            ...body.value,
            userId,
          } as never),
        ),
      );
      if (result.ok) return new Response(JSON.stringify(result.value), { status: 200, headers });
      if (isRetryable(actionFailureCause(result.error)))
        return new Response(JSON.stringify({ error: 'upstream' }), { status: 503, headers });
      return new Response(JSON.stringify({ error: 'invalid-request' }), { status: 400, headers });
    }),
  ),
);
