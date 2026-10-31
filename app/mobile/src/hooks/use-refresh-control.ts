import { useCallback, useRef, useState } from 'react';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import { useOperation } from './use-operation';

class RefreshError extends Schema.TaggedError<RefreshError>()('RefreshError', {
  cause: Schema.Defect(),
}) {}

export function useRefreshControl(refresh: () => Promise<unknown>) {
  const pending = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const run = useOperation();
  const onRefresh = useCallback(() => {
    if (pending.current) return Promise.resolve();
    pending.current = true;
    setRefreshing(true);
    return run(Effect.tryPromise({ try: refresh, catch: (cause) => new RefreshError({ cause }) }), {
      // The owning query exposes its error; native RefreshControl has no rejection handler.
      failure: () => undefined,
      settled: () => {
        pending.current = false;
        setRefreshing(false);
      },
    });
  }, [refresh, run]);
  return { refreshing, onRefresh };
}
