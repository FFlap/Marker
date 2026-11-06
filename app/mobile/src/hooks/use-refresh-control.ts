import { useTaskState } from '@/hooks/use-task-state';
import { useCallback, useRef } from 'react';
import * as Effect from 'effect/Effect';
import * as Schema from 'effect/Schema';
import { useOperation } from './use-operation';

class RefreshError extends Schema.TaggedError<RefreshError>()('RefreshError', {
  cause: Schema.Defect(),
}) {}

export function useRefreshControl(refresh: () => Promise<unknown>) {
  const pending = useRef<'idle' | 'pending'>('idle');
  const { pending: refreshing, setPending: setRefreshing } = useTaskState();
  const run = useOperation();
  const onRefresh = useCallback(() => {
    if (pending.current === 'pending') return Promise.resolve();
    pending.current = 'pending';
    setRefreshing(true);
    return run(Effect.tryPromise({ try: refresh, catch: (cause) => new RefreshError({ cause }) }), {
      // The owning query exposes its error; native RefreshControl has no rejection handler.
      failure: () => undefined,
      settled: () => {
        pending.current = 'idle';
        setRefreshing(false);
      },
    });
  }, [refresh, run, setRefreshing]);
  return { refreshing, onRefresh };
}
