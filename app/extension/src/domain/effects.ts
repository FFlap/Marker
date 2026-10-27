import { Cause, Context, Effect, Exit, Schema } from "effect";

/** External API failures carry their original value across Promise-facing edges. */
export class ExtensionFailure extends Schema.TaggedError<ExtensionFailure>()(
  "ExtensionFailure",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export const external = <A>(
  operation: string,
  run: (signal: AbortSignal) => PromiseLike<A>,
) =>
  Effect.tryPromise({
    try: async (signal) => await run(signal),
    catch: (cause) => new ExtensionFailure({ operation, cause }),
  });

export async function runExtension<A, E>(
  effect: Effect.Effect<A, E>,
  signal?: AbortSignal,
): Promise<A> {
  const exit = await Effect.runPromiseExit(effect, { signal });
  if (Exit.isSuccess(exit)) return exit.value;
  const error = Cause.squash(exit.cause);
  throw error instanceof ExtensionFailure ? error.cause : error;
}

export interface StorageApi {
  get(key: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}
export class ExtensionStorage extends Context.Service<
  ExtensionStorage,
  {
    get: (
      key: string | string[],
    ) => Effect.Effect<Record<string, unknown>, ExtensionFailure>;
    set: (
      items: Record<string, unknown>,
    ) => Effect.Effect<void, ExtensionFailure>;
    remove: (key: string) => Effect.Effect<void, ExtensionFailure>;
  }
>()("marker/extension/domain/ExtensionStorage") {}
export const storageService = (
  storage: StorageApi,
): ExtensionStorage["Service"] => ({
  get: (key) => external("storage.get", () => storage.get(key)),
  set: (items) => external("storage.set", () => storage.set(items)),
  remove: (key) =>
    external("storage.remove", () => storage.remove(key)),
});

/** Reserve a place before waiting, so fresh arrivals cannot overtake scheduled waiters.
 * Storage transactions finish even if their caller leaves: browser writes cannot be aborted.
 * The tail never rejects, including when the transaction fails or dies.
 */
export function createFifo() {
  let tail = Promise.resolve();
  return <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.suspend(() => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      return Effect.promise(() => previous).pipe(
        Effect.andThen(effect),
        Effect.ensuring(Effect.sync(release)),
      );
    }).pipe(Effect.uninterruptible);
}
