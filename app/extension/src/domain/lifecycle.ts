import { Effect, Exit, Scope } from "effect";

/** A synchronous DOM owner backed by an Effect scope; no detached fiber or daemon. */
export function createContentLifetime(
  onInvalidated: (dispose: () => void) => void,
) {
  const scope = Scope.makeUnsafe();
  const controller = new AbortController();
  let active = true;
  const own = (release: () => void) => {
    Effect.runSync(Scope.addFinalizer(scope, Effect.sync(release)));
  };
  const dispose = () => {
    if (!active) return;
    active = false;
    controller.abort();
    Effect.runSync(Scope.close(scope, Exit.void));
  };
  const listen = (
    target: EventTarget,
    name: string,
    listener: EventListener,
  ) => {
    target.addEventListener(name, listener);
    own(() => target.removeEventListener(name, listener));
  };
  listen(window, "pagehide", (event) => {
    if (!(event as PageTransitionEvent).persisted) dispose();
  });
  onInvalidated(dispose);
  return {
    own,
    listen,
    dispose,
    signal: controller.signal,
    get active() {
      return active;
    },
  };
}
