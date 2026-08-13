import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockSearch = jest.fn();
const mockAddItemAndMarkWatched = jest.fn();
const mockTouchTitle = jest.fn().mockResolvedValue(undefined);
const mockAddItem = jest.fn();
let mockResolvedTitle: Record<string, unknown> | undefined;
jest.mock('convex/react', () => ({
  useAction: (ref: string) =>
    ref === 'addItemAndMarkWatched' ? mockAddItemAndMarkWatched : mockSearch,
  useMutation: (ref: string) => (ref === 'touchTitle' ? mockTouchTitle : mockAddItem),
  useQuery: (ref: string) => (ref === 'getTitle' ? mockResolvedTitle : []),
}));
jest.mock('../../convex/_generated/api', () => ({
  api: {
    tmdb: { searchMulti: 'search' },
    resolvedMetadata: { getTitle: 'getTitle', touchTitle: 'touchTitle' },
    library: {
      addItem: 'add',
      addItemAndMarkWatched: 'addItemAndMarkWatched',
      listItems: 'list',
    },
  },
}));
jest.mock('expo-router', () => ({
  router: { back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({}),
}));
jest.mock('expo-image', () => ({ Image: require('react-native').Image }));

import Add from '../../src/app/add';
import { ToastProvider } from '../../src/components/ui/Toast';

describe('add flow', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockSearch.mockReset();
    mockResolvedTitle = undefined;
    mockTouchTitle.mockClear();
    mockAddItem.mockReset();
    mockAddItemAndMarkWatched.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it('debounces search and renders selectable results', async () => {
    mockSearch.mockResolvedValue([
      {
        id: 299534,
        mediaType: 'movie',
        title: 'Avengers: Endgame',
        posterPath: '/poster.jpg',
        overview: 'After the Snap',
        releaseDate: '2019-04-24',
      },
    ]);
    mockAddItem.mockResolvedValue('item-id');
    const view = await render(
      <ToastProvider>
        <Add />
      </ToastProvider>,
    );
    expect(view.getByLabelText('Back to library')).toBeTruthy();
    expect(view.getByText('Add Title')).toBeTruthy();
    expect(view.getByText('Search all of Marker')).toBeTruthy();
    expect(view.getByText('Find movies, TV shows, or people.')).toBeTruthy();
    await fireEvent.changeText(view.getByTestId('tmdb-search'), 'Avengers');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(350);
    });
    await waitFor(() => expect(view.getByText('Avengers: Endgame')).toBeTruthy());
    expect(mockSearch).toHaveBeenCalledWith({ query: 'Avengers' });
    expect(view.getByLabelText('Select Avengers: Endgame')).toBeTruthy();
  });

  it('filters search results by movies and TV shows', async () => {
    mockSearch.mockResolvedValue([
      { id: 1, mediaType: 'movie', title: 'Rambo' },
      { id: 2, mediaType: 'tv', title: 'Rambo: The Series' },
    ]);
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
    expect(view.getByText('Rambo')).toBeTruthy();
    expect(view.queryByText('Rambo: The Series')).toBeNull();

    await fireEvent.press(view.getByText('TV Shows'));
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
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({ runtime: 181, genres: ['Action'] }),
    );
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
