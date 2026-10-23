import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ClientWriteSession } from '@marker/shared/clientOperations';
import { OperationSessionContext } from '../../src/hooks/operation-session';

jest.unmock('../../src/hooks/operation-session');

const mockToken = jest.fn().mockResolvedValue('token');
const mockSetAvatar = jest.fn().mockResolvedValue(null);
const mockSave = jest.fn().mockResolvedValue(null);
const mockPickImage = jest.fn();
const mockToast = jest.fn();
let mockProfile = { username: 'viewer', isPublic: false };
let mockSessionId = 'session_a';
let mockSession: ClientWriteSession;
const mockImage = new Blob(['image'], { type: 'image/jpeg' });
const selectedImage = () => ({
  canceled: false,
  assets: [{ file: mockImage, mimeType: 'image/jpeg' }],
});
const uploadResponse = () => ({
  status: 200,
  arrayBuffer: async () =>
    new TextEncoder().encode(JSON.stringify({ storageId: 'image-id' })).buffer,
});
function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
jest.mock('@clerk/expo', () => ({
  useAuth: () => ({ getToken: mockToken }),
}));
jest.mock('convex/react', () => ({
  useQuery: () => mockProfile,
  useMutation: (ref: string) =>
    ref === 'upload' ? async () => '/avatar/upload' : ref === 'save' ? mockSave : mockSetAvatar,
}));
jest.mock('@marker/shared/api', () => ({
  api: {
    profiles: { me: 'me', save: 'save', generateAvatarUploadUrl: 'upload', setAvatar: 'setAvatar' },
  },
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (...args: unknown[]) => mockPickImage(...args),
}));
jest.mock('../../src/components/ui/Toast', () => ({
  useToast: () => ({ show: mockToast }),
}));
jest.mock('../../src/lib/convexUrl', () => ({
  getConvexSiteUrl: () => 'https://example.convex.site',
}));
import { ProfileForm } from '../../src/components/ProfileForm';

const form = (onSaved = jest.fn()) => (
  <OperationSessionContext value={mockSession}>
    <ProfileForm onSaved={onSaved} />
  </OperationSessionContext>
);
const originalFetch = global.fetch;
beforeEach(() => {
  jest.clearAllMocks();
  mockProfile = { username: 'viewer', isPublic: false };
  mockSessionId = 'session_a';
  mockSession = new ClientWriteSession(mockSessionId, () => mockSessionId);
  mockPickImage.mockResolvedValue(selectedImage());
});
afterEach(() => {
  global.fetch = originalFetch;
});
it('uploads avatars with the current Clerk session token', async () => {
  const fetchMock = jest.fn().mockResolvedValue(uploadResponse());
  global.fetch = fetchMock;
  const view = await render(form());
  await fireEvent.press(view.getByLabelText('Add profile photo'));
  await waitFor(() => expect(mockSetAvatar).toHaveBeenCalledWith({ storageId: 'image-id' }));
  expect(mockToken).toHaveBeenCalledWith();
  expect(fetchMock).toHaveBeenCalledWith(
    new URL('https://example.convex.site/avatar/upload'),
    expect.objectContaining({
      method: 'POST',
      headers: { authorization: 'Bearer token', 'content-type': 'image/jpeg' },
      body: mockImage,
    }),
  );
});

it('closes the profile form when its live query updates before the save resolves', async () => {
  const save = deferred<null>();
  mockSave.mockReturnValueOnce(save.promise);
  const onSaved = jest.fn();
  const view = await render(form(onSaved));
  await fireEvent.changeText(view.getByLabelText('Username'), 'updated_viewer');
  await fireEvent.press(view.getByText('Save changes'));
  await waitFor(() => expect(mockSave).toHaveBeenCalled());

  mockProfile = { ...mockProfile, username: 'updated_viewer' };
  await view.rerender(form(onSaved));
  await act(async () => save.resolve(null));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
});

it('finishes an accepted avatar upload after navigation without showing a stale toast', async () => {
  const upload = deferred<ReturnType<typeof uploadResponse>>();
  const fetchMock = jest.fn().mockReturnValue(upload.promise);
  global.fetch = fetchMock;
  const view = await render(form());
  await fireEvent.press(view.getByLabelText('Add profile photo'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  await view.unmount();
  await act(async () => upload.resolve(uploadResponse()));

  await waitFor(() => expect(mockSetAvatar).toHaveBeenCalledWith({ storageId: 'image-id' }));
  expect(mockToast).not.toHaveBeenCalled();
});

it('does not start an upload when the image picker returns after navigation', async () => {
  const picker = deferred<ReturnType<typeof selectedImage>>();
  mockPickImage.mockReturnValueOnce(picker.promise);
  const fetchMock = jest.fn();
  global.fetch = fetchMock;
  const view = await render(form());
  await fireEvent.press(view.getByLabelText('Add profile photo'));
  await view.unmount();
  await act(async () => picker.resolve(selectedImage()));

  expect(fetchMock).not.toHaveBeenCalled();
  expect(mockSetAvatar).not.toHaveBeenCalled();
});

it('does not publish a selected avatar into a replacement Clerk session', async () => {
  const upload = deferred<ReturnType<typeof uploadResponse>>();
  const fetchMock = jest.fn().mockReturnValue(upload.promise);
  global.fetch = fetchMock;
  const view = await render(form());
  await fireEvent.press(view.getByLabelText('Add profile photo'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  mockSessionId = 'session_b';
  await act(async () => upload.resolve(uploadResponse()));

  expect(mockSetAvatar).not.toHaveBeenCalled();
  expect(mockToast).not.toHaveBeenCalled();
});

it('clears the photo spinner after a cancelled picker or invalid upload response', async () => {
  mockPickImage.mockResolvedValueOnce({ canceled: true, assets: null });
  global.fetch = jest.fn().mockResolvedValue({
    status: 200,
    arrayBuffer: async () => new TextEncoder().encode('{}').buffer,
  });
  const view = await render(form());
  await fireEvent.press(view.getByLabelText('Add profile photo'));
  await waitFor(() => expect(view.getByText('Save changes')).toBeEnabled());
  await fireEvent.press(view.getByLabelText('Add profile photo'));
  await waitFor(() => expect(mockToast).toHaveBeenCalledWith('Couldn’t update your profile photo'));

  expect(view.getByText('Save changes')).toBeEnabled();
  expect(mockSetAvatar).not.toHaveBeenCalled();
});
