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

let mockParams = { username: 'curator', tag: 'Favorites' };
let mockPage: (typeof mockCollection & { nextCursor?: string }) | null | undefined = mockCollection;
const mockPageQuery = jest.fn();

beforeEach(() => {
  mockParams = { username: 'curator', tag: 'Favorites' };
  mockPage = mockCollection;
  mockPageQuery.mockClear();
});

jest.mock('convex/react', () => ({
  useQuery: (ref: string, args: unknown) =>
    ref === 'tags.publicByUser' || ref === 'tags.publicDetails'
      ? (mockPageQuery(args), mockPage)
      : ref === 'settings.getSettings'
        ? { gridColumns: 3 }
        : [],
  useMutation: () => jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../convex/_generated/api', () => ({
  api: {
    tags: { publicByUser: 'tags.publicByUser', publicDetails: 'tags.publicDetails' },
    library: { items: { listItems: 'library/items:listItems' } },
    settings: { getSettings: 'settings.getSettings', setSettings: 'settings.setSettings' },
  },
}));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  router: {
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  },
}));
jest.mock('expo-image', () => ({ Image: require('react-native').Image }));

import UserTagScreen from '@/app/u/[username]/tags/[tag]';
import GlobalTagScreen from '@/app/tag/[tag]';

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

it('keeps previous pages while loading and resets cursor and filters when the route changes', async () => {
  mockPage = { ...mockCollection, nextCursor: 'page-two' };
  const view = await render(<UserTagScreen />);
  await fireEvent.press(view.getByText('Load more titles'));
  expect(mockPageQuery).toHaveBeenLastCalledWith({
    username: 'curator',
    tag: 'Favorites',
    cursor: 'page-two',
  });
  mockPage = undefined;
  await view.rerender(<UserTagScreen />);
  expect(view.getByLabelText('Second Choice')).toBeTruthy();
  await fireEvent.changeText(view.getByLabelText("Search curator's Favorites tag"), 'second');
  mockParams = { username: 'another', tag: 'New' };
  mockPageQuery.mockClear();
  await view.rerender(<UserTagScreen />);
  expect(mockPageQuery.mock.calls.every(([args]) => args.cursor === undefined)).toBe(true);
  expect(view.getByLabelText("Search another's New tag").props.value).toBe('');
  expect(view.queryByLabelText('Second Choice')).toBeNull();
});

it('hides cached pages when the collection is no longer public', async () => {
  mockPage = { ...mockCollection, nextCursor: 'page-two' };
  const view = await render(<UserTagScreen />);
  await fireEvent.press(view.getByText('Load more titles'));
  mockPage = null;
  await view.rerender(<UserTagScreen />);
  expect(view.queryByLabelText('Second Choice')).toBeNull();
});

it('resets global tag pagination before subscribing to a different tag', async () => {
  mockPage = { ...mockCollection, nextCursor: 'page-two' };
  const view = await render(<GlobalTagScreen />);
  await fireEvent.press(view.getByText('Load more titles'));
  expect(mockPageQuery).toHaveBeenLastCalledWith({ tag: 'Favorites', cursor: 'page-two' });
  mockParams = { username: 'curator', tag: 'New' };
  mockPage = undefined;
  mockPageQuery.mockClear();
  await view.rerender(<GlobalTagScreen />);
  expect(mockPageQuery.mock.calls.every(([args]) => args.cursor === undefined)).toBe(true);
  expect(view.queryByLabelText('Second Choice')).toBeNull();
});
