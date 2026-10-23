import { createContext, useContext, type ReactNode } from 'react';
import { useAuth, useClerk } from '@clerk/expo';
import { useQuery } from 'convex/react';
import { api } from '@marker/shared/api';
import { useMarkerAccount } from './useMarkerAccount';

function useAccountState() {
  const { isLoaded: clerkLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const account = useMarkerAccount();
  const profile = useQuery(
    api.profiles.me,
    clerkLoaded && isSignedIn && account.isAuthenticated && account.accountReady ? {} : 'skip',
  );
  const pending =
    !clerkLoaded ||
    !!(isSignedIn && (account.isLoading || !account.accountReady || profile === undefined));
  return { ...account, clerkLoaded, isSignedIn, signOut, profile, pending };
}

const AccountContext = createContext<ReturnType<typeof useAccountState> | null>(null);

// Initialize the account once, independently of which routes are mounted in navigation.
export function AccountProvider({ children }: { children: ReactNode }) {
  const account = useAccountState();
  return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  const account = useContext(AccountContext);
  if (!account) throw new Error('AccountProvider is required');
  return account;
}
