import React from 'react';
import { render, userEvent, waitFor } from '@testing-library/react-native';
let mockSettings = {
  defaultView: 'list' as 'list' | 'posters',
  gridColumns: 3 as 3 | 4 | 5,
  listTextSize: 'medium' as 'small' | 'medium' | 'large',
  listColumns: 1 as 1 | 2,
};
const mockSetSettings = jest.fn(async (patch: Partial<typeof mockSettings>) => {
  mockSettings = { ...mockSettings, ...patch };
});
jest.mock('convex/react', () => ({
  useQuery: () => mockSettings,
  useMutation: () => mockSetSettings,
}));
jest.mock('../../convex/_generated/api', () => ({
  api: { settings: { getSettings: 'getSettings', setSettings: 'setSettings' } },
}));
jest.mock('@clerk/expo', () => ({ useClerk: () => ({ signOut: jest.fn() }) }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));
jest.mock('expo-image', () => ({ Image: require('react-native').Image }));
import Settings from '../../src/app/(tabs)/settings';
import { ToastProvider } from '../../src/components/ui/Toast';
it('shows account-login extension guidance and changes view', async () => {
  mockSetSettings.mockClear();
  mockSettings = {
    defaultView: 'list',
    gridColumns: 3,
    listTextSize: 'medium',
    listColumns: 1,
  };
  const user = userEvent.setup();
  const view = await render(
    <ToastProvider>
      <Settings />
    </ToastProvider>,
  );
  expect(view.getByText(/sign in with this same account/i)).toBeTruthy();
  expect(view.getByLabelText('Back to library')).toBeTruthy();
  expect(view.queryByText(/token label/i)).toBeNull();
  await user.press(view.getByText('Posters'));
  await waitFor(() => expect(mockSetSettings).toHaveBeenCalledWith({ defaultView: 'posters' }));
  expect(view.getByText('Grid scale')).toBeTruthy();
  await user.press(view.getByLabelText('5 columns'));
  await waitFor(() => expect(mockSetSettings).toHaveBeenCalledWith({ gridColumns: 5 }));
});

it('customizes list text and column count', async () => {
  mockSetSettings.mockClear();
  mockSettings = {
    defaultView: 'list',
    gridColumns: 3,
    listTextSize: 'medium',
    listColumns: 1,
  };
  const user = userEvent.setup();
  const view = await render(
    <ToastProvider>
      <Settings />
    </ToastProvider>,
  );
  await user.press(view.getByText('Large'));
  await waitFor(() => expect(mockSetSettings).toHaveBeenCalledWith({ listTextSize: 'large' }));
  await user.press(view.getByText('Two columns'));
  await waitFor(() => expect(mockSetSettings).toHaveBeenCalledWith({ listColumns: 2 }));
});
