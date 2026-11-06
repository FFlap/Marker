import { useCallback, useReducer } from 'react';
import { transitionTask } from '@marker/shared/lifecycle';

/** UI projection of one submit/retry machine; failures survive settlement. */
export function useTaskState() {
  const [task, dispatch] = useReducer(transitionTask, { state: 'idle' });
  const setPending = useCallback(
    (pending: boolean) => dispatch({ type: pending ? 'start' : 'finish' }),
    [],
  );
  const setError = useCallback(
    (error: string) => dispatch(error ? { type: 'fail', error } : { type: 'clearFailure' }),
    [],
  );
  return {
    task,
    pending: task.state === 'pending',
    error: task.state === 'idle' ? '' : task.error,
    setPending,
    setError,
  };
}
