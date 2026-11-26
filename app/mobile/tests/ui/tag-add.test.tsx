import React from 'react';
import { render, userEvent, waitFor } from '@testing-library/react-native';

const mockAddTagToItems = jest.fn().mockResolvedValue({ updated: 2, full: [] });
const mockRemoveTagFromItems = jest.fn().mockResolvedValue({ updated: 1 });
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
  useMutation: (ref: string) =>
    ref === 'library/items:removeTagFromItems' ? mockRemoveTagFromItems : mockAddTagToItems,
}));
jest.mock('@marker/shared/api', () => ({
  api: {
    library: {
      items: {
        listItems: 'library/items:listItems',
        addTagToItems: 'library/items:addTagToItems',
        removeTagFromItems: 'library/items:removeTagFromItems',
      },
    },
  },
}));
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ tag: 'Favorites' }),
  useNavigation: () => ({ dispatch: jest.fn() }),
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
    mockRemoveTagFromItems.mockClear();
    jest.requireMock('expo-router').router.back.mockClear();
  });

  it('searches, toggles membership both ways, and saves the changes', async () => {
    const user = userEvent.setup();
    const view = await render(
      <ToastProvider>
        <AddTitlesToTagScreen />
      </ToastProvider>,
    );

    expect(view.getByLabelText('Already Here').props.accessibilityState.checked).toBe(true);
    expect(view.queryByTestId('confirm-add-tag-titles')).toBeNull();
    await user.type(view.getByLabelText('Search your library'), 'First');
    expect(view.getByText('First Addition')).toBeTruthy();
    expect(view.queryByText('Second Addition')).toBeNull();
    await user.clear(view.getByLabelText('Search your library'));

    await user.press(view.getByLabelText('First Addition'));
    await user.press(view.getByLabelText('Second Addition'));
    await user.press(view.getByLabelText('Already Here'));
    expect(view.getByText('Add 2 titles, remove 1 title')).toBeTruthy();
    await user.press(view.getByTestId('confirm-add-tag-titles'));

    await waitFor(() =>
      expect(mockAddTagToItems).toHaveBeenCalledWith({
        tag: 'Favorites',
        itemIds: ['first', 'second'],
      }),
    );
    expect(mockRemoveTagFromItems).toHaveBeenCalledWith({
      tag: 'Favorites',
      itemIds: ['existing'],
    });
    expect(jest.requireMock('expo-router').router.back).toHaveBeenCalled();
  });
});
