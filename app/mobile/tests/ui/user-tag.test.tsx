import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

const mockCollection = {
  username: 'curator',
  tag: 'Favorites',
  isOwner: false,
  isPublic: true,
  titles: [
    {
      tmdbId: 2,
      mediaType: 'tv' as const,
      title: 'Second Choice',
      rank: 2,
      status: 'watchlist' as const,
    },
    {
      tmdbId: 1,
      mediaType: 'movie' as const,
      title: 'First Choice',
      rank: 1,
      status: 'watched' as const,
      rating: 9,
    },
  ],
};

jest.mock('convex/react', () => ({
  useQuery: (ref: string) =>
    ref === 'tags.publicByUser'
      ? mockCollection
      : ref === 'settings.getSettings'
        ? { gridColumns: 3 }
        : [],
  useMutation: () => jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../convex/_generated/api', () => ({
  api: {
    tags: { publicByUser: 'tags.publicByUser' },
    library: { items: { listItems: 'library/items:listItems' } },
    settings: { getSettings: 'settings.getSettings', setSettings: 'settings.setSettings' },
  },
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({
    username: 'curator',
    tag: 'Favorites',
  }),
  router: {
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  },
}));
jest.mock('expo-image', () => ({ Image: require('react-native').Image }));

import UserTagScreen from '@/app/u/[username]/tags/[tag]';

it('groups another user’s public tag by status with read-only filters', async () => {
  const view = await render(<UserTagScreen />);
  const labels = view
    .getAllByRole('button')
    .map((node) => node.props.accessibilityLabel)
    .filter((label) => /^\d+\./.test(label ?? ''));
  expect(labels).toEqual(['1. First Choice']);
  expect(view.getByText('Watched')).toBeTruthy();
  expect(view.getByText('Watchlist')).toBeTruthy();
  expect(view.queryByText('Curated by @curator')).toBeNull();
  expect(view.queryByLabelText('Tag visibility')).toBeNull();
  expect(view.getByLabelText('Filter tag titles')).toBeTruthy();

  await act(async () =>
    fireEvent.changeText(view.getByLabelText("Search curator's Favorites tag"), 'second'),
  );
  expect(view.queryByText('First Choice')).toBeNull();
  expect(view.getByLabelText('Second Choice')).toBeTruthy();
});
