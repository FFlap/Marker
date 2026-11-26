import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { localDateKey } from '../../src/hooks/use-local-today';

const mockRespond = jest.fn();
let mockFavoriteDragEnd:
  ((event: { data: typeof mockFavorites; from: number; to: number }) => void) | undefined;
const mockToday = new Date();
const mockWatchActivity = [
  {
    date: localDateKey(
      new Date(mockToday.getFullYear(), mockToday.getMonth(), mockToday.getDate() - 1),
    ),
    episodes: 2,
  },
  { date: localDateKey(mockToday), episodes: 5 },
];
const mockFavorites = [
  { _id: 'favorite-1', title: 'Spirited Away', mediaType: 'movie', isAnime: true, rank: 1 },
  { _id: 'favorite-2', title: 'One Piece', mediaType: 'tv', isAnime: true, rank: 2 },
  { _id: 'favorite-3', title: 'Severance', mediaType: 'tv', isAnime: false, rank: 3 },
];
jest.mock('convex/react', () => ({
  useMutation: () => mockRespond,
  useQuery: (ref: string) => {
    if (ref === 'profiles.me') {
      return {
        username: 'flappy',
        isPublic: false,
        followerCount: 2,
        followingCount: 5,
      };
    }
    if (ref === 'profiles.followRequests') return [];
    if (ref === 'tags.myPublic') return [{ tag: 'wholesome', count: 3, posters: [] }];
    if (ref === 'profileFavorites.eligible') return [];
    if (ref === 'library.items.listItems')
      return [
        {
          status: 'watched',
          mediaType: 'tv',
          isAnime: true,
          rating: 4.5,
          genres: ['Animation', 'Fantasy'],
          timesWatched: 2,
        },
        { status: 'watchlist', mediaType: 'movie', isAnime: false, genres: [], timesWatched: 0 },
      ];
    return {
      totalWatchMinutes: 1560,
      episodesWatched: 12,
      moviesWatched: 3,
      showsWatched: 4,
      totalItems: 19,
      avgRating: 8.25,
      favorites: mockFavorites,
      topTags: [{ tag: 'hero', count: 5 }],
      watchActivity: mockWatchActivity,
    };
  },
}));
jest.mock('@marker/shared/api', () => ({
  api: {
    stats: { profile: 'stats.profile' },
    settings: { getSettings: 'settings.getSettings' },
    profiles: {
      me: 'profiles.me',
      followRequests: 'profiles.followRequests',
      respondToFollow: 'profiles.respondToFollow',
    },
    tags: { myPublic: 'tags.myPublic' },
    library: { items: { listItems: 'library.items.listItems' } },
    profileFavorites: {
      eligible: 'profileFavorites.eligible',
      add: 'profileFavorites.add',
      remove: 'profileFavorites.remove',
      reorder: 'profileFavorites.reorder',
    },
  },
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));
jest.mock('expo-image', () => ({ Image: require('react-native').Image }));
jest.mock('react-native-draggable-flatlist', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ data, renderItem, onDragEnd }: any) => {
      if (data.length === 2) mockFavoriteDragEnd = onDragEnd;
      return (
        <View>
          {data.map((item: any, index: number) => (
            <View key={item._id}>
              {renderItem({ item, getIndex: () => index, drag: jest.fn(), isActive: false })}
            </View>
          ))}
        </View>
      );
    },
  };
});
jest.mock('../../src/components/SkeletonShimmer', () => ({
  SkeletonShimmer: () => null,
}));

import Profile from '../../src/app/(tabs)/profile';

beforeEach(() => {
  mockFavoriteDragEnd = undefined;
  mockRespond.mockReset().mockResolvedValue(undefined);
});

it('keeps an optimistic favorite order while a save is pending', async () => {
  let finishSave!: () => void;
  mockRespond.mockImplementationOnce(() => new Promise<void>((resolve) => (finishSave = resolve)));
  const view = await render(<Profile />);
  const favoriteOrder = () =>
    view
      .getAllByRole('button')
      .map((node) => node.props.accessibilityLabel)
      .filter((label) => label === 'Spirited Away' || label === 'One Piece');

  await act(async () => {
    mockFavoriteDragEnd?.({ data: mockFavorites, from: 0, to: 1 });
    await Promise.resolve();
  });
  expect(favoriteOrder()).toEqual(['One Piece', 'Spirited Away']);

  await act(async () => {
    mockFavoriteDragEnd?.({ data: mockFavorites, from: 1, to: 0 });
    await Promise.resolve();
  });
  expect(favoriteOrder()).toEqual(['One Piece', 'Spirited Away']);

  await act(async () => finishSave());
});

it('lets screen readers move a favorite without dragging', async () => {
  const view = await render(<Profile />);
  const spirited = view.getByLabelText('Spirited Away');
  expect(spirited.props.accessibilityActions).toEqual([{ name: 'moveLater', label: 'Move later' }]);
  await act(async () => {
    fireEvent(spirited, 'accessibilityAction', { nativeEvent: { actionName: 'moveLater' } });
    await Promise.resolve();
  });
  expect(mockRespond).toHaveBeenCalledWith(
    expect.objectContaining({ itemId: 'favorite-1', beforeId: 'favorite-2' }),
  );
});

it('shows period activity, streaks, the heatmap and library breakdowns on the stats tab', async () => {
  const view = await render(<Profile />);
  await act(async () => fireEvent.press(view.getByText('Stats')));

  expect(view.getByText('Episodes watched · last 30 days')).toBeTruthy();
  expect(view.getByText('7')).toBeTruthy();
  expect(view.getByText('Current streak')).toBeTruthy();
  expect(view.getByText('Watched today')).toBeTruthy();
  expect(view.getByText('Longest streak')).toBeTruthy();
  expect(view.getByText(/^episodes · /)).toBeTruthy();
  expect(view.getByText(/^Last \d+ weeks$/)).toBeTruthy();
  expect(view.getByRole('header', { name: 'All time' })).toBeTruthy();
  expect(view.getByText('Busiest days')).toBeTruthy();
  expect(view.getByLabelText('Watched, 1')).toBeTruthy();
  expect(view.getByText('Average ★ 8.3')).toBeTruthy();

  await act(async () => fireEvent.press(view.getByLabelText('Week')));
  expect(view.getByText('Episodes watched · last 7 days')).toBeTruthy();
});
