import React from 'react';
import { act, render } from '@testing-library/react-native';

const mockRespond = jest.fn();
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
