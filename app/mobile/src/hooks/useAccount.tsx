import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useAuth, useClerk } from '@clerk/expo';
import { api } from '@marker/shared/api';
import { useMarkerAccount } from './useMarkerAccount';
import { StartupQueries } from '@/components/StartupQueries';
import { useStartupData, useStartupQuery } from './useStartupQuery';
import { startupSnapshotStore } from '@/lib/startupSnapshotStorage';

function useAccountState(account: ReturnType<typeof useMarkerAccount>) {
  const { isLoaded: clerkLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const cachedContent = !!useStartupData()?.cached;
  const profile = useStartupQuery(
    api.profiles.me,
    clerkLoaded &&
      isSignedIn &&
      (cachedContent || (account.isAuthenticated && account.accountReady))
      ? {}
      : 'skip',
  );
  const pending =
    !clerkLoaded ||
    !!(isSignedIn && (account.isLoading || !account.accountReady || profile === undefined));
  return { ...account, clerkLoaded, isSignedIn, signOut, profile, pending, cachedContent };
}

const AccountContext = createContext<ReturnType<typeof useAccountState> | null>(null);

// Initialize the account once, independently of which routes are mounted in navigation.
export function AccountProvider({ children }: { children: ReactNode }) {
  const account = useMarkerAccount();
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  const scope = useMemo(
    () =>
      isLoaded && isSignedIn && userId && sessionId
        ? {
            userId,
            sessionId,
            environment: `${process.env.EXPO_PUBLIC_CONVEX_URL}|${process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY}`,
          }
        : undefined,
    [isLoaded, isSignedIn, userId, sessionId],
  );
  const allowCache =
    !!scope && !account.accountError && (account.isLoading || account.isAuthenticated);
  useEffect(() => {
    if (
      isLoaded &&
      (!isSignedIn || account.accountError || (!account.isLoading && !account.isAuthenticated))
    ) {
      void startupSnapshotStore.clear();
    }
  }, [isLoaded, isSignedIn, account.accountError, account.isLoading, account.isAuthenticated]);
  return (
    <StartupQueries
      enabled={isLoaded && !!isSignedIn && account.isAuthenticated && account.accountReady}
      scope={scope}
      allowCache={allowCache}
    >
      <AccountStateProvider account={account}>{children}</AccountStateProvider>
    </StartupQueries>
  );
}

function AccountStateProvider({
  account,
  children,
}: {
  account: ReturnType<typeof useMarkerAccount>;
  children: ReactNode;
}) {
  const state = useAccountState(account);
  return <AccountContext.Provider value={state}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  const account = useContext(AccountContext);
  if (!account) throw new Error('AccountProvider is required');
  return account;
}
