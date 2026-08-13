import { useCallback, useEffect, useState } from 'react';
import { useAuth, useUser } from '@clerk/expo';
import { useConvexAuth, useMutation } from 'convex/react';
import { api } from '../../convex/_generated/api';

export function useMarkerAccount() {
  const auth = useConvexAuth();
  const { userId } = useAuth();
  const { isLoaded: userLoaded, user } = useUser();
  const ensureCurrentUser = useMutation(api.clerkAuth.ensureCurrentUser);
  const [result, setResult] = useState<{
    userId: string;
    state: 'ready' | 'error';
  } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    if (!auth.isAuthenticated || !userId || !userLoaded) return;
    const timeout = setTimeout(() => active && setResult({ userId, state: 'error' }), 15_000);
    void ensureCurrentUser({ username: user?.username ?? undefined })
      .then(() => {
        clearTimeout(timeout);
        if (active) setResult({ userId, state: 'ready' });
      })
      .catch(() => {
        clearTimeout(timeout);
        if (active) setResult({ userId, state: 'error' });
      });
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [attempt, auth.isAuthenticated, ensureCurrentUser, user?.username, userId, userLoaded]);

  const retryAccount = useCallback(() => {
    setResult(null);
    setAttempt((value) => value + 1);
  }, []);

  const currentResult = result && result.userId === userId ? result.state : null;

  return {
    ...auth,
    accountReady: !auth.isAuthenticated || currentResult === 'ready',
    accountError: currentResult === 'error',
    retryAccount,
  };
}
