import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockSearchMedia = jest.fn();
const mockFollow = jest.fn();
const mockUnfollow = jest.fn();
let mockPeople: unknown[] = [];
let mockLibrary: unknown[] = [];
let mockPublicTags: unknown[] = [];

jest.mock('convex/react', () => ({
  useAction: () => mockSearchMedia,
  useMutation: (ref: string) => (ref === 'profiles.follow' ? mockFollow : mockUnfollow),
  useQuery: (ref: string) => {
    if (ref === 'library/items:listItems') return mockLibrary;
    if (ref === 'tags.searchPublic') return mockPublicTags;
    return mockPeople;
  },
}));
jest.mock('../../convex/_generated/api', () => ({
  api: {
    tmdb: { searchMulti: 'tmdb.searchMulti' },
    library: { items: { listItems: 'library/items:listItems' } },
    tags: { searchPublic: 'tags.searchPublic' },
    profiles: {
      me: 'profiles.me',
      search: 'profiles.search',
      follow: 'profiles.follow',
      unfollow: 'profiles.unfollow',
    },
  },
}));
jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: () => true,
  },
}));
jest.mock('expo-image', () => ({ Image: require('react-native').Image }));

import Explore from '../../src/app/explore';
import { ToastProvider } from '../../src/components/ui/Toast';

describe('Explore', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockPeople = [];
    mockLibrary = [];
    mockPublicTags = [];
    mockSearchMedia.mockReset();
    mockSearchMedia.mockResolvedValue([]);
    mockFollow.mockReset();
    mockUnfollow.mockReset();
    (jest.requireMock('expo-router').router.push as jest.Mock).mockReset();
    (jest.requireMock('expo-router').router.back as jest.Mock).mockReset();
  });

  afterEach(() => jest.useRealTimers());

  const view = () =>
    render(
      <ToastProvider>
        <Explore />
      </ToastProvider>,
    );

  it('filters movie search and sends a selected title to the add flow', async () => {
    const result = {
      id: 299534,
      mediaType: 'movie',
      title: 'Avengers: Endgame',
      posterPath: '/poster.jpg',
      overview: 'After the Snap',
      releaseDate: '2019-04-24',
      voteAverage: 8.3,
    };
    mockPeople = [
      {
        username: 'avengersfan',
        isPublic: true,
        followerCount: 3,
        followingCount: 8,
        relationship: 'none',
      },
    ];
    mockSearchMedia.mockResolvedValue([
      result,
      {
        id: 100088,
        mediaType: 'tv',
        title: 'Avengers Assemble',
        releaseDate: '2013-05-26',
      },
    ]);
    const q = await view();
    expect(q.getByLabelText('Back to library')).toBeTruthy();
    expect(q.queryByText('DISCOVER')).toBeNull();
    await fireEvent.changeText(
      q.getByLabelText('Search movies, TV shows, people, and tags'),
      'Avengers',
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(350);
    });
    await waitFor(() => expect(q.getByText('Avengers: Endgame')).toBeTruthy());
    expect(q.getByText('Avengers Assemble')).toBeTruthy();
    expect(q.getByText('@avengersfan')).toBeTruthy();
    expect(mockSearchMedia).toHaveBeenCalledWith({ query: 'Avengers' });

    await fireEvent.press(q.getByLabelText('View Avengers: Endgame'));
    expect(jest.requireMock('expo-router').router.push).toHaveBeenCalledWith({
      pathname: '/title/[mediaType]/[tmdbId]',
      params: {
        mediaType: 'movie',
        tmdbId: '299534',
        preview: JSON.stringify(result),
      },
    });
  });

  it('shows private people as follow requests', async () => {
    mockPeople = [
      {
        username: 'privatefan',
        isPublic: false,
        followerCount: 12,
        followingCount: 3,
        relationship: 'none',
      },
    ];
    mockFollow.mockResolvedValue('pending');
    const q = await view();
    await fireEvent.press(q.getByText('People'));
    await fireEvent.changeText(
      q.getByLabelText('Search movies, TV shows, people, and tags'),
      'private',
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(350);
    });
    await waitFor(() => expect(q.getByText('@privatefan')).toBeTruthy());
    await act(async () => fireEvent.press(q.getByLabelText('Request @privatefan')));
    expect(mockFollow).toHaveBeenCalledWith({ username: 'privatefan' });
  });

  it('opens the exact library detail screen for an already tracked title', async () => {
    mockLibrary = [{ _id: 'existing-item', tmdbId: 299534, mediaType: 'movie' }];
    mockSearchMedia.mockResolvedValue([
      { id: 299534, mediaType: 'movie', title: 'Avengers: Endgame' },
    ]);
    const q = await view();
    await fireEvent.changeText(
      q.getByLabelText('Search movies, TV shows, people, and tags'),
      'Avengers',
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(350);
    });
    await waitFor(() => expect(q.getByText('Avengers: Endgame')).toBeTruthy());
    await fireEvent.press(q.getByLabelText('View Avengers: Endgame'));
    expect(jest.requireMock('expo-router').router.push).toHaveBeenCalledWith('/item/existing-item');
  });

  it('discovers public tags and opens their aggregated collection', async () => {
    mockPublicTags = [
      {
        tag: 'wholesome',
        entryCount: 7,
        contributorCount: 3,
        posters: [],
      },
    ];
    const q = await view();
    await fireEvent.press(q.getByText('Tags'));
    await fireEvent.changeText(
      q.getByLabelText('Search movies, TV shows, people, and tags'),
      'whole',
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(350);
    });
    expect(q.getByText('7 saved titles · 3 people')).toBeTruthy();
    fireEvent.press(q.getByLabelText('Explore wholesome tag'));
    expect(jest.requireMock('expo-router').router.push).toHaveBeenCalledWith({
      pathname: '/tag/[tag]',
      params: { tag: 'wholesome' },
    });
  });
});
