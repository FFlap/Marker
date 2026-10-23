import { ScreenView } from '@/components/ScreenLayout';
import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import { Text, View } from 'react-native';
import { Button } from '@/components/ui/primitives';
import LibraryScreen from '@/app/(tabs)/index';
import { AccountLoadingContext } from '@/hooks/useAccountLoading';
import { colors } from '@/constants/colors';
import { useAccount } from '@/hooks/useAccount';
import { createAppStyles } from '@/lib/typography';

export function AuthBoundary({ children, routeName }: { children: ReactNode; routeName: string }) {
  const {
    clerkLoaded,
    isSignedIn,
    isAuthenticated,
    isLoading,
    accountReady,
    accountError,
    retryAccount,
    profile,
    pending,
    signOut,
  } = useAccount();
  const publicRoute = routeName === 'sign-in' || routeName.startsWith('u/');
  const setupRoute = routeName === 'profile-setup';
  const libraryRoute = routeName === 'index';
  const loading = (
    <AccountLoadingContext.Provider
      value={{
        profileReady: clerkLoaded && !!isSignedIn && isAuthenticated && accountReady,
        libraryReady: !pending && !!profile?.username,
      }}
    >
      {libraryRoute ? children : <LibraryScreen />}
    </AccountLoadingContext.Provider>
  );
  if (!clerkLoaded) return loading;
  // Clerk can publish an expired session as signed out before Convex clears its cached
  // auth state; checking Convex loading first can leave protected screens stuck.
  if (!isSignedIn) {
    if (!publicRoute) return <Redirect href="/sign-in" />;
    return children;
  }
  if (isLoading) return loading;
  if (accountError)
    return (
      <ScreenView style={styles.errorScreen}>
        <Text style={styles.title}>We couldn’t finish setting up your account</Text>
        <Text style={styles.message}>Check your connection and try again, or sign out.</Text>
        <View style={styles.actions}>
          <Button title="Retry" onPress={retryAccount} />
          <Button title="Sign out" variant="outline" onPress={() => void signOut()} />
        </View>
      </ScreenView>
    );
  if (!isAuthenticated && !publicRoute) return <Redirect href="/sign-in" />;
  if (isAuthenticated && (!accountReady || profile === undefined)) return loading;
  if (isAuthenticated && !profile?.username && !setupRoute)
    return <Redirect href="/profile-setup" />;
  if (isAuthenticated && profile?.username && (routeName === 'sign-in' || setupRoute)) {
    return <Redirect href="/(tabs)" />;
  }
  return (
    <AccountLoadingContext.Provider value={{ profileReady: true, libraryReady: true }}>
      {children}
    </AccountLoadingContext.Provider>
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
    title: { color: colors.text, fontSize: 20, fontWeight: '700', textAlign: 'center' },
    message: { color: colors.muted, fontSize: 15, textAlign: 'center' },
    actions: { width: '100%', maxWidth: 320, gap: 10, marginTop: 8 },
  },
  ['title', 'message'] as const,
);
