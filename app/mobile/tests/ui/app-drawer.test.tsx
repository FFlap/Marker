import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { AppDrawer } from '@/components/AppDrawer';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('convex/react', () => ({ useQuery: () => ({ username: 'viewer' }) }));

it('keeps drawer content inside the safe area and updates when insets change', async () => {
  const reduceMotion = jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  try {
    const content = (insets: { top: number; bottom: number; left: number; right: number }) => (
      <SafeAreaInsetsContext.Provider value={insets}>
        <AppDrawer />
      </SafeAreaInsetsContext.Provider>
    );
    const view = await render(content({ top: 59, bottom: 34, left: 0, right: 0 }));
    await fireEvent.press(view.getByRole('button', { name: 'Open account menu' }));

    expect(view.getByTestId('account-menu-panel')).toHaveStyle({
      paddingTop: 75,
      paddingBottom: 54,
      paddingLeft: 20,
    });

    await view.rerender(content({ top: 0, bottom: 21, left: 59, right: 0 }));
    expect(view.getByTestId('account-menu-panel')).toHaveStyle({
      paddingTop: 16,
      paddingBottom: 41,
      paddingLeft: 79,
    });
    expect(view.getByRole('menuitem', { name: 'Settings' })).toBeTruthy();
  } finally {
    reduceMotion.mockRestore();
  }
});
