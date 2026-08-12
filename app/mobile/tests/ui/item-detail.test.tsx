import React from 'react';
import { act, render, userEvent, waitFor } from '@testing-library/react-native';

const mockTouchItemView = jest.fn().mockResolvedValue(undefined);
const mockTouchTitle = jest.fn().mockResolvedValue(undefined);
const mockUpdateItem = jest.fn().mockResolvedValue(undefined);
const mockRemoveItem = jest.fn().mockResolvedValue(undefined);
const mockSetEpisodeState = jest.fn().mockResolvedValue(undefined);
const mockSetSeasonWatched = jest.fn().mockResolvedValue(undefined);
const mockMoveItemToWatched = jest.fn().mockResolvedValue(undefined);
const mockResolveSeason = jest.fn().mockResolvedValue([]);
const mockLoadMore = jest.fn();
let itemView: any;
let mockSeasonView: any;
let savedEpisodes: any[] = [];
let episodeProgressOverride: any[] | undefined;
let queryShouldThrow = false;
let mockLoadedSeasonPages: Record<number, number> = {};
let mockParams = { id: 'item' };
const episodeData = (view: ReturnType<typeof render>) => {
  let node: any = view.getByTestId('episode-list');
  while (node && !Array.isArray(node.props?.data)) node = node.parent;
  return node?.props.data as unknown[] | undefined;
};

const item = {
  _id: 'item',
  tmdbId: 61889,
  mediaType: 'tv' as const,
  title: 'Daredevil',
  status: 'watching' as const,
  rating: undefined,
  timesWatched: 0,
  tags: [],
  rank: 1,
};
const title = {
  tmdbId: 61889,
  title: 'Daredevil',
  mediaType: 'tv',
  metadataProvider: 'tvdb',
  orderEpoch: 7,
  genres: ['Drama'],
  cast: [{ name: 'Charlie Cox', character: 'Matt Murdock' }],
  seasons: [
    { season: 1, name: 'Season 1', episodeCount: 1 },
    { season: 2, name: 'Season 2', episodeCount: 1 },
  ],
};
const seasonOne = {
  season: 1,
  metadataProvider: 'tvdb' as const,
  orderEpoch: 7,
  episodes: [{ season: 1, episode: 1, name: 'Into the Ring' }],
};
const seasonTwo = {
  season: 2,
  metadataProvider: 'tvdb' as const,
  orderEpoch: 7,
  episodes: [{ season: 2, episode: 1, name: 'Cut Man' }],
};

const mockUseQuery = jest.fn((ref: string, args?: any) => {
  if (queryShouldThrow) throw new Error('query failed');
  if (ref === 'getItemView') return itemView;
  if (ref === 'getTitleRequestState') return itemView?.requestState?.title;
  if (ref === 'getSeasonRequestState') return mockSeasonView?.[args?.season]?.requestState;
  if (ref === 'listEpisodes') return savedEpisodes;
  if (ref === 'listEpisodeProgress')
    return (
      episodeProgressOverride ??
      Object.values(
        savedEpisodes.reduce<
          Record<number, { season: number; watchedCount: number; total: number }>
        >((summaries, episode) => {
          const summary = summaries[episode.season] ?? {
            season: episode.season,
            watchedCount: 0,
            total: 0,
          };
          summary.total += 1;
          if (episode.watched) summary.watchedCount += 1;
          summaries[episode.season] = summary;
          return summaries;
        }, {}),
      ).map((summary) => ({
        ...summary,
        currentWatchedCount: summary.watchedCount,
        currentTotal: summary.total,
        identityStale: false,
      }))
    );
  if (ref === 'listItems') return [itemView?.item ?? item];
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
  useMutation: (ref: string) =>
    ref === 'touchItemView'
      ? mockTouchItemView
      : ref === 'touchTitle'
        ? mockTouchTitle
        : ref === 'updateItem'
          ? mockUpdateItem
          : ref === 'removeItem'
            ? mockRemoveItem
            : ref === 'setEpisodeState'
              ? mockSetEpisodeState
              : ref === 'setSeasonWatched'
                ? mockSetSeasonWatched
                : jest.fn(),
  useAction: (ref: string) =>
    ref === 'setSeasonWatched'
      ? mockSetSeasonWatched
      : ref === 'moveItemToWatched'
        ? mockMoveItemToWatched
        : ref === 'resolveSeason'
          ? mockResolveSeason
          : jest.fn().mockResolvedValue([]),
}));
jest.mock('../../convex/_generated/api', () => ({
  api: {
    library: {
      listItems: 'listItems',
      listEpisodes: 'listEpisodes',
      listEpisodeProgress: 'listEpisodeProgress',
      updateItem: 'updateItem',
      removeItem: 'removeItem',
      setEpisodeState: 'setEpisodeState',
      setSeasonWatched: 'setSeasonWatched',
      moveItemToWatched: 'moveItemToWatched',
    },
    resolvedMetadata: {
      getItemView: 'getItemView',
      getSeasonView: 'getSeasonView',
      getSeasonRequestState: 'getSeasonRequestState',
      getTitleRequestState: 'getTitleRequestState',
      getTitleView: 'getTitleView',
      touchTitle: 'touchTitle',
      touchItemView: 'touchItemView',
      resolveSeason: 'resolveSeason',
    },
  },
}));
jest.mock('expo-router', () => ({
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

import ItemDetail from '../../src/app/item/[id]';
import { ToastProvider } from '../../src/components/ui/Toast';

describe('item detail metadata subscriptions', () => {
  beforeEach(() => {
    itemView = { item, title, requestState: { title: { state: 'succeeded' } } };
    mockParams = { id: 'item' };
    mockSeasonView = { 1: { season: seasonOne, requestState: { state: 'succeeded' } } };
    savedEpisodes = [];
    episodeProgressOverride = undefined;
    queryShouldThrow = false;
    mockLoadedSeasonPages = {};
    mockLoadMore.mockClear();
    mockUseQuery.mockClear();
    mockTouchItemView.mockClear();
    mockTouchTitle.mockClear();
    mockSetEpisodeState.mockReset().mockResolvedValue(undefined);
    mockSetSeasonWatched.mockReset().mockResolvedValue(undefined);
    mockMoveItemToWatched.mockReset().mockResolvedValue(undefined);
    mockResolveSeason
      .mockReset()
      .mockImplementation(async ({ season }: { season: number }) => [
        { season, episode: 1, name: `Episode ${season}` },
      ]);
  });

  const renderScreen = async () =>
    await render(
      <ToastProvider>
        <ItemDetail />
      </ToastProvider>,
    );

  it('renders cached title and episodes without an action call', async () => {
    const view = await renderScreen();
    expect(view.getByText('Into the Ring')).toBeTruthy();
    expect(view.getByText('Charlie Cox')).toBeTruthy();
    expect(mockTouchItemView).toHaveBeenCalledWith({ itemId: 'item', season: 1 });
  });

  it('uses the server-side whole-show action when the entry status becomes Watched', async () => {
    const view = await renderScreen();
    const user = userEvent.setup();
    await user.press(view.getByText('Update Entry'));
    const watchedLabels = view.getAllByText('Watched', { exact: true });
    expect(watchedLabels.length).toBeGreaterThan(1);
    await user.press(watchedLabels[watchedLabels.length - 1]);
    expect(
      view.getByText('Marking this show as Watched will mark every episode as watched.'),
    ).toBeTruthy();
    await user.press(view.getByRole('button', { name: 'Dismiss drawer' }));

    await waitFor(() => expect(mockMoveItemToWatched).toHaveBeenCalledWith({ itemId: 'item' }));
    expect(mockSetSeasonWatched).not.toHaveBeenCalled();
    expect(mockUpdateItem).toHaveBeenCalledWith(
      expect.not.objectContaining({ status: expect.anything() }),
    );
  });

  it('touches the selected season and forces refresh from pull-to-refresh', async () => {
    const view = await renderScreen();
    const user = userEvent.setup();
    await user.press(view.getByLabelText('Choose season, current Season 1'));
    await user.press(view.getByLabelText('Select Season 2'));
    expect(mockTouchItemView).toHaveBeenCalledWith({ itemId: 'item', season: 2 });
    const scroll = view.getByTestId('episode-list');
    await act(async () => scroll.props.refreshControl.props.onRefresh());
    expect(mockTouchItemView).toHaveBeenCalledWith({ itemId: 'item', season: 2, force: true });
  });

  it('shows a non-blocking failure note when cached metadata exists', async () => {
    itemView = {
      item,
      title,
      requestState: { title: { state: 'failed' } },
    };
    mockSeasonView = { 1: { season: seasonOne, requestState: { state: 'failed' } } };
    const view = await renderScreen();
    expect(view.getAllByText('couldn’t update — pull to retry')).toHaveLength(2);
    expect(view.queryByText('Title details couldn’t be loaded.')).toBeNull();
  });

  it('shows a skeleton on a cold title and renders when the subscription delivers', async () => {
    itemView = { item, title: null, requestState: { title: undefined } };
    mockSeasonView = { 1: null };
    const view = await renderScreen();
    expect(view.getByLabelText('Loading')).toBeTruthy();
    itemView = { item, title, requestState: { title: { state: 'succeeded' } } };
    mockSeasonView = { 1: { season: seasonOne, requestState: { state: 'succeeded' } } };
    await act(async () =>
      view.rerender(
        <ToastProvider>
          <ItemDetail />
        </ToastProvider>,
      ),
    );
    await waitFor(() => expect(view.getByText('Into the Ring')).toBeTruthy());
  });

  it('discards a returned season row whose identity does not match the active argument', async () => {
    mockSeasonView = {
      1: {
        season: seasonTwo,
        requestState: { state: 'succeeded' },
      },
    };
    const view = await renderScreen();
    expect(view.queryByText('Cut Man')).toBeNull();
    expect(view.getByLabelText('Loading')).toBeTruthy();
  });

  it('passes the observed season epoch and provider when marking a season watched', async () => {
    const view = await renderScreen();
    const user = userEvent.setup();
    await user.press(view.getByText('Mark watched'));
    await waitFor(() =>
      expect(mockSetSeasonWatched).toHaveBeenCalledWith({
        itemId: 'item',
        season: 1,
        watched: true,
        orderEpoch: 7,
        metadataProvider: 'tvdb',
      }),
    );
  });

  it('derives season progress and mark-watched state from current identity counts', async () => {
    episodeProgressOverride = [
      {
        season: 1,
        watchedCount: 1,
        total: 1,
        currentWatchedCount: 0,
        currentTotal: 0,
        identityStale: true,
      },
    ];
    const view = await renderScreen();
    expect(view.getByText('0 of 1 watched')).toBeTruthy();
    const user = userEvent.setup();
    await user.press(view.getByText('Mark watched'));
    await waitFor(() =>
      expect(mockSetSeasonWatched).toHaveBeenCalledWith({
        itemId: 'item',
        season: 1,
        watched: true,
        orderEpoch: 7,
        metadataProvider: 'tvdb',
      }),
    );
  });

  it('refreshes with a specific toast when the observed season epoch is stale', async () => {
    mockSetSeasonWatched.mockRejectedValueOnce(
      new Error('Season metadata changed; reload before marking the season watched'),
    );
    const view = await renderScreen();
    const user = userEvent.setup();
    await user.press(view.getByText('Mark watched'));
    await waitFor(() => expect(view.getByText('Season data changed — refreshing')).toBeTruthy());
    expect(mockTouchItemView).toHaveBeenLastCalledWith({
      itemId: 'item',
      season: 1,
      force: true,
    });
  });

  it('re-touches the selected season after its mounted request lease expires', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-17T00:00:00Z'));
    try {
      mockSeasonView = {
        1: {
          season: seasonOne,
          requestState: { state: 'inFlight', expiresAt: Date.now() + 2_000, delayMs: 2_000 },
        },
      };
      await renderScreen();
      expect(mockTouchItemView).toHaveBeenCalledTimes(1);
      await act(async () => jest.advanceTimersByTime(3_000));
      expect(mockTouchItemView).toHaveBeenCalledTimes(2);
      expect(mockTouchItemView).toHaveBeenLastCalledWith({ itemId: 'item', season: 1 });
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
      await renderScreen();
      expect(mockTouchItemView).toHaveBeenCalledTimes(1);
      await act(async () => jest.advanceTimersByTime(5_000));
      expect(mockTouchItemView).toHaveBeenCalledTimes(2);
      expect(mockTouchItemView).toHaveBeenLastCalledWith({ itemId: 'item', season: 1 });
    } finally {
      jest.useRealTimers();
    }
  });

  it('coalesces matching title and season retry times into one combined re-touch', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-17T00:00:00Z'));
    try {
      const retryAt = Date.now() + 5_000;
      itemView.requestState.title = { state: 'failed', retryAt, delayMs: 5_000 };
      mockSeasonView[1].requestState = { state: 'failed', retryAt, delayMs: 5_000 };
      await renderScreen();
      expect(mockTouchItemView).toHaveBeenCalledTimes(1);
      await act(async () => jest.advanceTimersByTime(5_000));
      expect(mockTouchItemView).toHaveBeenCalledTimes(2);
      expect(mockTouchItemView).toHaveBeenLastCalledWith({ itemId: 'item', season: 1 });
    } finally {
      jest.useRealTimers();
    }
  });

  it('subscribes saved episode state only for the selected season', async () => {
    mockSeasonView[2] = { season: seasonTwo, requestState: { state: 'succeeded' } };
    const view = await renderScreen();
    expect(mockUseQuery).toHaveBeenCalledWith('listEpisodes', {
      itemId: 'item',
      season: 1,
      pageCount: 1,
    });
    const user = userEvent.setup();
    await user.press(view.getByLabelText('Choose season, current Season 1'));
    await user.press(view.getByLabelText('Select Season 2'));
    expect(mockUseQuery).toHaveBeenCalledWith('listEpisodes', {
      itemId: 'item',
      season: 2,
      pageCount: 1,
    });
  });

  it('changes an unwatched episode checkbox into an options button after watching', async () => {
    const view = await renderScreen();
    const user = userEvent.setup();
    await user.press(view.getByLabelText('Mark episode 1 watched'));
    expect(mockSetEpisodeState).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 'item', season: 1, episode: 1, watched: true }),
    );
    expect(view.getByText('Edit episode 1')).toBeTruthy();
    expect(view.getByLabelText('Current rating')).toBeTruthy();

    savedEpisodes = [{ season: 1, episode: 1, watched: true, tags: [] }];
    await act(async () =>
      view.rerender(
        <ToastProvider>
          <ItemDetail />
        </ToastProvider>,
      ),
    );
    expect(view.getByLabelText('Episode 1 options')).toBeTruthy();
  });

  it('resets the selected season before touching a cold item on route reuse', async () => {
    const titleWithSeasonFive = {
      ...title,
      seasons: [...title.seasons, { season: 5, name: 'Season 5', episodeCount: 1 }],
    };
    itemView = {
      item,
      title: titleWithSeasonFive,
      requestState: { title: { state: 'succeeded' } },
    };
    mockSeasonView[5] = {
      season: {
        season: 5,
        metadataProvider: 'tvdb',
        orderEpoch: 7,
        episodes: [{ season: 5, episode: 1, name: 'Far Future' }],
      },
      requestState: { state: 'succeeded' },
    };
    const view = await renderScreen();
    const user = userEvent.setup();
    await user.press(view.getByLabelText('Choose season, current Season 1'));
    await user.press(view.getByLabelText('Select Season 5'));
    await waitFor(() => expect(view.getByText('Far Future')).toBeTruthy());

    mockTouchItemView.mockClear();
    mockParams = { id: 'item-b' };
    itemView = {
      item: { ...item, _id: 'item-b', tmdbId: 999, title: 'Cold B' },
      title: null,
      requestState: { title: { state: 'inFlight' } },
    };
    mockSeasonView = {};
    await act(async () =>
      view.rerender(
        <ToastProvider>
          <ItemDetail />
        </ToastProvider>,
      ),
    );
    expect(mockTouchItemView).toHaveBeenCalledWith({ itemId: 'item-b', season: 1 });
    expect(mockTouchItemView).not.toHaveBeenCalledWith({ itemId: 'item-b', season: 5 });
  });

  it('resets pending item and episode drafts synchronously on route reuse', async () => {
    savedEpisodes = [{ season: 1, episode: 1, watched: true, rating: undefined, tags: [] }];
    mockSetEpisodeState.mockImplementation(() => new Promise(() => undefined));
    const view = await renderScreen();
    const user = userEvent.setup();
    await user.press(view.getByLabelText('Episode 1 options'));
    await user.press(view.getByLabelText('Rate 4 stars'));
    await user.press(view.getByRole('button', { name: 'Mark episode unwatched' }));
    expect(view.getByLabelText('Current rating').props.accessibilityValue.text).toBe(
      '4 out of 5 stars',
    );
    expect(
      view.getByRole('button', { name: 'Mark episode unwatched' }).props.accessibilityState
        .disabled,
    ).toBe(true);

    mockParams = { id: 'item-b' };
    itemView = {
      item: { ...item, _id: 'item-b', tmdbId: 999, title: 'Item B', rating: 3 },
      title: { ...title, tmdbId: 999, title: 'Item B' },
      requestState: { title: { state: 'succeeded' } },
    };
    mockSeasonView = { 1: { season: seasonOne, requestState: { state: 'succeeded' } } };
    savedEpisodes = [{ season: 1, episode: 1, watched: true, rating: undefined, tags: [] }];
    await act(async () =>
      view.rerender(
        <ToastProvider>
          <ItemDetail />
        </ToastProvider>,
      ),
    );

    expect(view.getByText('3.0')).toBeTruthy();
    await user.press(view.getByLabelText('Episode 1 options'));
    expect(
      view.getByRole('button', { name: 'Mark episode unwatched' }).props.accessibilityState
        .disabled,
    ).toBe(false);
    expect(view.getByLabelText('Current rating').props.accessibilityValue.text).toBe('Not rated');
  });

  it('renders the first season page and loads more episodes', async () => {
    mockSeasonView[1] = {
      ...mockSeasonView[1],
      season: {
        ...mockSeasonView[1].season,
        episodes: Array.from({ length: 121 }, (_, index) => ({
          season: 1,
          episode: index + 1,
          name: `Episode ${index + 1}`,
        })),
      },
    };
    const view = await renderScreen();
    expect(view.getByText('Episode 1')).toBeTruthy();
    expect(episodeData(view)).toHaveLength(120);
    const user = userEvent.setup();
    await user.press(view.getByText('Load more episodes'));
    expect(mockLoadMore).toHaveBeenCalledWith(1);
    await act(async () =>
      view.rerender(
        <ToastProvider>
          <ItemDetail />
        </ToastProvider>,
      ),
    );
    expect(episodeData(view)).toHaveLength(121);
  });
});
