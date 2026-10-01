import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockSearchMedia = jest.fn();
const mockFollow = jest.fn();
const mockUnfollow = jest.fn();
let mockPeople: unknown[] = [];
let mockLibrary: unknown[] = [];

jest.mock('convex/react', () => ({
  useAction: () => mockSearchMedia,
  useMutation: (ref: string) => (ref === 'profiles.follow' ? mockFollow : mockUnfollow),
  useQuery: (ref: string) => {
    if (ref === 'library/items:listItems') return mockLibrary;
    if (ref === 'tags.searchPublic') return [];
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

  it('reuses one media search across local filters and returning from people', async () => {
    mockSearchMedia.mockResolvedValue([
      { id: 1, mediaType: 'movie', title: 'Shared movie' },
      { id: 2, mediaType: 'tv', title: 'Shared show' },
    ]);
    const q = await view();
    await fireEvent.changeText(
      q.getByLabelText('Search movies, TV shows, people, and tags'),
      'Shared',
    );
    await act(async () => jest.advanceTimersByTimeAsync(350));
    await fireEvent.press(q.getByRole('tab', { name: 'Movies' }));
    expect(q.getByText('Shared movie')).toBeTruthy();
    expect(q.queryByText('Shared show')).toBeNull();
    await fireEvent.press(q.getByRole('tab', { name: 'TV Shows' }));
    expect(q.getByText('Shared show')).toBeTruthy();
    expect(q.queryByText('Shared movie')).toBeNull();
    await fireEvent.press(q.getByRole('tab', { name: 'People' }));
    await fireEvent.press(q.getByRole('tab', { name: 'All' }));
    expect(q.getByText('Shared movie')).toBeTruthy();
    expect(mockSearchMedia).toHaveBeenCalledTimes(1);
  });

  it('hides old results immediately and ignores their late failures during the next debounce', async () => {
    let rejectSearch!: (error: Error) => void;
    mockSearchMedia.mockResolvedValueOnce([{ id: 1, mediaType: 'movie', title: 'First title' }]);
    mockSearchMedia.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectSearch = reject;
        }),
    );
    const q = await view();
    const input = q.getByLabelText('Search movies, TV shows, people, and tags');
    await fireEvent.changeText(input, 'First');
    await act(async () => jest.advanceTimersByTimeAsync(350));
    expect(q.getByText('First title')).toBeTruthy();
    await fireEvent.changeText(input, 'Second');
    expect(q.queryByText('First title')).toBeNull();
    await act(async () => jest.advanceTimersByTimeAsync(350));
    await fireEvent.changeText(input, 'Third');
    await act(async () => rejectSearch(new Error('offline')));
    expect(q.queryByText('Search is unavailable right now')).toBeNull();
    expect(mockSearchMedia).toHaveBeenCalledTimes(2);
  });

  it('reloads a previous query after a different query fails', async () => {
    const result = { id: 1, mediaType: 'movie', title: 'First title' };
    mockSearchMedia
      .mockResolvedValueOnce([result])
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([result]);
    const q = await view();
    const input = q.getByLabelText('Search movies, TV shows, people, and tags');
    await fireEvent.changeText(input, 'First');
    await act(async () => jest.advanceTimersByTimeAsync(350));
    expect(q.getByText('First title')).toBeTruthy();
    await fireEvent.changeText(input, 'Second');
    await act(async () => jest.advanceTimersByTimeAsync(350));
    expect(q.getByText('Search is unavailable right now')).toBeTruthy();
    await fireEvent.changeText(input, 'First');
    await act(async () => jest.advanceTimersByTimeAsync(350));
    expect(q.getByText('First title')).toBeTruthy();
    expect(mockSearchMedia).toHaveBeenCalledTimes(3);
  });

  it.each([0, 350])('retries a failed query after clearing it for %i ms', async (clearDelay) => {
    mockSearchMedia
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([{ id: 1, mediaType: 'movie', title: 'Recovered title' }]);
    const q = await view();
    const input = q.getByLabelText('Search movies, TV shows, people, and tags');
    await fireEvent.changeText(input, 'First');
    await act(async () => jest.advanceTimersByTimeAsync(350));
    expect(q.getByText('Search is unavailable right now')).toBeTruthy();
    await act(async () => jest.advanceTimersByTimeAsync(1_000));
    expect(mockSearchMedia).toHaveBeenCalledTimes(1);
    await fireEvent.changeText(input, '');
    await act(async () => jest.advanceTimersByTimeAsync(clearDelay));
    await fireEvent.changeText(input, 'First');
    await act(async () => jest.advanceTimersByTimeAsync(350));
    expect(mockSearchMedia).toHaveBeenCalledTimes(2);
    expect(q.getByText('Recovered title')).toBeTruthy();
  });

  it('ignores an in-flight search failure after leaving Explore', async () => {
    let rejectSearch!: (error: Error) => void;
    mockSearchMedia.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectSearch = reject;
        }),
    );
    const q = await view();
    await fireEvent.changeText(
      q.getByLabelText('Search movies, TV shows, people, and tags'),
      'Avengers',
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(350);
    });
    expect(mockSearchMedia).toHaveBeenCalledTimes(1);
    await q.rerender(<ToastProvider>{null}</ToastProvider>);
    await act(async () => {
      rejectSearch(new Error('offline'));
    });
    expect(q.queryByText('Search is unavailable right now')).toBeNull();
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
});
