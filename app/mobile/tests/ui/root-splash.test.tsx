import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

process.env.EXPO_PUBLIC_CONVEX_URL = 'https://example.convex.cloud';
process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_example';
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(),
  setOptions: jest.fn(),
  hide: jest.fn(),
}));
jest.mock('@clerk/expo', () => ({
  ClerkProvider: ({ children }: React.PropsWithChildren) => children,
}));
jest.mock('@clerk/expo/token-cache', () => ({ tokenCache: {} }));
jest.mock('convex/react', () => ({ ConvexReactClient: jest.fn() }));
jest.mock('convex/react-clerk', () => ({ ConvexProviderWithClerk: () => null }));
jest.mock('expo-router', () => ({ Stack: () => null }));
jest.mock('@expo-google-fonts/albert-sans', () => ({ useFonts: jest.fn() }));
jest.mock('../../src/hooks/useCalendar', () => ({ CalendarProvider: () => null }));
jest.mock('../../src/hooks/useAccount', () => ({ AccountProvider: () => null }));
jest.mock('../../src/components/AuthBoundary', () => ({ AuthBoundary: () => null }));
jest.mock('../../src/components/ui/Toast', () => ({ ToastProvider: () => null }));
jest.mock('../../src/global.css', () => ({}));

import * as SplashScreen from 'expo-splash-screen';
// Load after configuring the test environment.
const RootModule = require('../../src/app/_layout');
const StartupSplashBoundary = RootModule.StartupSplashBoundary;
import { ScreenView } from '../../src/components/ScreenLayout';

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
