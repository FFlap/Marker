import { Effect, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { ExtensionFailure, runExtension } from "./effects";
import type { WatchPayload } from "./sync";
export class SyncHttpError extends Schema.TaggedError<SyncHttpError>()(
  "SyncHttpError",
  {
    status: Schema.Number,
    message: Schema.String,
  },
) {}
const ResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
  reason: Schema.optional(Schema.String),
  unverified: Schema.optional(Schema.Boolean),
});

export function createWatchTransportEffect(
  url: string,
  request: typeof fetch = fetch,
  timeoutMs = 15_000,
) {
  return Effect.fn("postWatch")(
    function* (token: string, payload: WatchPayload) {
      const client = HttpClient.withScope(yield* HttpClient.HttpClient);
      const response = yield* client
        .execute(
          HttpClientRequest.post(url).pipe(
            HttpClientRequest.setHeader("Authorization", `Bearer ${token}`),
            HttpClientRequest.bodyJsonUnsafe(payload),
          ),
        )
        .pipe(
          Effect.mapError(
            (error) =>
              new ExtensionFailure({
                operation: "http.fetch",
                cause:
                  error.reason._tag === "TransportError"
                    ? error.reason.cause
                    : error,
              }),
          ),
        );
      if (response.status < 200 || response.status >= 300)
        return yield* Effect.fail(
          new SyncHttpError({
            status: response.status,
            message:
              response.status === 401
                ? "Authentication required"
                : "Sync request failed",
          }),
        );
      const value = yield* response.json.pipe(
        Effect.catchTag("HttpClientError", () =>
          Effect.fail(
            new SyncHttpError({
              status: 502,
              message: "Sync returned an invalid response",
            }),
          ),
        ),
      );
      if (!Schema.is(ResponseSchema)(value))
        return yield* Effect.fail(
          new SyncHttpError({
            status: 502,
            message: "Sync returned an invalid response",
          }),
        );
      return value;
    },
    Effect.scoped,
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.Fetch, request),
    Effect.provideService(HttpClient.TracerPropagationEnabled, false),
    Effect.timeout(timeoutMs),
    Effect.catchTag("TimeoutError", () =>
      Effect.fail(
        new SyncHttpError({
          status: 408,
          message: "Sync request timed out",
        }),
      ),
    ),
  );
}

export function createWatchTransport(
  url: string,
  request: typeof fetch = fetch,
  timeoutMs = 15_000,
) {
  const post = createWatchTransportEffect(url, request, timeoutMs);
  return (token: string, payload: WatchPayload, signal?: AbortSignal) =>
    runExtension(post(token, payload), signal);
}
