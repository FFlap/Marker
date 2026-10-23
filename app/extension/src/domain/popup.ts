import { Effect, Schema } from "effect";
import {
  BOOKMARKS_STORAGE_KEY,
  normalizeBookmarkStore,
  sortBookmarks,
} from "./bookmarks";
import {
  external,
  runExtension,
  storageService,
  type StorageApi,
} from "./effects";
import { SYNC_LAST_RESULT_KEY } from "./sync";

const Status = Schema.Struct({
  signedIn: Schema.Boolean,
  accountLabel: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
});
const Acknowledged = Schema.Struct({ ok: Schema.Literal(true) });
const LastResult = Schema.Struct({
  ok: Schema.Boolean,
  at: Schema.Finite,
  reason: Schema.optional(Schema.String),
  seriesTitle: Schema.optional(Schema.String),
  unverified: Schema.optional(Schema.Boolean),
});
export const parseLastResult = (value: unknown) =>
  Schema.is(LastResult)(value) ? value : undefined;

/** Browser services are injected so popup effects can be exercised without extension globals. */
export function createPopupClient(
  storage: StorageApi,
  send: (message: unknown) => Promise<unknown>,
) {
  const db = storageService(storage);
  const status = (type: string, signal?: AbortSignal) =>
    runExtension(
      Effect.gen(function* () {
        const value = yield* external("message." + type, () => send({ type }));
        return yield* Schema.decodeUnknownEffect(Status)(value);
      }),
      signal,
    );
  return {
    bookmarks: (signal?: AbortSignal) =>
      runExtension(
        db
          .get(BOOKMARKS_STORAGE_KEY)
          .pipe(
            Effect.map((stored) =>
              sortBookmarks(
                normalizeBookmarkStore(stored[BOOKMARKS_STORAGE_KEY]).bookmarks,
              ),
            ),
          ),
        signal,
      ),
    lastResult: (signal?: AbortSignal) =>
      runExtension(
        db
          .get(SYNC_LAST_RESULT_KEY)
          .pipe(
            Effect.map((stored) =>
              parseLastResult(stored[SYNC_LAST_RESULT_KEY]),
            ),
          ),
        signal,
      ),
    status,
    mutate: (message: { type: string; key?: string }) =>
      runExtension(
        Effect.gen(function* () {
          const value = yield* external("message." + message.type, () =>
            send(message),
          );
          yield* Schema.decodeUnknownEffect(Acknowledged)(value);
        }),
      ),
  };
}
