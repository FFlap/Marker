import { accountBoundaryState } from '@/lib/accountLifecycle';
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
    cachedContent,
  } = useAccount();
  const libraryRoute = routeName === 'index';
  const loading = (
    <AccountLoadingContext.Provider
      value={{
        profileReady: clerkLoaded && !!isSignedIn && isAuthenticated && accountReady,
        libraryReady: !pending && !!profile?.username,
      }}
    >
      {libraryRoute || routeName === 'profile' ? children : <LibraryScreen />}
    </AccountLoadingContext.Provider>
  );
  const boundary = accountBoundaryState({
    routeName,
    clerkLoaded,
    isSignedIn,
    isAuthenticated,
    isLoading,
    accountReady,
    accountError,
    cachedContent,
    profile,
  });
  if (boundary.state === 'loading') return loading;
  if (boundary.state === 'public') return children;
  if (boundary.state === 'redirect') return <Redirect href={boundary.destination} />;
  if (boundary.state === 'error')
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
