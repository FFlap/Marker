import { useEffect, useState } from 'react';
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

  useEffect(() => {
    let active = true;
    if (!auth.isAuthenticated || !userId || !userLoaded) return;
    void ensureCurrentUser({ username: user?.username ?? undefined })
      .then(() => active && setResult({ userId, state: 'ready' }))
      .catch(() => active && setResult({ userId, state: 'error' }));
    return () => {
      active = false;
    };
  }, [auth.isAuthenticated, ensureCurrentUser, user?.username, userId, userLoaded]);

  const currentResult = result && result.userId === userId ? result.state : null;

  return {
    ...auth,
    accountReady: !auth.isAuthenticated || currentResult === 'ready',
    accountError: currentResult === 'error',
  };
}
