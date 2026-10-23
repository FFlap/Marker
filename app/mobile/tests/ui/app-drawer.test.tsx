import React from 'react';
import { act, render } from '@testing-library/react-native';

let mockProfile: { username: string } | null | undefined;
jest.mock('convex/react', () => ({
  useQuery: (_ref: unknown, args: unknown) => (args === 'skip' ? undefined : mockProfile),
}));
jest.mock('@marker/shared/api', () => ({ api: { profiles: { me: 'profiles.me' } } }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-image', () => ({ Image: require('react-native').Image }));

import { AppDrawer, type AppDrawerHandle } from '../../src/components/AppDrawer';
import { AccountLoadingContext } from '../../src/hooks/useAccountLoading';

it.each([
  { profileReady: false, profile: { username: 'marker' } },
  { profileReady: true, profile: undefined },
  { profileReady: true, profile: null },
])('blocks edge-swipe opening until a profile is ready (%p)', async ({ profileReady, profile }) => {
  mockProfile = profile;
  const ref = React.createRef<AppDrawerHandle>();
  const view = await render(
    <AccountLoadingContext value={{ profileReady, libraryReady: false }}>
      <AppDrawer ref={ref} />
    </AccountLoadingContext>,
  );
  expect(view.getByRole('button', { name: 'Open account menu' })).toBeDisabled();

  // The library's edge-swipe gesture calls this imperative entry point.
  await act(() => ref.current?.open());
  expect(view.queryByTestId('account-menu-panel')).toBeNull();

  mockProfile = { username: 'marker' };
  await view.rerender(
    <AccountLoadingContext value={{ profileReady: true, libraryReady: true }}>
      <AppDrawer ref={ref} />
    </AccountLoadingContext>,
  );
  await act(() => ref.current?.open());
  expect(view.getByRole('menuitem', { name: 'Explore' })).toBeTruthy();
});
