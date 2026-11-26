import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockSearch = jest.fn();
const mockSearchCategory = jest.fn();
const mockAddItemAndMarkWatched = jest.fn();
const mockTouchTitle = jest.fn().mockResolvedValue(undefined);
const mockAddItem = jest.fn();
let mockResolvedTitle: Record<string, unknown> | undefined;
let mockParams: { prefill?: string } = {};
jest.mock('convex/react', () => ({
  useAction: (ref: string) =>
    ref === 'addItemAndMarkWatched'
      ? mockAddItemAndMarkWatched
      : ref === 'searchCategory'
        ? mockSearchCategory
        : mockSearch,
  useMutation: (ref: string) => (ref === 'touchTitle' ? mockTouchTitle : mockAddItem),
  useQuery: (ref: string) => (ref === 'getTitle' ? mockResolvedTitle : []),
}));
jest.mock('@marker/shared/api', () => ({
  api: {
    tmdb: { searchMulti: 'search', searchCategory: 'searchCategory' },
    resolvedMetadata: {
      reads: { getTitle: 'getTitle' },
      touch: { touchTitle: 'touchTitle' },
    },
    library: {
      items: { addItem: 'add', listTagSuggestions: 'listTagSuggestions' },
      seasonWatched: { addItemAndMarkWatched: 'addItemAndMarkWatched' },
    },
  },
}));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-image', () => ({ Image: require('react-native').Image }));

import Add from '../../src/app/add';
import { ToastProvider } from '../../src/components/ui/Toast';

describe('add flow', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockSearch.mockReset();
    mockSearchCategory.mockReset();
    mockParams = {};
    mockResolvedTitle = undefined;
    mockTouchTitle.mockClear();
    mockAddItem.mockReset();
    mockAddItemAndMarkWatched.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it('rejects malformed route prefills before requesting metadata', async () => {
    mockParams = { prefill: JSON.stringify({ id: -1, title: 'Invalid', mediaType: 'movie' }) };
    const view = await render(
      <ToastProvider>
        <Add />
      </ToastProvider>,
    );
    expect(view.getByTestId('tmdb-search').props.value).toBe('');
    expect(mockTouchTitle).not.toHaveBeenCalled();
  });

  it('resets the form and prewarms the new title when the route prefill changes', async () => {
    mockParams = { prefill: JSON.stringify({ id: 1, title: 'First', mediaType: 'movie' }) };
    const view = await render(
      <ToastProvider>
        <Add />
      </ToastProvider>,
    );
    await fireEvent.press(view.getByText('Watched'));
    mockParams = { prefill: JSON.stringify({ id: 2, title: 'Second', mediaType: 'tv' }) };
    await view.rerender(
      <ToastProvider>
        <Add />
      </ToastProvider>,
    );
    expect(view.getByTestId('tmdb-search').props.value).toBe('Second');
    expect(mockTouchTitle).toHaveBeenLastCalledWith({
      mediaType: 'tv',
      tmdbId: 2,
      title: 'Second',
    });
    mockResolvedTitle = { runtime: 45, genres: [] };
    mockAddItem.mockResolvedValue('new-item');
    await view.rerender(
      <ToastProvider>
        <Add />
      </ToastProvider>,
    );
    await fireEvent.press(view.getByTestId('add-submit'));
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        tmdbId: 2,
        status: 'watchlist',
        timesWatched: 0,
      }),
    );
  });

  it('searches movies and TV shows as their own categories, a page at a time', async () => {
    const movie = { id: 1, mediaType: 'movie', title: 'Rambo' };
    const show = { id: 2, mediaType: 'tv', title: 'Rambo: The Series' };
    mockSearch.mockResolvedValue([movie, show]);
    mockSearchCategory.mockImplementation(async ({ type, page }) =>
      type === 'movie'
        ? page === 1
          ? { results: [movie], hasMore: true }
          : { results: [{ id: 3, mediaType: 'movie', title: 'Rambo III' }], hasMore: false }
        : { results: [show], hasMore: false },
    );
    const view = await render(
      <ToastProvider>
        <Add />
      </ToastProvider>,
    );
    await fireEvent.changeText(view.getByTestId('tmdb-search'), 'Rambo');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(350);
    });
    await waitFor(() => expect(view.getByText('Rambo')).toBeTruthy());
    expect(view.getByText('Rambo: The Series')).toBeTruthy();

    await fireEvent.press(view.getByText('Movies'));
    await act(async () => jest.advanceTimersByTimeAsync(0));
    expect(view.getByText('Rambo')).toBeTruthy();
    expect(view.queryByText('Rambo: The Series')).toBeNull();
    await fireEvent.press(view.getByText('Load more'));
    await act(async () => jest.advanceTimersByTimeAsync(0));
    expect(view.getByText('Rambo III')).toBeTruthy();
    expect(view.queryByText('Load more')).toBeNull();
    expect(mockSearchCategory).toHaveBeenCalledWith({ query: 'Rambo', type: 'movie', page: 2 });

    await fireEvent.press(view.getByText('TV shows'));
    await act(async () => jest.advanceTimersByTimeAsync(0));
    expect(view.queryByText('Rambo')).toBeNull();
    expect(view.getByText('Rambo: The Series')).toBeTruthy();
  });

  it('prewarms on selection and uses canonical metadata when it is available', async () => {
    mockSearch.mockResolvedValue([
      { id: 299534, mediaType: 'movie', title: 'Avengers: Endgame', posterPath: '/poster.jpg' },
    ]);
    mockResolvedTitle = { runtime: 181, episodeRunTime: [], genres: ['Action'] };
    mockAddItem.mockResolvedValue('item-id');
    const view = await render(
      <ToastProvider>
        <Add />
      </ToastProvider>,
    );
    await fireEvent.changeText(view.getByTestId('tmdb-search'), 'Avengers');
    await act(async () => jest.advanceTimersByTimeAsync(350));
    await fireEvent.press(view.getByLabelText('Select Avengers: Endgame'));
    expect(mockTouchTitle).toHaveBeenCalledWith({
      mediaType: 'movie',
      tmdbId: 299534,
      title: 'Avengers: Endgame',
    });
    await fireEvent.press(view.getByTestId('add-submit'));
    expect(mockAddItem).toHaveBeenCalledWith(expect.objectContaining({ genres: ['Action'] }));
  });

  it('marks every episode watched when a TV show is added as Watched', async () => {
    mockSearch.mockResolvedValue([{ id: 1396, mediaType: 'tv', title: 'Breaking Bad' }]);
    mockResolvedTitle = { runtime: 47, episodeRunTime: [47], genres: ['Drama'] };
    mockAddItemAndMarkWatched.mockResolvedValue('item-id');
    const view = await render(
      <ToastProvider>
        <Add />
      </ToastProvider>,
    );
    await fireEvent.changeText(view.getByTestId('tmdb-search'), 'Breaking Bad');
    await act(async () => jest.advanceTimersByTimeAsync(350));
    await fireEvent.press(view.getByLabelText('Select Breaking Bad'));
    await fireEvent.press(view.getByText('Watched'));
    await fireEvent.press(view.getByTestId('add-submit'));

    await waitFor(() =>
      expect(mockAddItemAndMarkWatched).toHaveBeenCalledWith(
        expect.objectContaining({ mediaType: 'tv', status: 'watched', timesWatched: 1 }),
      ),
    );
    expect(mockAddItem).not.toHaveBeenCalled();
  });
});
