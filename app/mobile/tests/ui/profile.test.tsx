import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

const mockRespond = jest.fn();
let mockProfileLoading = false;
let mockFavoriteDragEnd:
  ((event: { data: typeof mockFavorites; from: number; to: number }) => void) | undefined;
const mockFavorites = [
  { _id: 'favorite-1', title: 'Spirited Away', mediaType: 'movie', isAnime: true, rank: 1 },
  { _id: 'favorite-2', title: 'One Piece', mediaType: 'tv', isAnime: true, rank: 2 },
  { _id: 'favorite-3', title: 'Severance', mediaType: 'tv', isAnime: false, rank: 3 },
];
jest.mock('convex/react', () => ({
  useMutation: () => mockRespond,
  useQuery: (ref: string) => {
    if (mockProfileLoading && (ref === 'profiles.me' || ref === 'stats.profile')) return undefined;
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
    return {
      totalWatchMinutes: 1560,
      episodesWatched: 12,
      moviesWatched: 3,
      showsWatched: 4,
      totalItems: 19,
      avgRating: 8.25,
      favorites: mockFavorites,
      topTags: [{ tag: 'hero', count: 5 }],
    };
  },
}));
jest.mock('../../convex/_generated/api', () => ({
  api: {
    stats: { profile: 'stats.profile' },
    profiles: {
      me: 'profiles.me',
      followRequests: 'profiles.followRequests',
      respondToFollow: 'profiles.respondToFollow',
    },
    tags: { myPublic: 'tags.myPublic' },
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
  mockProfileLoading = false;
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

it('uses a profile-shaped skeleton while profile data loads', async () => {
  mockProfileLoading = true;
  const view = await render(<Profile />);

  expect(view.getByLabelText('Loading profile')).toBeTruthy();
  expect(view.queryByText('Calculating your profile…')).toBeNull();
});

it('separates collection content from profile stats', async () => {
  const view = await render(<Profile />);
  expect(view.getByText('@flappy')).toBeTruthy();
  expect(view.getByText('Private profile')).toBeTruthy();
  expect(view.getByText('2 followers · 5 following')).toBeTruthy();
  expect(view.getByLabelText('Back to library')).toBeTruthy();
  expect(view.getByRole('tab', { name: 'Collection' }).props.accessibilityState).toEqual({
    selected: true,
  });
  expect(view.queryByText('1d 2h')).toBeNull();
  expect(view.getByText('Spirited Away')).toBeTruthy();
  expect(view.getByText('One Piece')).toBeTruthy();
  expect(view.getByText('TV Shows')).toBeTruthy();
  expect(view.getByText('Anime')).toBeTruthy();
  expect(view.getByText('Movies')).toBeTruthy();
  expect(view.getByLabelText('One Piece').props.accessibilityHint).toBe(
    'Long press and drag to reorder this favorite',
  );
  expect(view.queryByLabelText('Drag One Piece')).toBeNull();
  expect(view.queryByText('Your all-time shelf')).toBeNull();
  expect(view.queryByText('PROFILE FAVORITES')).toBeNull();
  expect(view.getByText('Public Tags')).toBeTruthy();
  expect(view.getByLabelText('Open wholesome tag')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('Open wholesome tag'));
  expect(jest.requireMock('expo-router').router.push).toHaveBeenCalledWith({
    pathname: '/u/[username]/tags/[tag]',
    params: { username: 'flappy', tag: 'wholesome' },
  });
  await fireEvent.press(view.getByRole('tab', { name: 'Stats' }));
  expect(view.getByText('1d 2h')).toBeTruthy();
  expect(view.getByText('12')).toBeTruthy();
  expect(view.getByText('19')).toBeTruthy();
  expect(view.queryByText('Spirited Away')).toBeNull();
});
