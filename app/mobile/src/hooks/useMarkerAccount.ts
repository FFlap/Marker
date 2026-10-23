import { runClientEffect } from '@marker/shared/clientOperations';
import { Effect } from 'effect';
import { linkAccount } from '@marker/shared/clientEffects';
import { useCallback, useEffect, useState } from 'react';
import { useAuth, useUser } from '@clerk/expo';
import { useConvexAuth, useMutation } from 'convex/react';
import { api } from '@marker/shared/api';

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
    if (!auth.isAuthenticated || !userId || !userLoaded) return;
    const controller = new AbortController();
    void runClientEffect(
      linkAccount(() => ensureCurrentUser({ username: user?.username ?? undefined })).pipe(
        Effect.match({
          onSuccess: () => setResult({ userId, state: 'ready' }),
          onFailure: () => setResult({ userId, state: 'error' }),
        }),
      ),
      { signal: controller.signal },
    );
    return () => controller.abort();
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
