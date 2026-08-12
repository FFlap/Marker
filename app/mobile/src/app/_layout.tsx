import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { ConvexReactClient } from 'convex/react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ToastProvider } from '@/components/ui/Toast';
import { ScreenErrorBoundary } from '@/components/ScreenErrorBoundary';
import { AuthBoundary } from '@/components/AuthBoundary';
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

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
if (!convexUrl) throw new Error('EXPO_PUBLIC_CONVEX_URL is required');
const client = new ConvexReactClient(convexUrl);
const clerkPublishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
if (!clerkPublishableKey) throw new Error('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is required');
export function AppRoutes() {
  return (
    <AuthBoundary>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
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
    </AuthBoundary>
  );
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
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <ClerkProvider publishableKey={clerkPublishableKey} tokenCache={tokenCache}>
            <ConvexProviderWithClerk client={client} useAuth={useAuth}>
              <ToastProvider>
                <StatusBar style="light" />
                <ScreenErrorBoundary>
                  <AppRoutes />
                </ScreenErrorBoundary>
                <PortalHost />
              </ToastProvider>
            </ConvexProviderWithClerk>
          </ClerkProvider>
        </SafeAreaView>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
