import { ConvexError, type Value } from 'convex/values';
import { Clock, Effect, Schedule, Schema } from 'effect';
import { FetchHttpClient, HttpBody, HttpClient, HttpClientRequest } from 'effect/http';
import type { HttpMethod } from 'effect/http/HttpMethod';
import { runActionEffect } from './actionEffects';

type Provider = 'tmdb' | 'tvdb';
type ProviderFetchOptions = {
  provider: Provider;
  operation: string;
  timeoutMs?: number;
  retries?: number;
  beforeRequest?: () => Promise<boolean>;
};

const providerSchema = Schema.Literals(['tmdb', 'tvdb']);

export class ProviderFailure extends Schema.TaggedError<ProviderFailure>()('ProviderFailure', {
  provider: providerSchema,
  code: Schema.Literals(['upstream', 'timeout', 'provider_global_limiter']),
  status: Schema.optional(Schema.Number),
  delayMs: Schema.optional(Schema.Number),
  cancelled: Schema.optional(Schema.Boolean),
}) {}

/** Provider contract/configuration failures are distinct from retryable transport failures. */
export class ProviderIntegrationFailure extends Schema.TaggedError<ProviderIntegrationFailure>()(
  'ProviderIntegrationFailure',
  {
    provider: providerSchema,
    message: Schema.String,
  },
) {}

/** Budget RPC failures retain provenance and their original boundary cause. */
export class ProviderBudgetFailure extends Schema.TaggedError<ProviderBudgetFailure>()(
  'ProviderBudgetFailure',
  {
    cause: Schema.Defect(),
    retryable: Schema.Boolean,
  },
) {}

// Convex exhausts its internal OCC retries before surfacing this documented error.
// Only that positive signature warrants retrying a failed budget reservation.
const isBudgetConflict = (cause: unknown) =>
  cause instanceof Error &&
  /Documents read from or written to the ["']requestThrottle["'] table changed while this mutation was being run and on every subsequent retry/.test(
    cause.message,
  );

export type ProviderTransportFailure = ProviderFailure | ProviderBudgetFailure | ConvexError<Value>;

const retryAfterMs = (response: Response, now: number) => {
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - now;
  return Number.isNaN(delay) ? undefined : Math.min(2_000, Math.max(0, delay));
};

/** Every retry reserves distributed budget anew. Only idempotent HTTP methods retry. */
export const providerFetchEffect = Effect.fnUntraced(function* (
  url: string,
  init: RequestInit,
  options: ProviderFetchOptions,
) {
  const startedAt = yield* Clock.currentTimeMillis;
  let attempts = 0;
  const method = (init.method ?? 'GET').toUpperCase();
  const retries = method === 'GET' || method === 'HEAD' ? (options.retries ?? 1) : 0;
  const failure = (code: ProviderFailure['code'], status?: number) =>
    new ProviderFailure({
      provider: options.provider,
      code,
      status,
      cancelled: init.signal?.aborted,
    });
  const request = Effect.gen(function* () {
    attempts++;
    if (init.signal?.aborted) return yield* Effect.fail(failure('upstream'));
    if (options.beforeRequest) {
      const granted = yield* Effect.tryPromise({
        try: options.beforeRequest,
        catch: (cause) => new ProviderBudgetFailure({ cause, retryable: isBudgetConflict(cause) }),
      }).pipe(Effect.uninterruptible);
      if (!granted) return yield* Effect.fail(failure('provider_global_limiter'));
    }
    return yield* Effect.acquireUseRelease(
      Effect.sync(() => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        init.signal?.addEventListener('abort', abort, { once: true });
        if (init.signal?.aborted) abort();
        return { controller, abort };
      }),
      ({ controller }) =>
        Effect.gen(function* () {
          // Preserve native response details (statusText/body cancellation) at this
          // compatibility boundary. The outer finalizer owns the full body lifetime.
          let nativeResponse: Response | undefined;
          const transport: typeof fetch = async (input, requestInit) => {
            nativeResponse = await fetch(String(input), {
              ...requestInit,
              signal: controller.signal,
            });
            return nativeResponse;
          };
          const client = yield* HttpClient.HttpClient;
          const received = yield* client
            .execute(
              HttpClientRequest.make(method as HttpMethod)(url, {
                headers: new Headers(init.headers),
                body: init.body == null ? HttpBody.empty : HttpBody.raw(init.body),
              }),
            )
            .pipe(
              Effect.provideService(FetchHttpClient.Fetch, transport),
              Effect.provideService(FetchHttpClient.RequestInit, init),
              Effect.provideService(HttpClient.TracerPropagationEnabled, false),
              Effect.mapError(() => failure(controller.signal.aborted ? 'timeout' : 'upstream')),
            );
          // FetchHttpClient invokes transport exactly once for each execute.
          const response = nativeResponse!;
          if (response.status === 408 || response.status === 429 || response.status >= 500) {
            // A broken cancellation must not replace the HTTP failure or prevent retry.
            yield* Effect.tryPromise({
              try: async () => {
                await response.body?.cancel();
              },
              catch: () => undefined,
            }).pipe(Effect.catch(() => Effect.void));
            return yield* Effect.fail(
              new ProviderFailure({
                provider: options.provider,
                code: 'upstream',
                status: response.status,
                delayMs: retryAfterMs(response, yield* Clock.currentTimeMillis),
              }),
            );
          }
          const body = response.body
            ? yield* received.arrayBuffer.pipe(
                Effect.mapError(() => failure(controller.signal.aborted ? 'timeout' : 'upstream')),
              )
            : null;
          return new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }).pipe(
          Effect.timeoutOrElse({
            duration: options.timeoutMs ?? 4_000,
            orElse: () => Effect.fail(failure('timeout')),
          }),
        ),
      ({ controller, abort }) =>
        Effect.sync(() => {
          init.signal?.removeEventListener('abort', abort);
          controller.abort();
        }),
    );
  });
  return yield* request.pipe(
    Effect.retry({
      times: retries,
      while: (error) =>
        (error instanceof ProviderBudgetFailure && error.retryable) ||
        (error instanceof ProviderFailure &&
          error.code !== 'provider_global_limiter' &&
          !error.cancelled),
      schedule: Schedule.recurs(retries).pipe(
        Schedule.addDelay(({ input }) =>
          Effect.succeed(
            input instanceof ProviderFailure && input.delayMs !== undefined
              ? input.delayMs
              : Math.min(150 * 2 ** (attempts - 1) + Math.floor(Math.random() * 100), 2_000),
          ),
        ),
      ),
    }),
    Effect.tap((response) =>
      Effect.flatMap(Clock.currentTimeMillis, (now) =>
        Effect.sync(() =>
          console.info(
            '[metadata-provider]',
            JSON.stringify({
              provider: options.provider,
              operation: options.operation,
              outcome: response.ok ? 'success' : 'rejected',
              status: response.status,
              attempts,
              durationMs: now - startedAt,
            }),
          ),
        ),
      ),
    ),
    Effect.tapError((error) =>
      Effect.flatMap(Clock.currentTimeMillis, (now) =>
        Effect.sync(() =>
          console.info(
            '[metadata-provider]',
            JSON.stringify({
              provider: options.provider,
              operation: options.operation,
              outcome:
                error instanceof ProviderBudgetFailure
                  ? 'budget-error'
                  : error instanceof ProviderFailure && error.code === 'timeout'
                    ? 'timeout'
                    : error instanceof ProviderFailure &&
                        error.code === 'upstream' &&
                        error.status === undefined
                      ? 'network-error'
                      : 'error',
              ...(error instanceof ProviderFailure &&
                error.status !== undefined && { status: error.status }),
              attempts,
              durationMs: now - startedAt,
            }),
          ),
        ),
      ),
    ),
  );
}, Effect.provide(FetchHttpClient.layer));

/** Convert only when crossing back into the existing Promise/Convex API. */
export const providerBoundaryFailure = (error: unknown): unknown =>
  error instanceof ProviderBudgetFailure
    ? error.cause
    : error instanceof ProviderFailure
      ? new ConvexError({
          code: error.code,
          provider: error.provider,
          ...(error.status !== undefined && { status: error.status }),
          retryable: true,
        })
      : error instanceof ProviderIntegrationFailure
        ? new Error(error.message)
        : error;

export const runProviderEffect = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  runActionEffect(effect.pipe(Effect.mapError(providerBoundaryFailure)));

export const providerFetch = (url: string, init: RequestInit, options: ProviderFetchOptions) =>
  runProviderEffect(providerFetchEffect(url, init, options));

const providerObject = Schema.Record(Schema.String, Schema.Unknown);
/** Validate the provider envelope; domain mappers deliberately tolerate optional fields. */
export const decodeProviderObject = (response: Response, provider: Provider) =>
  Effect.tryPromise({
    try: () => response.json() as Promise<unknown>,
    catch: () =>
      new ProviderIntegrationFailure({
        provider,
        message: `${provider.toUpperCase()} returned malformed data`,
      }),
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(providerObject)),
    Effect.mapError(
      () =>
        new ProviderIntegrationFailure({
          provider,
          message: `${provider.toUpperCase()} returned malformed data`,
        }),
    ),
  );
