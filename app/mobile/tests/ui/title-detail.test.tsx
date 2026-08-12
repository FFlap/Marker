import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockTouchTitle = jest.fn().mockResolvedValue(undefined);
const mockAddItem = jest.fn().mockResolvedValue('new-item');
const mockAddItemAndMarkWatched = jest.fn().mockResolvedValue('new-item');
const mockLoadMore = jest.fn();
let titleView: any;
let mockSeasonView: any;
let library: any[] = [];
let mockParams: any;
let mockLoadedSeasonPages: Record<number, number> = {};
const episodeData = (view: ReturnType<typeof render>) => {
  let node: any = view.getByTestId('episode-list');
  while (node && !Array.isArray(node.props?.data)) node = node.parent;
  return node?.props.data as unknown[] | undefined;
};

const mockUseQuery = jest.fn((ref: string, args?: any) => {
  if (ref === 'getOwnedItemByTmdb')
    return (
      library.find((item) => item.tmdbId === args?.tmdbId && item.mediaType === args?.mediaType) ??
      null
    );
  if (ref === 'listTagSuggestions')
    return args === 'skip' ? undefined : [...new Set(library.flatMap((item) => item.tags ?? []))];
  if (ref === 'getTitleView')
    return titleView === undefined ? undefined : { title: titleView.title };
  if (ref === 'getTitleRequestState') return titleView?.requestState;
  if (ref === 'getSeasonRequestState') return mockSeasonView?.[args?.season]?.requestState;
  return undefined;
});
jest.mock('convex/react', () => ({
  useQuery: (...args: any[]) => mockUseQuery(...args),
  usePaginatedQuery: (_ref: string, args: any) => {
    if (args === 'skip') return { results: [], status: 'LoadingFirstPage', loadMore: mockLoadMore };
    const value = mockSeasonView?.[args?.season];
    if (value == null) return { results: [], status: 'LoadingFirstPage', loadMore: mockLoadMore };
    const row = value.season;
    const pageCount = mockLoadedSeasonPages[args.season] ?? 1;
    const chunks = Array.from({ length: pageCount }, (_, index) => ({
      season: row.season,
      metadataProvider: row.metadataProvider,
      orderEpoch: row.orderEpoch,
      totalCount: row.episodes.length,
      chunkIndex: index,
      episodes: row.episodes.slice(index * 120, (index + 1) * 120),
    })).filter((page) => page.episodes.length > 0 || row.episodes.length === 0);
    return {
      results: chunks,
      status: pageCount * 120 < row.episodes.length ? 'CanLoadMore' : 'Exhausted',
      loadMore: (count: number) => {
        mockLoadedSeasonPages[args.season] = pageCount + count;
        mockLoadMore(count);
      },
    };
  },
  useMutation: (ref: string) => (ref === 'touchTitle' ? mockTouchTitle : mockAddItem),
  useAction: () => mockAddItemAndMarkWatched,
}));
jest.mock('../../convex/_generated/api', () => ({
  api: {
    library: {
      getOwnedItemByTmdb: 'getOwnedItemByTmdb',
      listTagSuggestions: 'listTagSuggestions',
      addItem: 'addItem',
      addItemAndMarkWatched: 'addItemAndMarkWatched',
    },
    resolvedMetadata: {
      getTitleView: 'getTitleView',
      getTitleRequestState: 'getTitleRequestState',
      getSeasonView: 'getSeasonView',
      getSeasonRequestState: 'getSeasonRequestState',
      touchTitle: 'touchTitle',
      touchItemView: 'touchItemView',
    },
  },
}));
jest.mock('expo-router', () => ({
  Redirect: ({ href }: { href: string }) => {
    const { Text } = require('react-native');
    return <Text>{href}</Text>;
  },
  router: { replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-image', () => ({ Image: require('react-native').Image }));
jest.mock('../../src/components/ui/drawer', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  const DrawerContext = React.createContext({ open: false, onOpenChange: undefined });
  const drawer = ({
    children,
    onOpenChange,
    open,
  }: {
    children: React.ReactNode;
    onOpenChange?: (open: boolean) => void;
    open?: boolean;
  }) => (
    <DrawerContext.Provider value={{ open: open === true, onOpenChange }}>
      <View>
        {children}
        {open === true && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss drawer"
            onPress={() => onOpenChange?.(false)}
          />
        )}
      </View>
    </DrawerContext.Provider>
  );
  const container = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  const content = ({ children }: { children: React.ReactNode }) =>
    React.useContext(DrawerContext).open ? <View>{children}</View> : null;
  const trigger = ({ children }: { children: React.ReactElement }) => {
    const context = React.useContext(DrawerContext);
    return React.cloneElement(children, {
      onPress: () => context.onOpenChange?.(!context.open),
    });
  };
  const label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  return {
    Drawer: drawer,
    DrawerClose: container,
    DrawerContent: content,
    DrawerHeader: container,
    DrawerTitle: label,
    DrawerTrigger: trigger,
  };
});

import TitleDetail from '../../src/app/title/[mediaType]/[tmdbId]';
import { ToastProvider } from '../../src/components/ui/Toast';

describe('Explore title metadata subscriptions', () => {
  beforeEach(() => {
    mockParams = {
      mediaType: 'tv',
      tmdbId: '209867',
      preview: JSON.stringify({
        id: 209867,
        mediaType: 'tv',
        title: 'Frieren',
        posterPath: '/preview-poster.jpg',
        releaseDate: '2023-09-29',
        overview: 'An elf mage retraces a heroic journey.',
      }),
    };
    titleView = {
      title: {
        tmdbId: 209867,
        mediaType: 'tv',
        title: 'Canonical Frieren',
        posterPath: '/canonical-poster.jpg',
        firstAirDate: '2024-04-01',
        overview: 'Canonical overview that must not replace the preview.',
        runtime: 24,
        voteAverage: 8.7,
        genres: ['Animation'],
        cast: [{ name: 'Atsumi Tanezaki', character: 'Frieren' }],
        seasons: [
          { season: 1, name: 'Season 1', episodeCount: 1 },
          { season: 2, name: 'Season 2', episodeCount: 1 },
        ],
      },
      requestState: { state: 'succeeded' },
    };
    mockSeasonView = {
      1: {
        season: {
          season: 1,
          metadataProvider: 'tvdb',
          orderEpoch: 4,
          episodes: [{ season: 1, episode: 1, name: 'The Journey' }],
        },
        requestState: { state: 'succeeded' },
      },
      2: {
        season: {
          season: 2,
          metadataProvider: 'tvdb',
          orderEpoch: 4,
          episodes: [{ season: 2, episode: 1, name: 'A New Journey' }],
        },
        requestState: { state: 'succeeded' },
      },
    };
    library = [];
    mockLoadedSeasonPages = {};
    mockLoadMore.mockClear();
    mockTouchTitle.mockReset().mockResolvedValue(undefined);
    mockAddItem.mockClear().mockResolvedValue('new-item');
    mockAddItemAndMarkWatched.mockClear().mockResolvedValue('new-item');
  });

  const screen = async () =>
    await render(
      <ToastProvider>
        <TitleDetail />
      </ToastProvider>,
    );

  it('renders subscribed metadata and touches the title once on mount', async () => {
    const view = await screen();
    expect(view.getByText('The Journey')).toBeTruthy();
    expect(mockTouchTitle).toHaveBeenCalledWith({
      mediaType: 'tv',
      tmdbId: 209867,
      title: 'Frieren',
      season: 1,
    });
  });

  it('marks every episode watched when a TV show is added as Watched', async () => {
    const view = await screen();
    await act(async () => fireEvent.press(view.getByText('Add Entry')));
    await act(async () => fireEvent.press(view.getByText('Watched', { exact: true })));
    await act(async () =>
      fireEvent.press(await view.findByRole('button', { name: 'Dismiss drawer' })),
    );

    await waitFor(() =>
      expect(mockAddItemAndMarkWatched).toHaveBeenCalledWith(
        expect.objectContaining({ mediaType: 'tv', status: 'watched', timesWatched: 1 }),
      ),
    );
    expect(mockAddItem).not.toHaveBeenCalled();
  });

  it('forces the selected season refresh from pull-to-refresh', async () => {
    const view = await screen();
    const list = view.getByTestId('episode-list');
    await act(async () => list.props.refreshControl.props.onRefresh());
    expect(mockTouchTitle).toHaveBeenCalledWith({
      mediaType: 'tv',
      tmdbId: 209867,
      title: 'Frieren',
      season: 1,
      force: true,
    });
  });

  it('changes seasons from the parameterized subscription', async () => {
    const view = await screen();
    await fireEvent.press(view.getByLabelText('Choose season, current Season 1'));
    await fireEvent.press(view.getByLabelText('Select Season 2'));
    await waitFor(() => expect(view.getByText('A New Journey')).toBeTruthy());
    expect(view.queryByText('The Journey')).toBeNull();
    expect(mockTouchTitle).toHaveBeenCalledWith({
      mediaType: 'tv',
      tmdbId: 209867,
      title: 'Frieren',
      season: 2,
    });
  });

  it('shows cached data with a subtle failed update note', async () => {
    titleView.requestState = { state: 'failed' };
    const view = await screen();
    expect(view.getByText('couldn’t update — pull to retry')).toBeTruthy();
    expect(view.queryByText('Title details couldn’t be loaded.')).toBeNull();
  });

  it('latches preview hero fields after an initially undefined cold query', async () => {
    const canonical = titleView.title;
    titleView = undefined;
    const view = await screen();
    expect(view.getByTestId('title-detail-initial-placeholder')).toBeTruthy();
    expect(view.queryByText('Frieren')).toBeNull();

    titleView = { title: null, requestState: { state: 'inFlight' } };
    await act(async () =>
      view.rerender(
        <ToastProvider>
          <TitleDetail />
        </ToastProvider>,
      ),
    );
    const previewTitle = view.getByTestId('title-detail-name');
    const previewYear = view.getByTestId('title-detail-year');
    const previewOverview = view.getByTestId('title-detail-overview');
    const previewPosterSource = view.getByTestId('title-detail-poster').props.source;
    expect(view.getByLabelText('Loading genres')).toBeTruthy();
    expect(view.getByLabelText('Loading runtime')).toBeTruthy();
    expect(view.getByLabelText('Loading rating')).toBeTruthy();
    expect(view.getByLabelText('Loading cast')).toBeTruthy();
    expect(view.getByLabelText('Loading seasons')).toBeTruthy();
    expect(view.getByLabelText('Loading episodes')).toBeTruthy();
    expect(view.queryByLabelText('Loading full title details')).toBeNull();

    titleView = {
      title: canonical,
      requestState: { state: 'succeeded' },
    };
    await act(async () =>
      view.rerender(
        <ToastProvider>
          <TitleDetail />
        </ToastProvider>,
      ),
    );
    expect(view.getByTestId('title-detail-name')).toBe(previewTitle);
    expect(view.getByTestId('title-detail-year')).toBe(previewYear);
    expect(view.getByTestId('title-detail-overview')).toBe(previewOverview);
    expect(previewTitle.props.children).toBe('Frieren');
    expect(previewYear.props.children).toBe('2023');
    expect(previewOverview.props.children).toBe('An elf mage retraces a heroic journey.');
    expect(previewPosterSource).toBe('https://image.tmdb.org/t/p/w342/preview-poster.jpg');
    expect(view.getByTestId('title-detail-poster').props.source).toBe(previewPosterSource);
    expect(view.queryByText('Canonical Frieren')).toBeNull();
    expect(view.queryByText('2024')).toBeNull();
    expect(view.queryByText('Canonical overview that must not replace the preview.')).toBeNull();
    expect(view.getByText('Animation')).toBeTruthy();
    expect(view.getByText('24 min')).toBeTruthy();
    expect(view.getByText('8.7')).toBeTruthy();
    expect(view.getByText('Atsumi Tanezaki')).toBeTruthy();
    expect(view.getByText('The Journey')).toBeTruthy();
    expect(view.queryByLabelText('Loading genres')).toBeNull();
    expect(view.queryByLabelText('Loading episodes')).toBeNull();
  });

  it('waits for canonical metadata on a cold direct link without a preview and can add it', async () => {
    const canonical = titleView.title;
    mockParams = { mediaType: 'tv', tmdbId: '209867' };
    titleView = { title: null, requestState: { state: 'inFlight' } };
    const view = await screen();
    expect(view.getByTestId('title-detail-initial-placeholder')).toBeTruthy();
    expect(view.queryByText('Add Entry')).toBeNull();

    titleView = { title: canonical, requestState: { state: 'succeeded' } };
    await act(async () =>
      view.rerender(
        <ToastProvider>
          <TitleDetail />
        </ToastProvider>,
      ),
    );
    expect(view.getByTestId('title-detail-name').props.children).toBe('Canonical Frieren');
    await act(async () => fireEvent.press(view.getByText('Add Entry')));
    await act(async () =>
      fireEvent.press(await view.findByRole('button', { name: 'Dismiss drawer' })),
    );
    await waitFor(() =>
      expect(mockAddItem).toHaveBeenCalledWith(
        expect.objectContaining({ tmdbId: 209867, title: 'Canonical Frieren' }),
      ),
    );
  });

  it('ignores a route preview when canonical metadata is warm', async () => {
    mockParams.preview = JSON.stringify({
      id: 209867,
      mediaType: 'tv',
      title: 'Stale preview title',
      releaseDate: '1999-01-01',
    });
    const view = await screen();
    expect(view.getByTestId('title-detail-name').props.children).toBe('Canonical Frieren');
    expect(view.queryByText('Stale preview title')).toBeNull();
    expect(view.queryByText('1999')).toBeNull();
  });

  it('updates warm canonical fields in place when a refresh commits', async () => {
    mockParams.preview = JSON.stringify({
      id: 209867,
      mediaType: 'tv',
      title: 'Stale preview title',
    });
    const view = await screen();
    expect(view.getByTestId('title-detail-name').props.children).toBe('Canonical Frieren');
    titleView = {
      ...titleView,
      title: { ...titleView.title, title: 'Frieren: Beyond Journey’s End' },
    };
    await act(async () =>
      view.rerender(
        <ToastProvider>
          <TitleDetail />
        </ToastProvider>,
      ),
    );
    expect(view.getByTestId('title-detail-name').props.children).toBe(
      'Frieren: Beyond Journey’s End',
    );
    expect(view.queryByText('Stale preview title')).toBeNull();
  });

  it('uses a server-relative delay even when the client clock is fast', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2099-07-17T00:00:00Z'));
    try {
      titleView = {
        title: null,
        requestState: { state: 'inFlight', expiresAt: 1, delayMs: 2_000 },
      };
      await screen();
      expect(mockTouchTitle).toHaveBeenCalledTimes(1);
      await act(async () => jest.advanceTimersByTime(2_999));
      expect(mockTouchTitle).toHaveBeenCalledTimes(1);
      await act(async () => jest.advanceTimersByTime(1));
      expect(mockTouchTitle).toHaveBeenCalledTimes(2);
      expect(mockTouchTitle).toHaveBeenLastCalledWith({
        mediaType: 'tv',
        tmdbId: 209867,
        title: 'Frieren',
        season: 1,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('automatically re-touches at retryAt and keeps manual Retry available', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-17T00:00:00Z'));
    try {
      titleView = {
        title: null,
        requestState: {
          state: 'failed',
          errorCode: 'expired',
          retryAt: Date.now() + 30_000,
          delayMs: 30_000,
        },
      };
      const view = await screen();
      expect(view.getByText('Title details couldn’t be loaded.')).toBeTruthy();
      expect(view.getByText('Retry')).toBeTruthy();
      expect(mockTouchTitle).toHaveBeenCalledTimes(1);

      await act(async () => jest.advanceTimersByTime(29_999));
      expect(mockTouchTitle).toHaveBeenCalledTimes(1);
      await act(async () => jest.advanceTimersByTime(1));
      expect(mockTouchTitle).toHaveBeenCalledTimes(2);

      fireEvent.press(view.getByText('Retry'));
      expect(mockTouchTitle).toHaveBeenLastCalledWith({
        mediaType: 'tv',
        tmdbId: 209867,
        title: 'Frieren',
        season: 1,
        force: true,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('re-arms automatic retry when the server still reports an authoritative backoff', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-17T00:00:00Z'));
    try {
      titleView = {
        title: null,
        requestState: { state: 'failed', retryAt: Date.now() + 10_000, delayMs: 10_000 },
      };
      mockTouchTitle
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ scheduled: false, reason: 'backoff', delayMs: 15_000 })
        .mockResolvedValueOnce({ scheduled: true });
      await screen();
      await act(async () => jest.advanceTimersByTime(10_000));
      expect(mockTouchTitle).toHaveBeenCalledTimes(2);
      await act(async () => jest.advanceTimersByTime(14_999));
      expect(mockTouchTitle).toHaveBeenCalledTimes(2);
      await act(async () => jest.advanceTimersByTime(1));
      expect(mockTouchTitle).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('re-touches a failed season at retryAt after the title already succeeded', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-17T00:00:00Z'));
    try {
      mockSeasonView[1].requestState = {
        state: 'failed',
        retryAt: Date.now() + 5_000,
        delayMs: 5_000,
      };
      await screen();
      expect(mockTouchTitle).toHaveBeenCalledTimes(1);
      await act(async () => jest.advanceTimersByTime(4_999));
      expect(mockTouchTitle).toHaveBeenCalledTimes(1);
      await act(async () => jest.advanceTimersByTime(1));
      expect(mockTouchTitle).toHaveBeenCalledTimes(2);
      expect(mockTouchTitle).toHaveBeenLastCalledWith({
        mediaType: 'tv',
        tmdbId: 209867,
        title: 'Frieren',
        season: 1,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('coalesces matching title and season retry times into one combined re-touch', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-17T00:00:00Z'));
    try {
      const retryAt = Date.now() + 5_000;
      titleView.requestState = { state: 'failed', retryAt, delayMs: 5_000 };
      mockSeasonView[1].requestState = { state: 'failed', retryAt, delayMs: 5_000 };
      await screen();
      expect(mockTouchTitle).toHaveBeenCalledTimes(1);
      await act(async () => jest.advanceTimersByTime(5_000));
      expect(mockTouchTitle).toHaveBeenCalledTimes(2);
      expect(mockTouchTitle).toHaveBeenLastCalledWith({
        mediaType: 'tv',
        tmdbId: 209867,
        title: 'Frieren',
        season: 1,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('re-arms when a re-touch is answered with a fresh in-flight delay', async () => {
    jest.useFakeTimers();
    try {
      titleView = {
        title: null,
        requestState: { state: 'inFlight', delayMs: 1_000 },
      };
      mockTouchTitle
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ scheduled: false, reason: 'inFlight', delayMs: 4_000 })
        .mockResolvedValueOnce({ scheduled: true });
      await screen();
      await act(async () => jest.advanceTimersByTime(2_000));
      expect(mockTouchTitle).toHaveBeenCalledTimes(2);
      await act(async () => jest.advanceTimersByTime(4_999));
      expect(mockTouchTitle).toHaveBeenCalledTimes(2);
      await act(async () => jest.advanceTimersByTime(1));
      expect(mockTouchTitle).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('never spins failed-state re-polls below the five-second floor', async () => {
    jest.useFakeTimers();
    try {
      titleView = { title: null, requestState: { state: 'failed', delayMs: 0 } };
      mockTouchTitle
        .mockResolvedValueOnce(undefined)
        .mockResolvedValue({ scheduled: false, reason: 'backoff', delayMs: 0 });
      await screen();
      await act(async () => jest.advanceTimersByTime(4_999));
      expect(mockTouchTitle).toHaveBeenCalledTimes(1);
      await act(async () => jest.advanceTimersByTime(1));
      expect(mockTouchTitle).toHaveBeenCalledTimes(2);
      await act(async () => jest.advanceTimersByTime(4_999));
      expect(mockTouchTitle).toHaveBeenCalledTimes(2);
      await act(async () => jest.advanceTimersByTime(1));
      expect(mockTouchTitle).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('re-arms with backoff when an automatic re-touch mutation is rejected', async () => {
    jest.useFakeTimers();
    try {
      titleView = { title: null, requestState: { state: 'failed', delayMs: 0 } };
      mockTouchTitle
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('touch budget unavailable'))
        .mockResolvedValueOnce({ scheduled: true });
      await screen();
      await act(async () => jest.advanceTimersByTime(5_000));
      expect(mockTouchTitle).toHaveBeenCalledTimes(2);
      await act(async () => jest.advanceTimersByTime(9_999));
      expect(mockTouchTitle).toHaveBeenCalledTimes(2);
      await act(async () => jest.advanceTimersByTime(1));
      expect(mockTouchTitle).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('surfaces a failed cold touch as a retryable error', async () => {
    titleView = { title: null, requestState: undefined };
    mockTouchTitle.mockRejectedValueOnce(new Error('network unavailable'));
    const view = await screen();
    await waitFor(() => expect(view.getByText('Title details couldn’t be loaded.')).toBeTruthy());
    expect(view.getByText('Retry')).toBeTruthy();
  });

  it('ignores a late season-A touch rejection after season B owns the request', async () => {
    let rejectSeasonOne!: (error: unknown) => void;
    mockTouchTitle
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectSeasonOne = reject;
          }),
      )
      .mockResolvedValue({ scheduled: true });
    const view = await screen();
    await waitFor(() => expect(mockTouchTitle).toHaveBeenCalledTimes(1));
    await act(async () => fireEvent.press(view.getByLabelText('Choose season, current Season 1')));
    await act(async () => fireEvent.press(view.getByLabelText('Select Season 2')));
    await waitFor(() => expect(mockTouchTitle).toHaveBeenCalledTimes(2));
    await act(async () => rejectSeasonOne(new Error('late season one failure')));
    expect(view.queryByText('couldn’t update — pull to retry')).toBeNull();
    expect(view.queryByText('Title details couldn’t be loaded.')).toBeNull();
  });

  it('shows a working retry state for a failed cold route without a preview', async () => {
    mockParams = { mediaType: 'tv', tmdbId: '209867' };
    titleView = { title: null, requestState: { state: 'failed' } };
    const view = await screen();
    expect(view.queryByTestId('title-detail-initial-placeholder')).toBeNull();
    expect(view.getByText('Title details couldn’t be loaded.')).toBeTruthy();
    fireEvent.press(view.getByText('Retry'));
    expect(mockTouchTitle).toHaveBeenLastCalledWith({
      mediaType: 'tv',
      tmdbId: 209867,
      season: 1,
      force: true,
    });
  });

  it('resets hero ownership synchronously when the screen is reused for another title', async () => {
    titleView = { ...titleView, title: null };
    const view = await screen();
    expect(view.getByTestId('title-detail-name').props.children).toBe('Frieren');
    mockParams = { mediaType: 'movie', tmdbId: '77' };
    titleView = {
      title: {
        tmdbId: 77,
        mediaType: 'movie',
        title: 'New canonical title',
        genres: [],
        cast: [],
        seasons: [],
      },
      requestState: { state: 'succeeded' },
    };
    await act(async () =>
      view.rerender(
        <ToastProvider>
          <TitleDetail />
        </ToastProvider>,
      ),
    );
    expect(view.getByTestId('title-detail-name').props.children).toBe('New canonical title');
    expect(view.queryByText('Frieren')).toBeNull();
  });

  it('resets expanded episodes and the entry drawer when routeKey changes', async () => {
    const view = await screen();
    await act(async () => fireEvent.press(view.getByLabelText('View episode 1')));
    await act(async () => fireEvent.press(view.getAllByText('Add Entry')[0]));
    expect(view.getByLabelText('View episode 1').props.accessibilityState.expanded).toBe(true);
    expect(view.getAllByText('Add to library')).not.toHaveLength(0);

    mockParams = { mediaType: 'tv', tmdbId: '300000' };
    titleView = {
      title: {
        ...titleView.title,
        tmdbId: 300000,
        title: 'Reused route title',
      },
      requestState: { state: 'succeeded' },
    };
    await act(async () =>
      view.rerender(
        <ToastProvider>
          <TitleDetail />
        </ToastProvider>,
      ),
    );

    expect(view.getByLabelText('View episode 1').props.accessibilityState.expanded).toBe(false);
    expect(view.queryByText('Add to library')).toBeNull();
  });

  it('resets the selected season before touching a cold title on route reuse', async () => {
    titleView.title.seasons.push({ season: 5, name: 'Season 5', episodeCount: 1 });
    mockSeasonView[5] = {
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
    mockParams = { mediaType: 'tv', tmdbId: '300000' };
    titleView = { title: null, requestState: { state: 'inFlight' } };
    mockSeasonView = {};
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

  it('renders one season page and loads another bounded page', async () => {
    mockSeasonView[1].season.episodes = Array.from({ length: 121 }, (_, index) => ({
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
    mockSeasonView[1] = {
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
});
