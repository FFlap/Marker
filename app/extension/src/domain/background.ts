import { Clock, Effect, Predicate, Schema } from "effect";
import {
  operation,
  runExtension,
  storageService,
  ExtensionFailure,
} from "./effects";
import {
  BOOKMARKS_STORAGE_KEY,
  createBookmarkOperations,
  validateBookmark,
} from "./bookmarks";
import type { SyncHttpError } from "./http";
import {
  createOutboxManager,
  buildWatchPayload,
  SYNC_ACCOUNT_KEY,
  SYNC_LAST_RESULT_KEY,
  SYNC_OUTBOX_KEY,
  SYNC_RETRY_KEY,
  type AlarmScheduler,
  type SyncResult,
  type SyncStorage,
  type WatchPayload,
} from "./sync";

const DeliveryResponse = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  reason: Schema.optional(Schema.String),
  unverified: Schema.optional(Schema.Boolean),
});

type ErrorLike = {
  status?: unknown;
  name?: unknown;
};
type DeliveryClassification = "retryable" | "auth" | "terminal";

type ClientResult<A> =
  | Promise<A>
  | Effect.Effect<A, ExtensionFailure | SyncHttpError>;

export interface AuthClient {
  getSession(): ClientResult<{
    token: string;
    accountId: string;
    accountLabel: string;
  } | null>;
  connect(): ClientResult<void>;
  signOut(): ClientResult<void>;
  record(token: string, payload: WatchPayload): ClientResult<unknown>;
}

export function classifyDeliveryError(error: unknown): DeliveryClassification {
  const value = error as ErrorLike | null;
  const status = Number(value?.status);
  if (status === 401 || status === 403 || status === 409) return "auth";
  if (status === 408 || status === 429 || status >= 500) return "retryable";
  if (value?.name === "AbortError" || value?.name === "TimeoutError")
    return "retryable";
  if (error instanceof TypeError) return "retryable";
  if (Number.isInteger(status) && status >= 400 && status < 500)
    return "terminal";
  return "retryable";
}

// Validate the message envelope separately so malformed bookmarks retain the
// existing unsupported-episode response and result recording behavior.
const BackgroundMessageSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literals([
      "sync/connect",
      "sync/signOut",
      "sync/status",
      "bookmark/clear",
    ]),
  }),
  Schema.Struct({
    type: Schema.Literal("bookmark/save"),
    bookmark: Schema.Unknown.check(
      Schema.makeFilter(Predicate.isObjectOrArray),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("bookmark/remove"),
    key: Schema.String,
  }),
]);
const isBackgroundMessage = Schema.is(BackgroundMessageSchema);

export function createMessageHandler(
  storage: SyncStorage & { remove(key: string): Promise<void> },
  client: AuthClient,
  options: { now?: () => number; alarms?: AlarmScheduler } = {},
) {
  const db = storageService(storage);
  let accountRevision = 0;
  // Every session lookup is bounded, including the second lookup before delivery.
  const session = () =>
    operation("auth.session", () => client.getSession()).pipe(
      Effect.timeout(15_000),
      Effect.mapError(
        (cause) => new ExtensionFailure({ operation: "auth.session", cause }),
      ),
    );
  const recordResult = Effect.fnUntraced(function* (
    result: SyncResult,
    seriesTitle?: string,
    revision?: number,
  ) {
    if (revision !== undefined && revision !== accountRevision) return result;
    yield* db.set({
      [SYNC_LAST_RESULT_KEY]: {
        ok: result.ok,
        at: options.now ? options.now() : yield* Clock.currentTimeMillis,
        ...(result.reason ? { reason: result.reason } : {}),
        ...(result.unverified === true ? { unverified: true } : {}),
        ...(seriesTitle ? { seriesTitle } : {}),
      },
    });
    return result;
  });
  const deliver = Effect.fn("deliverWatch")(function* (
    payload: WatchPayload,
    accountId?: string,
  ) {
    const revision = accountRevision;
    const current = yield* session();
    if (!current || accountId === undefined || current.accountId !== accountId)
      return { ok: false, reason: "not-signed-in", retryable: true };
    const stored = yield* db.get(SYNC_ACCOUNT_KEY);
    if (
      revision !== accountRevision ||
      (stored[SYNC_ACCOUNT_KEY] &&
        stored[SYNC_ACCOUNT_KEY] !== current.accountId)
    )
      return { ok: false, reason: "not-signed-in", retryable: true };
    const result = yield* operation("auth.record", () =>
      client.record(current.token, payload),
    ).pipe(
      Effect.map((value): SyncResult => {
        if (!Schema.is(DeliveryResponse)(value))
          return { ok: false, retryable: true };
        return value.ok === true
          ? {
              ok: true,
              retryable: false,
              ...(value.unverified === true ? { unverified: true } : {}),
            }
          : {
              ok: false,
              reason: value.reason ?? "rejected",
              retryable: false,
            };
      }),
      Effect.catch((error) => {
        const classification = classifyDeliveryError(
          error instanceof ExtensionFailure ? error.cause : error,
        );
        return Effect.succeed<SyncResult>(
          classification === "auth"
            ? { ok: false, reason: "not-signed-in", retryable: true }
            : classification === "retryable"
              ? { ok: false, retryable: true }
              : { ok: false, reason: "rejected", retryable: false },
        );
      }),
    );
    return yield* recordResult(result, payload.seriesTitle, revision);
  });
  const outbox = createOutboxManager(storage, deliver, {
    ...options,
    prepare: Effect.fnUntraced(function* () {
      const current = yield* session();
      if (!current) return;
      const stored = yield* db.get(SYNC_ACCOUNT_KEY);
      const previous = stored[SYNC_ACCOUNT_KEY];
      if (previous === current.accountId) return;
      accountRevision += 1;
      if (previous) {
        yield* db.remove(SYNC_OUTBOX_KEY);
        yield* db.remove(SYNC_RETRY_KEY);
        yield* db.remove(SYNC_LAST_RESULT_KEY);
      }
      yield* db.set({ [SYNC_ACCOUNT_KEY]: current.accountId });
    }),
  });
  const bookmarks = createBookmarkOperations(storage, BOOKMARKS_STORAGE_KEY);
  const handler = (message: unknown) =>
    runExtension(
      Effect.gen(function* () {
        if (!isBackgroundMessage(message))
          return { ok: false, reason: "invalid-message", retryable: false };
        switch (message.type) {
          case "sync/connect":
            return yield* Effect.gen(function* () {
              yield* operation("auth.connect", () => client.connect());
              const signedIn = yield* session();
              if (signedIn) yield* outbox.effects.flush;
              return signedIn
                ? { signedIn: true, accountLabel: signedIn.accountLabel }
                : { signedIn: false, reason: "sign-in-opened" };
            }).pipe(
              Effect.catchTag("ExtensionFailure", (error) =>
                Effect.succeed({
                  signedIn: false,
                  reason:
                    error.cause instanceof Error
                      ? error.cause.message
                      : "connect-failed",
                }),
              ),
            );
          case "sync/signOut":
            accountRevision += 1;
            yield* operation("auth.signOut", () => client.signOut());
            yield* outbox.effects.clear();
            yield* db.remove(SYNC_ACCOUNT_KEY);
            yield* db.remove(SYNC_LAST_RESULT_KEY);
            return { signedIn: false };
          case "sync/status": {
            const current = yield* session();
            return current
              ? { signedIn: true, accountLabel: current.accountLabel }
              : { signedIn: false };
          }
          case "bookmark/save": {
            const bookmark = validateBookmark(message.bookmark);
            if (!bookmark) {
              const incoming = message.bookmark as unknown as Record<
                string,
                unknown
              >;
              const seriesTitle =
                typeof incoming.seriesTitle === "string" &&
                incoming.seriesTitle.trim() &&
                incoming.seriesTitle.length <= 300
                  ? incoming.seriesTitle.trim()
                  : undefined;
              yield* recordResult(
                { ok: false, reason: "unsupported-episode", retryable: false },
                seriesTitle,
              );
              return { changed: false, reason: "unsupported-episode" };
            }
            const changed = yield* bookmarks.effects.save(bookmark);
            const payload = buildWatchPayload(bookmark);
            if (payload) {
              yield* outbox.effects.enqueue(payload);
              void outbox
                .flush()
                .catch(() =>
                  console.error(
                    "[Marker] Outbox delivery failed; persisted events remain queued",
                  ),
                );
            } else {
              yield* recordResult(
                { ok: false, reason: "unsupported-episode", retryable: false },
                bookmark.seriesTitle,
              );
            }
            return { changed };
          }
          case "bookmark/remove":
            yield* bookmarks.effects.remove(message.key);
            return { ok: true };
          case "bookmark/clear":
            yield* bookmarks.effects.clear();
            return { ok: true };
        }
      }),
    );
  return {
    handler,
    flush: outbox.flush,
    alarmFired: outbox.alarmFired,
  };
}
