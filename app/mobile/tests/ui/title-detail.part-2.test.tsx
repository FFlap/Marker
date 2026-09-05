import React from 'react';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import {
  mockState,
  mockTouchTitle,
  mockLoadMore,
  episodeData,
  screen,
  TitleDetail,
  ToastProvider,
} from './title-detail-fixture';

describe('Explore title metadata subscriptions', () => {
  it('shows the invalid-route state when route parameters are missing', async () => {
    mockState.mockParams = {};
    const view = await screen();
    expect(view.getByText('Title not found')).toBeTruthy();
    expect(view.getByText('This title link is invalid.')).toBeTruthy();
  });

  it('resets the selected season before touching a cold title on route reuse', async () => {
    mockState.titleView.title.seasons.push({ season: 5, name: 'Season 5', episodeCount: 1 });
    mockState.mockSeasonView[5] = {
      season: {
        season: 5,
        metadataProvider: 'tvdb',
        orderEpoch: 4,
        episodes: [{ season: 5, episode: 1, name: 'Far Future' }],
      },
      requestState: { state: 'succeeded' },
    };
    const view = await screen();
    await fireEvent.press(view.getByLabelText('Choose season, current Season 1'));
    await fireEvent.press(view.getByLabelText('Select Season 5'));
    await waitFor(() => expect(view.getByText('Far Future')).toBeTruthy());

    mockTouchTitle.mockClear();
    mockState.mockParams = { mediaType: 'tv', tmdbId: '300000' };
    mockState.titleView = { title: null, requestState: { state: 'inFlight' } };
    mockState.mockSeasonView = {};
    await act(async () =>
      view.rerender(
        <ToastProvider>
          <TitleDetail />
        </ToastProvider>,
      ),
    );
    expect(mockTouchTitle).toHaveBeenCalledWith({ mediaType: 'tv', tmdbId: 300000, season: 1 });
    expect(mockTouchTitle).not.toHaveBeenCalledWith(
      expect.objectContaining({ tmdbId: 300000, season: 5 }),
    );
  });

  it('touches the valid fallback when the selected season is no longer available', async () => {
    const view = await screen();
    await fireEvent.press(view.getByLabelText('Choose season, current Season 1'));
    await fireEvent.press(view.getByLabelText('Select Season 2'));
    await waitFor(() => expect(view.getByText('A New Journey')).toBeTruthy());

    mockTouchTitle.mockClear();
    mockState.titleView = {
      ...mockState.titleView,
      title: {
        ...mockState.titleView.title,
        seasons: [{ season: 1, name: 'Season 1', episodeCount: 1 }],
      },
    };
    await act(async () =>
      view.rerender(
        <ToastProvider>
          <TitleDetail />
        </ToastProvider>,
      ),
    );

    await waitFor(() =>
      expect(mockTouchTitle).toHaveBeenCalledWith({
        mediaType: 'tv',
        tmdbId: 209867,
        title: 'Frieren',
        season: 1,
      }),
    );
    expect(mockTouchTitle).not.toHaveBeenCalledWith(expect.objectContaining({ season: 2 }));
  });

  it('loads season zero when only specials are available', async () => {
    mockState.titleView.title.seasons = [{ season: 0, name: 'Specials', episodeCount: 1 }];
    mockState.mockSeasonView = {
      0: {
        season: {
          season: 0,
          metadataProvider: 'tmdb',
          orderEpoch: 1,
          episodes: [{ season: 0, episode: 1, name: 'Special episode' }],
        },
        requestState: { state: 'succeeded' },
      },
    };
    const view = await screen();
    expect(view.getByText('Special episode')).toBeTruthy();
    expect(mockTouchTitle).toHaveBeenCalledWith(expect.objectContaining({ season: 0 }));
  });

  it('renders one season page and loads another bounded page', async () => {
    mockState.mockSeasonView[1].season.episodes = Array.from({ length: 121 }, (_, index) => ({
      season: 1,
      episode: index + 1,
      name: `Episode ${index + 1}`,
    }));
    const view = await screen();
    expect(view.getByText('Episode 1')).toBeTruthy();
    expect(episodeData(view)).toHaveLength(120);
    await act(async () => fireEvent.press(view.getByText('Load more episodes')));
    expect(mockLoadMore).toHaveBeenCalledWith(1);
    await act(async () =>
      view.rerender(
        <ToastProvider>
          <TitleDetail />
        </ToastProvider>,
      ),
    );
    await waitFor(() => expect(episodeData(view)).toHaveLength(121));
  });

  it('discards an old season row returned during a season argument transition', async () => {
    mockState.mockSeasonView[1] = {
      season: {
        season: 2,
        metadataProvider: 'tvdb',
        orderEpoch: 4,
        episodes: [{ season: 2, episode: 1, name: 'Wrongly labelled episode' }],
      },
      requestState: { state: 'succeeded' },
    };
    const view = await screen();
    expect(view.queryByText('Wrongly labelled episode')).toBeNull();
    expect(view.getByLabelText('Loading')).toBeTruthy();
  });

  it('keeps pull-to-refresh active until the metadata request finishes', async () => {
    const view = await screen();
    let finishRefresh!: () => void;
    mockTouchTitle.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishRefresh = resolve)),
    );
    let refreshPromise!: Promise<void>;

    await act(async () => {
      refreshPromise = view.getByTestId('episode-list').props.refreshControl.props.onRefresh();
      await Promise.resolve();
    });
    expect(view.getByTestId('episode-list').props.refreshControl.props.refreshing).toBe(true);

    await act(async () => {
      finishRefresh();
      await refreshPromise;
    });
    expect(view.getByTestId('episode-list').props.refreshControl.props.refreshing).toBe(false);
  });
});
