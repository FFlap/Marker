import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.unmock('../../src/hooks/operation-session');

const mockClerk = {
  session: { id: 'session_test' },
  addListener: jest.fn(() => jest.fn()),
};
let mockFontsLoaded = false;
let mockFontError: Error | null = null;
process.env.EXPO_PUBLIC_CONVEX_URL = 'https://example.convex.cloud';
process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_example';
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(),
  setOptions: jest.fn(),
  hide: jest.fn(),
}));
jest.mock('@clerk/expo', () => ({
  ClerkProvider: ({ children }: React.PropsWithChildren) => children,
  useAuth: () => ({ sessionId: 'session_test' }),
  useClerk: () => mockClerk,
}));
jest.mock('@clerk/expo/token-cache', () => ({ tokenCache: {} }));
jest.mock('convex/react', () => ({ ConvexReactClient: jest.fn() }));
jest.mock('convex/react-clerk', () => ({
  ConvexProviderWithClerk: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: require('react-native').View,
}));
jest.mock('expo-router', () => {
  const { ScreenView } = require('../../src/components/ScreenLayout');
  const Stack = Object.assign(() => <ScreenView testID="route-content" />, { Screen: () => null });
  return { Stack };
});
jest.mock('@expo-google-fonts/albert-sans', () => ({
  useFonts: () => [mockFontsLoaded, mockFontError],
}));
jest.mock('../../src/hooks/useCalendar', () => ({
  CalendarProvider: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock('../../src/hooks/useAccount', () => ({
  AccountProvider: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock('../../src/components/AuthBoundary', () => ({ AuthBoundary: () => null }));
jest.mock('../../src/components/ui/Toast', () => ({
  ToastProvider: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock('../../src/global.css', () => ({}));

import * as SplashScreen from 'expo-splash-screen';
// Load after configuring the test environment.
const RootModule = require('../../src/app/_layout');
const StartupSplashBoundary = RootModule.StartupSplashBoundary;
const RootLayout = RootModule.default;
import { ScreenView } from '../../src/components/ScreenLayout';

beforeEach(() => {
  jest.clearAllMocks();
  mockFontsLoaded = false;
  mockFontError = null;
});

it('waits for custom fonts before mounting screen text and dismisses on its first layout', async () => {
  const view = await render(<RootLayout />);
  expect(view.queryByTestId('route-content')).toBeNull();
  expect(SplashScreen.hide).not.toHaveBeenCalled();

  mockFontsLoaded = true;
  await view.rerender(<RootLayout />);
  expect(SplashScreen.hide).not.toHaveBeenCalled();
  await fireEvent(view.getByTestId('route-content'), 'layout', {
    nativeEvent: { layout: { width: 400, height: 800 } },
  });
  expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
});

it('still reaches screen readiness when fonts fail to load', async () => {
  mockFontError = new Error('font load failed');
  const view = await render(<RootLayout />);
  expect(SplashScreen.hide).not.toHaveBeenCalled();
  await fireEvent(view.getByTestId('route-content'), 'layout', {
    nativeEvent: { layout: { width: 400, height: 800 } },
  });
  expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
});

it('retains splash until content has size and dismisses once across screens and rerenders', async () => {
  const screen = (second = false) => (
    <StartupSplashBoundary>
      <ScreenView testID="first" />
      {second && <ScreenView testID="second" />}
    </StartupSplashBoundary>
  );
  const view = await render(screen());
  expect(SplashScreen.hide).not.toHaveBeenCalled();
  await fireEvent(view.getByTestId('first'), 'layout', {
    nativeEvent: { layout: { width: 0, height: 800 } },
  });
  expect(SplashScreen.hide).not.toHaveBeenCalled();
  await fireEvent(view.getByTestId('first'), 'layout', {
    nativeEvent: { layout: { width: 400, height: 800 } },
  });
  await view.rerender(screen(true));
  for (const id of ['first', 'second'])
    await fireEvent(view.getByTestId(id), 'layout', {
      nativeEvent: { layout: { width: 400, height: 800 } },
    });
  expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
});
