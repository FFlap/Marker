import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { LayoutChangeEvent } from 'react-native';

jest.mock('../../src/components/StartupQueries', () => ({
  StartupQueries: ({ children }: React.PropsWithChildren) => children,
}));

let mockClerkLoaded = true;
jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useSegments: () => ['item', 'example-id'],
  Redirect: ({ href }: { href: string }) => {
    const { Text } = require('react-native');
    return <Text>{href}</Text>;
  },
}));
jest.mock('@clerk/expo', () => ({
  useAuth: () => ({ isLoaded: mockClerkLoaded, isSignedIn: true }),
  useClerk: () => ({ signOut: jest.fn() }),
}));
jest.mock('convex/react', () => ({ useQuery: () => undefined }));
jest.mock('../../src/hooks/useMarkerAccount', () => ({
  useMarkerAccount: () => ({
    isAuthenticated: true,
    isLoading: false,
    accountReady: false,
    accountError: true,
    retryAccount: jest.fn(),
  }),
}));
jest.mock('../../src/app/(tabs)/index', () => {
  const { ScreenView } = require('../../src/components/ScreenLayout');
  return { __esModule: true, default: () => <ScreenView testID="account-loading-library" /> };
});
jest.mock('../../src/components/ProfileForm', () => {
  const { Text } = require('react-native');
  return { ProfileForm: () => <Text>Profile fields</Text> };
});

import {
  ScreenView,
  ScreenKeyboardScrollView,
  ScreenReadinessContext,
} from '../../src/components/ScreenLayout';
const mockReady = jest.fn();
const renderReady = (children: React.ReactNode) =>
  render(<ScreenReadinessContext value={mockReady}>{children}</ScreenReadinessContext>);
import { AuthBoundary as ScreenAuthBoundary } from '../../src/components/AuthBoundary';
import { AccountProvider } from '../../src/hooks/useAccount';
function AuthBoundary({ children }: { children: React.ReactNode }) {
  return (
    <AccountProvider>
      <ScreenAuthBoundary routeName="item/[id]">{children}</ScreenAuthBoundary>
    </AccountProvider>
  );
}
import NotFound from '../../src/app/+not-found';
import ProfileSetup from '../../src/app/profile-setup';
import { ScreenErrorBoundary } from '../../src/components/ScreenErrorBoundary';

const layout = (width: number, height: number) =>
  ({ nativeEvent: { layout: { width, height } } }) as LayoutChangeEvent;

beforeEach(() => {
  jest.clearAllMocks();
  mockClerkLoaded = true;
});

it('reports readiness from the Library shell while the account is restoring', async () => {
  mockClerkLoaded = false;
  const view = await renderReady(
    <AuthBoundary>
      <ProfileSetup />
    </AuthBoundary>,
  );
  expect(mockReady).not.toHaveBeenCalled();
  expect(view.queryByText('Create your profile')).toBeNull();
  await fireEvent(view.getByTestId('account-loading-library'), 'layout', layout(400, 800));
  expect(mockReady).toHaveBeenCalledTimes(1);
});

it('preserves the native root ref, styles and responder props without adding a View', async () => {
  const ref = React.createRef<import('react-native').View>();
  const onTouchStart = jest.fn();
  const style = { flex: 1, padding: 12 };
  const view = await render(
    <ScreenView ref={ref} testID="root" style={style} onTouchStart={onTouchStart} />,
  );
  expect(ref.current).not.toBeNull();
  expect(typeof ref.current?.measureInWindow).toBe('function');
  expect(view.toJSON()).toMatchObject({ type: 'View', props: { testID: 'root', style } });
  expect(view.getByTestId('root').props.onTouchStart).toBe(onTouchStart);
});

it.each([ScreenView, ScreenKeyboardScrollView])(
  'reports only positive layouts and composes caller callbacks (%p)',
  async (Screen) => {
    const onLayout = jest.fn();
    const view = await renderReady(<Screen testID="screen" onLayout={onLayout} />);
    expect(mockReady).not.toHaveBeenCalled();
    await fireEvent(view.getByTestId('screen'), 'layout', layout(0, 800));
    await fireEvent(view.getByTestId('screen'), 'layout', layout(400, 0));
    expect(mockReady).not.toHaveBeenCalled();
    await fireEvent(view.getByTestId('screen'), 'layout', layout(400, 800));
    expect(mockReady).toHaveBeenCalledTimes(1);
    expect(onLayout).toHaveBeenCalledTimes(3);
    expect(onLayout).toHaveBeenLastCalledWith(layout(400, 800));
    expect(onLayout.mock.invocationCallOrder[2]).toBeLessThan(
      mockReady.mock.invocationCallOrder[0],
    );
  },
);

it('reveals profile setup only after its native content lays out', async () => {
  const view = await renderReady(<ProfileSetup />);
  expect(mockReady).not.toHaveBeenCalled();
  await fireEvent(view.getByText('Create your profile'), 'layout', layout(400, 800));
  expect(mockReady).toHaveBeenCalledTimes(1);
});

it('reveals a root or screen error fallback after its native content lays out', async () => {
  const consoleError = console.error as jest.Mock;
  const previous = consoleError.getMockImplementation();
  consoleError.mockImplementation(() => {});
  function BrokenScreen(): React.ReactNode {
    throw new Error('startup render failed');
  }
  try {
    const view = await renderReady(
      <ScreenErrorBoundary>
        <BrokenScreen />
      </ScreenErrorBoundary>,
    );
    expect(mockReady).not.toHaveBeenCalled();
    await fireEvent(view.getByText('Something went wrong.'), 'layout', layout(400, 800));
    expect(mockReady).toHaveBeenCalledTimes(1);
  } finally {
    consoleError.mockImplementation(previous);
  }
});

it('reveals account errors without depending on a mounted navigator', async () => {
  const view = await renderReady(
    <AuthBoundary>
      <ProfileSetup />
    </AuthBoundary>,
  );
  expect(mockReady).not.toHaveBeenCalled();
  await fireEvent(
    view.getByText('We couldn’t finish setting up your account'),
    'layout',
    layout(400, 800),
  );
  expect(mockReady).toHaveBeenCalledTimes(1);
});

it('sends unknown cold-entry links to a screen with explicit readiness', async () => {
  const view = await renderReady(<NotFound />);
  expect(view.getByText('/(tabs)')).toBeTruthy();
  expect(mockReady).not.toHaveBeenCalled();
});
