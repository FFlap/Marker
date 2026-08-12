import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

const mockRedirect = jest.fn(({ href }: { href: string }) => <Text>{href}</Text>);
jest.mock('@clerk/expo', () => ({
  useAuth: () => ({ userId: null }),
  useUser: () => ({ isLoaded: true, user: null }),
}));
jest.mock('convex/react', () => ({
  useConvexAuth: () => ({ isAuthenticated: false, isLoading: false }),
  useQuery: () => undefined,
  useMutation: () => jest.fn(),
}));
jest.mock('../../convex/_generated/api', () => ({
  api: {
    profiles: { me: 'profiles.me' },
    clerkAuth: { ensureCurrentUser: 'clerkAuth.ensureCurrentUser' },
  },
}));
jest.mock('expo-router', () => ({
  Redirect: (props: { href: string }) => mockRedirect(props),
  useSegments: () => ['item', 'example-id'],
}));

import { AuthBoundary } from '../../src/components/AuthBoundary';

it('redirects an unauthenticated protected deep link to sign-in', async () => {
  const view = await render(
    <AuthBoundary>
      <Text>Protected screen</Text>
    </AuthBoundary>,
  );
  expect(mockRedirect).toHaveBeenCalledWith({ href: '/sign-in' });
  expect(view.getByText('/sign-in')).toBeTruthy();
  expect(view.queryByText('Protected screen')).toBeNull();
});
