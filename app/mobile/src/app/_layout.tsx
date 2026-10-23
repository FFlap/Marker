import { useCallback, useRef, type ReactNode } from 'react';
import { ScreenReadinessContext } from '@/components/ScreenLayout';
import { OperationSessionProvider } from '@/hooks/operation-session';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { ConvexReactClient } from 'convex/react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ToastProvider } from '@/components/ui/Toast';
import { ScreenErrorBoundary } from '@/components/ScreenErrorBoundary';
import { CalendarProvider } from '@/hooks/useCalendar';
import { AccountProvider } from '@/hooks/useAccount';
import { AuthBoundary } from '@/components/AuthBoundary';
import * as SplashScreen from 'expo-splash-screen';
import { colors } from '@/constants/colors';
import { PortalHost } from '@rn-primitives/portal';
import {
  initialWindowMetrics,
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';
import '@/global.css';
import {
  AlbertSans_400Regular,
  AlbertSans_500Medium,
  AlbertSans_600SemiBold,
  AlbertSans_700Bold,
  useFonts,
} from '@expo-google-fonts/albert-sans';

// Navigation readiness can precede the visible screen’s first native layout.
void SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 0, fade: false });

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error('EXPO_PUBLIC_CONVEX_URL is required');
const client = new ConvexReactClient(convexUrl);
const clerkPublishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
if (!clerkPublishableKey) throw new Error('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is required');

function ConvexClerkBridge({ children }: { children: React.ReactNode }) {
  // Reset account-scoped caches on an actual session change, not on auth loading updates.
  const { sessionId } = useAuth();
  return (
    <ConvexProviderWithClerk key={sessionId ?? 'signed-out'} client={client} useAuth={useAuth}>
      <OperationSessionProvider>
        <CalendarProvider>{children}</CalendarProvider>
      </OperationSessionProvider>
    </ConvexProviderWithClerk>
  );
}

// Guard content inside the navigator so auth resolution preserves route history and deep links.
function renderScreen({ children, route }: { children: React.ReactNode; route: { name: string } }) {
  if (route.name === '(tabs)') return <>{children}</>;
  return <AuthBoundary routeName={route.name}>{children}</AuthBoundary>;
}

export function AppRoutes() {
  return (
    <AccountProvider>
      <Stack
        screenLayout={renderScreen}
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="add" options={{ presentation: 'modal' }} />
        <Stack.Screen name="explore" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="calendar" />
        <Stack.Screen name="calendar/[date]" />
        <Stack.Screen name="title/[mediaType]/[tmdbId]" />
        <Stack.Screen name="item/[id]" />
        <Stack.Screen name="profile-edit" options={{ presentation: 'modal' }} />
        <Stack.Screen name="profile-setup" />
        <Stack.Screen name="u/[username]" />
      </Stack>
    </AccountProvider>
  );
}
// Context adds no native surface and stays above both navigation and its error fallback.
export function StartupSplashBoundary({ children }: { children: ReactNode }) {
  const dismissed = useRef(false);
  const reportReady = useCallback(() => {
    if (dismissed.current) return;
    dismissed.current = true;
    SplashScreen.hide();
  }, []);
  return <ScreenReadinessContext value={reportReady}>{children}</ScreenReadinessContext>;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    AlbertSans_400Regular,
    AlbertSans_500Medium,
    AlbertSans_600SemiBold,
    AlbertSans_700Bold,
  });
  if (!fontsLoaded && !fontError) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardProvider>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
            <ClerkProvider publishableKey={clerkPublishableKey} tokenCache={tokenCache}>
              <ConvexClerkBridge>
                <ToastProvider>
                  <StatusBar style="light" />
                  <StartupSplashBoundary>
                    <ScreenErrorBoundary>
                      <AppRoutes />
                    </ScreenErrorBoundary>
                  </StartupSplashBoundary>
                  <PortalHost />
                </ToastProvider>
              </ConvexClerkBridge>
            </ClerkProvider>
          </SafeAreaView>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
