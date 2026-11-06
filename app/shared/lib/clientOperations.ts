import {
  transitionOwner,
  transitionSession,
  transitionExecution,
  type OwnedState,
  type SessionState,
  type ExecutionState,
} from './lifecycle';
import * as Context from 'effect/Context';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';

/** Event/lifecycle boundary: report failures, keep interruption quiet, retain the Exit. */
export const runClientEffect = <A, E>(
  program: Effect.Effect<A, E>,
  options?: { signal?: AbortSignal },
) =>
  Effect.runPromiseExit(program, options).then((exit) => {
    if (exit._tag === 'Failure' && !Cause.hasInterruptsOnly(exit.cause)) {
      // Do not log SDK exceptions: they can contain credentials or user data.
      console.error('Unexpected client operation failure');
    }
    return exit;
  });

export type OperationHandlers<A, E> = {
  success?: (value: A) => void;
  failure?: (error: E) => void;
  settled?: () => void;
};

/** Each native call checks the session captured when the workflow was accepted. */
export const ClientSessionGuard = Context.Reference<() => boolean>(
  '@marker/shared/clientOperations/ClientSessionGuard',
  {
    defaultValue: () => () => true,
  },
);

export const guardClientSession = Effect.flatMap(ClientSessionGuard, (current) =>
  Effect.suspend(() => (current() ? Effect.void : Effect.interrupt)),
);

/** Owned by the auth provider, never by a screen. No work is made uninterruptible. */
export class ClientWriteSession {
  private session: SessionState = { state: 'current' };
  constructor(
    private readonly identity: string | null,
    private readonly currentIdentity: () => string | null,
  ) {}

  isCurrent = () => {
    this.session = transitionSession(
      this.session,
      this.identity !== null && this.currentIdentity() === this.identity,
    );
    return this.session.state === 'current';
  };

  protect = <A, E>(program: Effect.Effect<A, E>) =>
    guardClientSession.pipe(
      Effect.andThen(program),
      Effect.provideService(ClientSessionGuard, this.isCurrent),
    );
}

/** View ownership suppresses observers; accepted writes keep their session ownership. */
export class ClientOperations {
  private owner: OwnedState = { state: 'active', generation: 0 };
  private pending = new Set<AbortController>();

  constructor(private readonly writes?: ClientWriteSession) {}

  activate() {
    this.owner = transitionOwner(this.owner, 'activate');
  }

  dispose() {
    this.owner = transitionOwner(this.owner, 'dispose');
    for (const controller of this.pending) controller.abort();
    this.pending.clear();
  }

  run = <A, E>(program: Effect.Effect<A, E>, handlers: OperationHandlers<A, E> = {}) =>
    this.start(
      this.writes
        ? program.pipe(Effect.provideService(ClientSessionGuard, this.writes.isCurrent))
        : program,
      handlers,
      false,
    );

  write = <A, E>(program: Effect.Effect<A, E>, handlers: OperationHandlers<A, E> = {}) =>
    this.writes
      ? this.start(this.writes.protect(program), handlers, true)
      : this.start(Effect.die('Write session provider missing'), handlers, false);

  private start = <A, E>(
    program: Effect.Effect<A, E>,
    handlers: OperationHandlers<A, E>,
    write: boolean,
  ): Promise<void> => {
    if (this.owner.state !== 'active') return Promise.resolve();
    const generation = this.owner.generation;
    let execution: ExecutionState = { state: 'accepted' };
    execution = transitionExecution(execution, 'start');
    const controller = new AbortController();
    if (!write) this.pending.add(controller);
    const observable = () =>
      this.owner.state === 'active' &&
      generation === this.owner.generation &&
      !controller.signal.aborted &&
      (!write || this.writes!.isCurrent());
    return runClientEffect(
      program.pipe(
        Effect.matchEffect({
          onSuccess: (value) =>
            Effect.sync(() => {
              execution = transitionExecution(execution, 'succeed');
              if (observable()) handlers.success?.(value);
            }),
          onFailure: (error) => {
            execution = transitionExecution(execution, 'fail');
            return handlers.failure && observable()
              ? Effect.sync(() => {
                  if (observable()) handlers.failure?.(error);
                })
              : Effect.fail(error);
          },
        }),
        Effect.ensuring(
          Effect.sync(() => {
            execution = transitionExecution(execution, 'interrupt');
            this.pending.delete(controller);
            if (observable()) handlers.settled?.();
          }),
        ),
      ),
      { signal: controller.signal },
    ).then(() => undefined);
  };
}
