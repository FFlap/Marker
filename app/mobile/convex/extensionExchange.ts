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

function errorCode(error: unknown) {
  const structured =
    typeof error === 'object' && error !== null && 'data' in error
      ? (error as { data?: { code?: unknown } }).data?.code
      : undefined;
  if (structured !== undefined) return structured;
  const message = String(error);
  if (message.includes('stale_season_version')) return 'stale_season_version';
  if (message.includes('stale_epoch')) return 'stale_epoch';
  if (message.includes('upstream')) return 'upstream';
  return undefined;
}

export const recordWatch = httpAction(async (ctx, request) => {
  const headers = responseHeaders(request);
  if (!('Access-Control-Allow-Origin' in headers))
    return new Response(JSON.stringify({ error: 'origin-not-allowed' }), { status: 403, headers });
  const identity = await ctx.auth.getUserIdentity();
  if (!identity)
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers });
  const userId = await ctx.runQuery(internal.clerkAuth.userIdForIdentity, {
    subject: identity.subject,
  });
  if (!userId)
    return new Response(JSON.stringify({ error: 'account-not-linked' }), { status: 409, headers });
  let body: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES)
      return new Response(JSON.stringify({ error: 'invalid-request' }), { status: 413, headers });
    body = JSON.parse(text);
  } catch {
    return new Response(JSON.stringify({ error: 'invalid-request' }), { status: 400, headers });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return new Response(JSON.stringify({ error: 'invalid-request' }), { status: 400, headers });
  try {
    const result = await ctx.runAction(internal.sync.recordWatchFromExtensionInternal, {
      ...(body as Record<string, unknown>),
      userId,
    } as never);
    return new Response(JSON.stringify(result), { status: 200, headers });
  } catch (error) {
    const code = errorCode(error);
    if (code === 'upstream' || code === 'stale_epoch' || code === 'stale_season_version')
      return new Response(JSON.stringify({ error: 'upstream' }), { status: 503, headers });
    return new Response(JSON.stringify({ error: 'invalid-request' }), { status: 400, headers });
  }
});
