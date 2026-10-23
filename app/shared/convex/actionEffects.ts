import { Effect, Schema } from 'effect';

/** Convex calls preserve their original failure for serialization at the action boundary. */
export class ActionCallFailure extends Schema.TaggedError<ActionCallFailure>()(
  'ActionCallFailure',
  {
    cause: Schema.Defect(),
  },
) {}

export const actionFailureCause = (error: unknown): unknown =>
  error instanceof ActionCallFailure ? error.cause : error;

// Convex RPCs cannot be cancelled. Drain started calls before an invocation exits.
export const attempt = <A>(run: () => PromiseLike<A>) =>
  Effect.tryPromise({
    try: () => Promise.resolve(run()),
    catch: (cause) => new ActionCallFailure({ cause }),
  }).pipe(Effect.uninterruptible);

/** Effect v4 rejects with the original failure; unwrap only our Convex-call adapter. */
export const runActionEffect = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.mapError(actionFailureCause)));

/** Optional-provider failures remain values; defects and interruption still propagate. */
export const providerOutcome = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.map((value) => ({ ok: true as const, value })),
    Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
  );
