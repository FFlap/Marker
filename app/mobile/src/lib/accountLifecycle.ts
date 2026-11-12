export type AccountBoundaryState =
  | { state: 'loading' }
  | { state: 'public' }
  | { state: 'cached' }
  | { state: 'error' }
  | { state: 'redirect'; destination: '/sign-in' | '/profile-setup' | '/(tabs)' }
  | { state: 'ready' };

/** Clerk sign-out takes precedence over Convex's possibly cached auth result. */
export function accountBoundaryState(input: {
  routeName: string;
  clerkLoaded: boolean;
  isSignedIn: boolean | undefined;
  isAuthenticated: boolean;
  isLoading: boolean;
  accountReady: boolean;
  accountError: boolean;
  cachedContent: boolean;
  profile: { username?: string } | null | undefined;
}): AccountBoundaryState {
  const publicRoute = input.routeName === 'sign-in' || input.routeName.startsWith('u/');
  const setupRoute = input.routeName === 'profile-setup';
  if (!input.clerkLoaded) return { state: 'loading' };
  if (!input.isSignedIn)
    return publicRoute ? { state: 'public' } : { state: 'redirect', destination: '/sign-in' };
  if (
    input.cachedContent &&
    input.profile?.username &&
    (input.routeName === 'index' || input.routeName === 'profile')
  )
    return { state: 'cached' };
  if (input.isLoading) return { state: 'loading' };
  if (input.accountError) return { state: 'error' };
  if (!input.isAuthenticated && !publicRoute) return { state: 'redirect', destination: '/sign-in' };
  if (input.isAuthenticated && (!input.accountReady || input.profile === undefined))
    return { state: 'loading' };
  if (input.isAuthenticated && !input.profile?.username && !setupRoute)
    return { state: 'redirect', destination: '/profile-setup' };
  if (
    input.isAuthenticated &&
    input.profile?.username &&
    (input.routeName === 'sign-in' || setupRoute)
  )
    return { state: 'redirect', destination: '/(tabs)' };
  return { state: 'ready' };
}
