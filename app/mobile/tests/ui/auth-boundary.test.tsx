import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

const mockRedirect = jest.fn(({ href }: { href: string }) => <Text>{href}</Text>);
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
  useQuery: () => undefined,
  useMutation: () => mockEnsureAccount,
}));
jest.mock('../../convex/_generated/api', () => ({
  api: {
    profiles: { me: 'profiles.me' },
    clerkAuth: { ensureCurrentUser: 'clerkAuth.ensureCurrentUser' },
  },
}));
jest.mock('expo-router', () => ({
  Redirect: (props: { href: string }) => mockRedirect(props),
  useSegments: () => mockSegments,
}));

import { AuthBoundary } from '../../src/components/AuthBoundary';

beforeEach(() => {
  mockRedirect.mockClear();
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

it('shows visible progress while Clerk restores the cached session', async () => {
  mockClerkLoaded = false;

  const view = await render(
    <AuthBoundary>
      <Text>Protected screen</Text>
    </AuthBoundary>,
  );

  expect(view.getByLabelText('Loading your account')).toBeTruthy();
  expect(mockRedirect).not.toHaveBeenCalled();
});

it('shows visible progress while Convex authenticates a valid Clerk session', async () => {
  mockClerkSignedIn = true;
  mockConvexLoading = true;

  const view = await render(
    <AuthBoundary>
      <Text>Protected screen</Text>
    </AuthBoundary>,
  );

  expect(view.getByLabelText('Loading your account')).toBeTruthy();
  expect(mockRedirect).not.toHaveBeenCalled();
});

it('keeps progress visible while the authenticated profile loads', async () => {
  mockClerkSignedIn = true;
  mockConvexAuthenticated = true;
  const view = await render(
    <AuthBoundary>
      <Text>Protected screen</Text>
    </AuthBoundary>,
  );
  expect(view.getByLabelText('Loading your account')).toBeTruthy();
  expect(view.queryByText('Protected screen')).toBeNull();
});
