import type { ReactNode } from 'react';
import { useQuery } from 'convex/react';
import { Redirect, useSegments } from 'expo-router';
import { api } from '../../convex/_generated/api';
import { useMarkerAccount } from '@/hooks/useMarkerAccount';

export function AuthBoundary({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, accountReady, accountError } = useMarkerAccount();
  const segments = useSegments();
  const profile = useQuery(api.profiles.me, isAuthenticated && accountReady ? {} : 'skip');
  const publicRoute = segments[0] === undefined || segments[0] === 'sign-in' || segments[0] === 'u';
  const setupRoute = segments[0] === 'profile-setup';

  if (isLoading) return null;
  if (accountError) return <Redirect href="/sign-in" />;
  if (!isAuthenticated && !publicRoute) return <Redirect href="/sign-in" />;
  if (isAuthenticated && (!accountReady || profile === undefined)) return null;
  if (isAuthenticated && !profile?.username && !setupRoute)
    return <Redirect href="/profile-setup" />;
  if (isAuthenticated && profile?.username && (segments[0] === 'sign-in' || setupRoute)) {
    return <Redirect href="/(tabs)" />;
  }
  return children;
}
