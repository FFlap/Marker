import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

jest.mock('../../src/components/StartupQueries', () => ({
  StartupQueries: ({ children }: React.PropsWithChildren) => children,
}));

const mockRedirect = jest.fn(({ href }: { href: string }) => <Text>{href}</Text>);
let mockProfile: { username: string } | undefined;
let mockClerkLoaded = true;
let mockClerkSignedIn = false;
let mockConvexAuthenticated = false;
let mockConvexLoading = false;
let mockSegments: string[] = ['item', 'example-id'];
const mockEnsureAccount = jest.fn().mockResolvedValue(undefined);
jest.mock('@clerk/expo', () => ({
  useAuth: () => ({
    isLoaded: mockClerkLoaded,
    isSignedIn: mockClerkSignedIn,
    userId: mockClerkSignedIn ? 'user_test' : null,
  }),
  useClerk: () => ({ signOut: jest.fn() }),
  useUser: () => ({ isLoaded: true, user: mockClerkSignedIn ? { username: 'marker' } : null }),
}));
jest.mock('convex/react', () => ({
  useConvexAuth: () => ({
    isAuthenticated: mockConvexAuthenticated,
    isLoading: mockConvexLoading,
  }),
  useQuery: () => mockProfile,
  useMutation: () => mockEnsureAccount,
}));
jest.mock('@marker/shared/api', () => ({
  api: {
    profiles: { me: 'profiles.me' },
    clerkAuth: { ensureCurrentUser: 'clerkAuth.ensureCurrentUser' },
  },
}));
jest.mock('expo-router', () => ({
  Redirect: (props: { href: string }) => mockRedirect(props),
  useSegments: () => mockSegments,
}));

jest.mock('../../src/app/(tabs)/index', () => {
  const { Text } = require('react-native');
  return { __esModule: true, default: () => <Text>Library shell</Text> };
});

import { AuthBoundary as ScreenAuthBoundary } from '../../src/components/AuthBoundary';
import { AccountProvider } from '../../src/hooks/useAccount';
function AuthBoundary({ children }: { children: React.ReactNode }) {
  return (
    <AccountProvider>
      <ScreenAuthBoundary
        routeName={mockSegments[0] === '(tabs)' ? 'index' : mockSegments.join('/')}
      >
        {children}
      </ScreenAuthBoundary>
    </AccountProvider>
  );
}

beforeEach(() => {
  mockRedirect.mockClear();
  mockProfile = undefined;
  mockClerkLoaded = true;
  mockClerkSignedIn = false;
  mockConvexAuthenticated = false;
  mockConvexLoading = false;
  mockSegments = ['item', 'example-id'];
});

it('redirects an expired session before Convex finishes clearing auth', async () => {
  mockConvexAuthenticated = true;
  mockConvexLoading = true;

  const view = await render(
    <AuthBoundary>
      <Text>Protected screen</Text>
    </AuthBoundary>,
  );
  expect(mockRedirect).toHaveBeenCalledWith({ href: '/sign-in' });
  expect(view.getByText('/sign-in')).toBeTruthy();
  expect(view.queryByText('Protected screen')).toBeNull();
});

it('keeps the sign-in route available after a session expires', async () => {
  mockSegments = ['sign-in'];

  const view = await render(
    <AuthBoundary>
      <Text>Sign in form</Text>
    </AuthBoundary>,
  );

  expect(mockRedirect).not.toHaveBeenCalled();
  expect(view.getByText('Sign in form')).toBeTruthy();
});

it('shows the startup skeleton while Clerk restores the cached session', async () => {
  mockClerkLoaded = false;

  const view = await render(
    <AuthBoundary>
      <Text>Protected screen</Text>
    </AuthBoundary>,
  );

  expect(view.getByText('Library shell')).toBeTruthy();
  expect(view.queryByText('Protected screen')).toBeNull();
  expect(mockRedirect).not.toHaveBeenCalled();
});

it('shows the startup skeleton while Convex authenticates a valid Clerk session', async () => {
  mockClerkSignedIn = true;
  mockConvexLoading = true;

  const view = await render(
    <AuthBoundary>
      <Text>Protected screen</Text>
    </AuthBoundary>,
  );

  expect(view.getByText('Library shell')).toBeTruthy();
  expect(view.queryByText('Protected screen')).toBeNull();
  expect(mockRedirect).not.toHaveBeenCalled();
});

it('keeps the startup skeleton visible while the authenticated profile loads', async () => {
  mockClerkSignedIn = true;
  mockConvexAuthenticated = true;
  const view = await render(
    <AuthBoundary>
      <Text>Protected screen</Text>
    </AuthBoundary>,
  );
  expect(view.getByText('Library shell')).toBeTruthy();
  expect(view.queryByText('Protected screen')).toBeNull();
});

it('keeps the library route mounted as authentication resolves', async () => {
  mockSegments = ['(tabs)'];
  mockClerkLoaded = false;
  let mounts = 0;
  function LibraryRoute() {
    React.useEffect(() => {
      mounts += 1;
    }, []);
    return <Text>Library route</Text>;
  }
  const view = await render(
    <AuthBoundary>
      <LibraryRoute />
    </AuthBoundary>,
  );
  expect(view.getByText('Library route')).toBeTruthy();
  mockClerkLoaded = true;
  mockClerkSignedIn = true;
  mockConvexLoading = true;
  await view.rerender(
    <AuthBoundary>
      <LibraryRoute />
    </AuthBoundary>,
  );
  mockConvexLoading = false;
  mockConvexAuthenticated = true;
  await view.rerender(
    <AuthBoundary>
      <LibraryRoute />
    </AuthBoundary>,
  );
  mockProfile = { username: 'marker' };
  await view.rerender(
    <AuthBoundary>
      <LibraryRoute />
    </AuthBoundary>,
  );
  expect(mounts).toBe(1);
  expect(mockRedirect).not.toHaveBeenCalled();
});

it('shares account initialization across routes and preserves navigation while auth resolves', async () => {
  mockClerkLoaded = false;
  let navigatorMounts = 0;
  let protectedMounts = 0;
  function ProtectedScreen() {
    React.useEffect(() => {
      protectedMounts += 1;
    }, []);
    return <Text>Deep-linked item</Text>;
  }
  function Navigator() {
    React.useEffect(() => {
      navigatorMounts += 1;
    }, []);
    return (
      <>
        <ScreenAuthBoundary routeName="index">
          <Text>Library route</Text>
        </ScreenAuthBoundary>
        <ScreenAuthBoundary routeName="item/[id]">
          <ProtectedScreen />
        </ScreenAuthBoundary>
      </>
    );
  }
  const tree = () => (
    <AccountProvider>
      <Navigator />
    </AccountProvider>
  );
  mockEnsureAccount.mockClear();
  const view = await render(tree());
  expect(protectedMounts).toBe(0);
  expect(view.getByText('Library route')).toBeTruthy();
  mockClerkLoaded = true;
  mockClerkSignedIn = true;
  mockConvexAuthenticated = true;
  mockProfile = { username: 'marker' };
  await view.rerender(tree());
  expect(navigatorMounts).toBe(1);
  expect(protectedMounts).toBe(1);
  expect(mockEnsureAccount).toHaveBeenCalledTimes(1);
  expect(view.getByText('Deep-linked item')).toBeTruthy();
  expect(mockRedirect).not.toHaveBeenCalled();
});
