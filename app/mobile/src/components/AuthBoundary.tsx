import type { ReactNode } from 'react';
import { useAuth, useClerk } from '@clerk/expo';
import { useQuery } from 'convex/react';
import { Redirect, useSegments } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { api } from '../../convex/_generated/api';
import { Button } from '@/components/ui/primitives';
import { colors } from '@/constants/colors';
import { useMarkerAccount } from '@/hooks/useMarkerAccount';
import { createAppStyles } from '@/lib/typography';

export function AuthBoundary({ children }: { children: ReactNode }) {
  const { isLoaded: clerkLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const { isAuthenticated, isLoading, accountReady, accountError, retryAccount } =
    useMarkerAccount();
  const segments = useSegments();
  const profile = useQuery(api.profiles.me, isAuthenticated && accountReady ? {} : 'skip');
  const publicRoute = segments[0] === 'sign-in' || segments[0] === 'u';
  const setupRoute = segments[0] === 'profile-setup';
  if (!clerkLoaded) return <AuthLoadingScreen />;
  // Clerk owns the session lifecycle. In particular, it can publish an expired session as signed
  // out before Convex has finished clearing its cached auth state. Handle that state first so a
  // protected screen can never get stuck behind Convex's loading state.
  if (!isSignedIn) {
    if (!publicRoute) return <Redirect href="/sign-in" />;
    return children;
  }
  if (isLoading) return <AuthLoadingScreen />;
  if (accountError)
    return (
      <View style={styles.errorScreen}>
        <Text style={styles.title}>We couldn’t finish setting up your account</Text>
        <Text style={styles.message}>Check your connection and try again, or sign out.</Text>
        <View style={styles.actions}>
          <Button title="Retry" onPress={retryAccount} />
          <Button title="Sign out" variant="outline" onPress={() => void signOut()} />
        </View>
      </View>
    );
  if (!isAuthenticated && !publicRoute) return <Redirect href="/sign-in" />;
  if (isAuthenticated && (!accountReady || profile === undefined)) return null;
  if (isAuthenticated && !profile?.username && !setupRoute)
    return <Redirect href="/profile-setup" />;
  if (isAuthenticated && profile?.username && (segments[0] === 'sign-in' || setupRoute)) {
    return <Redirect href="/(tabs)" />;
  }
  return children;
}

function AuthLoadingScreen() {
  return (
    <View accessibilityLabel="Loading your account" style={styles.loadingScreen}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

const styles = createAppStyles(
  {
    errorScreen: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      padding: 24,
      backgroundColor: colors.bg,
    },
    loadingScreen: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.bg,
    },
    title: { color: colors.text, fontSize: 20, fontWeight: '700', textAlign: 'center' },
    message: { color: colors.muted, fontSize: 15, textAlign: 'center' },
    actions: { width: '100%', maxWidth: 320, gap: 10, marginTop: 8 },
  },
  ['title', 'message'] as const,
);
