import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockToken = jest.fn().mockResolvedValue('token');
const mockSetAvatar = jest.fn().mockResolvedValue(null);
const mockImage = new Blob(['image'], { type: 'image/jpeg' });
jest.mock('@clerk/expo', () => ({
  useAuth: () => ({ getToken: mockToken }),
}));
jest.mock('convex/react', () => ({
  useQuery: () => ({ username: 'viewer', isPublic: false }),
  useMutation: (ref: string) => (ref === 'upload' ? async () => '/avatar/upload' : mockSetAvatar),
}));
jest.mock('../../convex/_generated/api', () => ({
  api: { profiles: { me: 'me', generateAvatarUploadUrl: 'upload', setAvatar: 'setAvatar' } },
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: async () => ({
    canceled: false,
    assets: [{ file: mockImage, mimeType: 'image/jpeg' }],
  }),
}));
jest.mock('../../src/lib/convexUrl', () => ({
  getConvexSiteUrl: () => 'https://example.convex.site',
}));
import { ProfileForm } from '../../src/components/ProfileForm';

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});
it('uploads avatars with the current Clerk session token', async () => {
  mockToken.mockClear();
  mockSetAvatar.mockClear();
  const fetchMock = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ storageId: 'image-id' }) });
  global.fetch = fetchMock;
  const view = await render(<ProfileForm onSaved={jest.fn()} />);
  await fireEvent.press(view.getByLabelText('Add profile photo'));
  await waitFor(() => expect(mockSetAvatar).toHaveBeenCalledWith({ storageId: 'image-id' }));
  expect(mockToken).toHaveBeenCalledWith();
  expect(fetchMock).toHaveBeenCalledWith(
    'https://example.convex.site/avatar/upload',
    expect.objectContaining({
      method: 'POST',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'image/jpeg' },
      body: mockImage,
    }),
  );
});
