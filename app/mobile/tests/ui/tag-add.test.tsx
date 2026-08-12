import React from 'react';
import { render, userEvent, waitFor } from '@testing-library/react-native';

const mockAddTagToItems = jest.fn().mockResolvedValue({ updated: 2 });
const mockItems = [
  {
    _id: 'existing',
    _creationTime: 1,
    userId: 'u',
    tmdbId: 1,
    mediaType: 'movie' as const,
    title: 'Already Here',
    status: 'watched' as const,
    timesWatched: 1,
    tags: ['Favorites'],
    rank: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    _id: 'first',
    _creationTime: 2,
    userId: 'u',
    tmdbId: 2,
    mediaType: 'movie' as const,
    title: 'First Addition',
    status: 'watchlist' as const,
    timesWatched: 0,
    tags: [],
    rank: 2,
    createdAt: 2,
    updatedAt: 2,
  },
  {
    _id: 'second',
    _creationTime: 3,
    userId: 'u',
    tmdbId: 3,
    mediaType: 'tv' as const,
    title: 'Second Addition',
    status: 'watching' as const,
    timesWatched: 0,
    tags: ['Weekend'],
    rank: 3,
    createdAt: 3,
    updatedAt: 3,
  },
];

jest.mock('convex/react', () => ({
  useQuery: () => mockItems,
  useMutation: () => mockAddTagToItems,
}));
jest.mock('../../convex/_generated/api', () => ({
  api: {
    library: {
      listItems: 'library.listItems',
      addTagToItems: 'library.addTagToItems',
    },
  },
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ tag: 'Favorites' }),
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
  },
}));
jest.mock('expo-image', () => ({ Image: require('react-native').Image }));

import AddTitlesToTagScreen from '@/app/tags/add/[tag]';
import { ToastProvider } from '@/components/ui/Toast';

describe('Add titles to tag', () => {
  beforeEach(() => {
    mockAddTagToItems.mockClear();
    jest.requireMock('expo-router').router.back.mockClear();
  });

  it('searches, multi-selects, and confirms library titles', async () => {
    const user = userEvent.setup();
    const view = await render(
      <ToastProvider>
        <AddTitlesToTagScreen />
      </ToastProvider>,
    );

    expect(view.getByLabelText('Already Here, already in Favorites')).toBeDisabled();
    await user.type(view.getByLabelText('Search your library'), 'First');
    expect(view.getByText('First Addition')).toBeTruthy();
    expect(view.queryByText('Second Addition')).toBeNull();
    await user.clear(view.getByLabelText('Search your library'));

    await user.press(view.getByLabelText('Add First Addition'));
    await user.press(view.getByLabelText('Add Second Addition'));
    expect(view.getByText('2')).toBeTruthy();
    expect(view.getByText('titles selected')).toBeTruthy();
    await user.press(view.getByTestId('confirm-add-tag-titles'));

    await waitFor(() =>
      expect(mockAddTagToItems).toHaveBeenCalledWith({
        tag: 'Favorites',
        itemIds: ['first', 'second'],
      }),
    );
    expect(jest.requireMock('expo-router').router.back).toHaveBeenCalled();
  });
});
