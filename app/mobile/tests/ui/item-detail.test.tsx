import React from 'react';
import { act, cleanup, render, userEvent, waitFor } from '@testing-library/react-native';

const mockTouchItemView = jest.fn().mockResolvedValue(undefined);
const mockTouchTitle = jest.fn().mockResolvedValue(undefined);
const mockUpdateItem = jest.fn().mockResolvedValue(undefined);
const mockRemoveItem = jest.fn().mockResolvedValue(undefined);
const mockSetEpisodeState = jest.fn().mockResolvedValue(undefined);
const mockSetSeasonWatched = jest.fn().mockResolvedValue(undefined);
const mockMoveItemToWatched = jest.fn().mockResolvedValue(undefined);
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
        : jest.fn().mockResolvedValue([]),
}));
jest.mock('@marker/shared/api', () => ({
  api: {
    library: {
      items: {
        listItems: 'listItems',
        listTagSuggestions: 'listTagSuggestions',
        updateItem: 'updateItem',
        removeItem: 'removeItem',
      },
      episodes: {
        listEpisodes: 'listEpisodes',
        listEpisodeProgress: 'listEpisodeProgress',
        setEpisodeState: 'setEpisodeState',
      },
      seasonWatched: {
        setSeasonWatched: 'setSeasonWatched',
        moveItemToWatched: 'moveItemToWatched',
      },
    },
    resolvedMetadata: {
      reads: {
        getItemView: 'getItemView',
        getSeasonView: 'getSeasonView',
        getSeasonRequestState: 'getSeasonRequestState',
        getTitleRequestState: 'getTitleRequestState',
        getTitleView: 'getTitleView',
      },
      touch: {
        touchTitle: 'touchTitle',
        touchItemView: 'touchItemView',
      },
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
  const Content = ({ children }: { children: React.ReactNode }) =>
    React.useContext(DrawerContext).open ? <View>{children}</View> : null;
  const Trigger = ({ children }: { children: React.ReactElement }) => {
    const context = React.useContext(DrawerContext);
    return React.cloneElement(children, {
      onPress: () => context.onOpenChange?.(!context.open),
    });
  };
  const label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  return {
    Drawer: drawer,
    DrawerClose: container,
    DrawerContent: Content,
    DrawerHeader: container,
    DrawerTitle: label,
    DrawerTrigger: Trigger,
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
    mockUpdateItem.mockClear();
    mockSetEpisodeState.mockReset().mockResolvedValue(undefined);
    mockSetSeasonWatched.mockReset().mockResolvedValue(undefined);
    mockMoveItemToWatched.mockReset().mockResolvedValue(undefined);
  });

  const renderScreen = async () =>
    await render(
      <ToastProvider>
        <ItemDetail />
      </ToastProvider>,
    );

  it('trusts a missing item view instead of falling back to the library subscription', async () => {
    itemView = null;
    const view = await renderScreen();
    expect(view.getByText('Title not found')).toBeTruthy();
    expect(mockUseQuery).not.toHaveBeenCalledWith('listItems');
    expect(mockUseQuery).toHaveBeenCalledWith('listTagSuggestions', 'skip');
  });

  it('selects the lowest regular season and keeps unknown counts and specials available', async () => {
    itemView = {
      ...itemView,
      title: {
        ...title,
        seasons: [
          { season: 5, name: 'Season 5', episodeCount: 1 },
          { season: 0, name: 'Specials', episodeCount: 1 },
          { season: 1, name: 'Season 1', episodeCount: 0, episodeCountVerified: true },
          { season: 2, name: 'Season 2', episodeCount: 0, episodeCountVerified: false },
          { season: 3, name: 'Season 3', episodeCount: 0 },
        ],
      },
    };
    mockSeasonView = { 2: { season: seasonTwo, requestState: { state: 'succeeded' } } };
    const view = await renderScreen();
    const user = userEvent.setup();
    expect(view.getByText('Cut Man')).toBeTruthy();
    expect(mockTouchItemView).toHaveBeenCalledWith({ itemId: 'item', season: 2 });
    await user.press(view.getByLabelText('Choose season, current Season 2'));
    expect(view.getByLabelText('Select Season 2')).toBeTruthy();
    expect(view.getByText('Episodes pending')).toBeTruthy();
    expect(view.queryByLabelText('Select Season 1')).toBeNull();
    expect(view.queryByLabelText('Select Season 3')).toBeNull();
    await user.press(view.getByLabelText('Select Specials'));
    expect(mockTouchItemView).toHaveBeenLastCalledWith({ itemId: 'item', season: 0 });
  });

  it('uses the server-side whole-show action when the entry status becomes Watched', async () => {
    const view = await renderScreen();
    const user = userEvent.setup();
    await user.press(view.getByText('Edit'));
    expect(view.queryByLabelText('Increase times watched')).toBeNull();
    const watchedLabels = view.getAllByText('Watched', { exact: true });
    expect(watchedLabels.length).toBeGreaterThan(1);
    await user.press(watchedLabels[watchedLabels.length - 1]);
    expect(
      view.getByText('Marking this show as Watched will mark every episode as watched.'),
    ).toBeTruthy();
    await user.press(view.getByLabelText('Increase times watched'));
    await user.press(view.getByRole('button', { name: 'Dismiss drawer' }));

    await waitFor(() => expect(mockMoveItemToWatched).toHaveBeenCalledWith({ itemId: 'item' }));
    expect(mockSetSeasonWatched).not.toHaveBeenCalled();
    expect(mockUpdateItem).toHaveBeenCalledWith(
      expect.not.objectContaining({ status: expect.anything() }),
    );
    expect(mockUpdateItem).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 'item', timesWatched: 2 }),
    );
    await user.press(view.getByText('Edit'));
    expect(view.queryByLabelText('Increase times watched')).toBeNull();
    await user.press(view.getByRole('button', { name: 'Dismiss drawer' }));
    expect(mockUpdateItem).toHaveBeenCalledTimes(1);
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

  it('keeps pull-to-refresh active until the metadata request finishes', async () => {
    const view = await renderScreen();
    let finishRefresh!: () => void;
    mockTouchItemView.mockImplementationOnce(
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

  it('offers a retry when an item refresh fails before request state is published', async () => {
    itemView = { item, title: null, requestState: { title: undefined } };
    mockSeasonView = {};
    mockTouchItemView.mockRejectedValueOnce(new Error('offline'));
    const view = await renderScreen();
    await waitFor(() => expect(view.getByText('Title details couldn’t be loaded.')).toBeTruthy());
    await userEvent.setup().press(view.getAllByText('Retry')[0]);
    expect(mockTouchItemView).toHaveBeenLastCalledWith({
      itemId: 'item',
      season: 1,
      force: true,
    });
    expect(view.queryByText('Title details couldn’t be loaded.')).toBeNull();
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
    expect(view.getByText('0 / 1 watched')).toBeTruthy();
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
    mockSeasonView[1] = {
      ...mockSeasonView[1],
      season: {
        ...seasonOne,
        episodes: [{ ...seasonOne.episodes[0], overview: 'x'.repeat(401) }],
      },
    };
    const view = await renderScreen();
    const user = userEvent.setup();
    const watchButton = view.getByLabelText('Mark episode 1 watched');
    expect(watchButton.props.accessibilityHint).toBe(
      'Opens episode options after marking it watched',
    );
    await user.press(watchButton);
    expect(mockSetEpisodeState).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 'item',
        season: 1,
        episode: 1,
        watched: true,
        overview: 'x'.repeat(400),
      }),
    );
    expect(view.getByText('Edit episode 1')).toBeTruthy();
    let resolveRating!: () => void;
    mockSetEpisodeState.mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolveRating = resolve)),
    );
    await user.press(view.getByLabelText('Rate 3.5 stars'));
    expect(mockSetEpisodeState).toHaveBeenLastCalledWith({
      itemId: 'item',
      season: 1,
      episode: 1,
      rating: 3.5,
    });
    expect(view.getByLabelText('Current rating').props.accessibilityValue.text).toBe(
      '3.5 out of 5 stars',
    );
    savedEpisodes = [{ season: 1, episode: 1, watched: true, rating: 3.5, tags: [] }];
    await act(async () => resolveRating());
    await user.press(view.getByLabelText('Clear rating'));
    expect(mockSetEpisodeState).toHaveBeenLastCalledWith({
      itemId: 'item',
      season: 1,
      episode: 1,
      clearRating: true,
    });

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

  describe('optimistic episode fields', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(async () => {
      await cleanup();
      jest.useRealTimers();
    });

    const screen = () => (
      <React.StrictMode>
        <ToastProvider>
          <ItemDetail />
        </ToastProvider>
      </React.StrictMode>
    );
    const setup = async () => {
      savedEpisodes = [{ season: 1, episode: 1, watched: true, rating: 2, tags: [] }];
      const requests: { reject: (error: Error) => void; resolve: () => void }[] = [];
      mockSetEpisodeState.mockImplementation(
        () => new Promise<void>((resolve, reject) => requests.push({ resolve, reject })),
      );
      const view = await render(screen());
      const card = () => {
        let node: any = view.getByTestId('episode-list');
        while (node && !Array.isArray(node.props?.data)) node = node.parent;
        return node.props.renderItem({ item: node.props.data[0] });
      };
      const patch = async (field: 'rating' | 'tags', value: number | undefined | string[]) => {
        await act(async () => card().props.onPatch(field, value));
      };
      const publish = async (rating: number | undefined, tags: string[] = []) => {
        savedEpisodes = [{ season: 1, episode: 1, watched: true, rating, tags }];
        await view.rerender(screen());
      };
      const fail = async (index: number) => {
        await act(async () => requests[index].reject(new Error('offline')));
      };
      return { view, card, patch, publish, requests, fail };
    };

    it('releases a successful no-op write before later remote changes', async () => {
      const { card, patch, publish, requests } = await setup();
      await patch('rating', 2);
      await act(async () => requests[0].resolve());
      await publish(5);
      expect(card().props.draft.rating).toBe(5);
    });

    it('releases a successful tag write after the backend normalizes it', async () => {
      const { card, patch, publish, requests } = await setup();
      await patch('tags', [' favorite ', 'favorite']);
      await publish(2, ['favorite']);
      await act(async () => requests[0].resolve());
      expect(card().props.draft.tags).toEqual(['favorite']);
      await publish(2, ['remote']);
      expect(card().props.draft.tags).toEqual(['remote']);
    });

    it('keeps a reverse edit pending when an unrelated snapshot matches its value', async () => {
      const { card, patch, publish, requests } = await setup();
      await patch('rating', 3);
      await patch('rating', 2);
      await publish(2, ['remote']);
      await publish(3, ['remote']);
      await act(async () => requests[0].resolve());
      expect(card().props.draft.rating).toBe(2);
      await publish(2, ['remote']);
      await act(async () => requests[1].resolve());
      await publish(5);
      expect(card().props.draft.rating).toBe(5);
    });

    it('ignores an old failure after acknowledgment and a new edit', async () => {
      const { card, patch, publish, fail } = await setup();
      await patch('rating', 3);
      await publish(3);
      await patch('rating', 4);
      await fail(0);
      expect(card().props.draft.rating).toBe(4);
      await fail(1);
      expect(card().props.draft.rating).toBe(3);
      await publish(5);
      expect(card().props.draft.rating).toBe(5);
    });

    it('preserves rapid edits and clears while earlier mutations fail out of order', async () => {
      const { card, publish, fail, requests } = await setup();
      await act(async () => {
        const onPatch = card().props.onPatch;
        onPatch('rating', 3);
        onPatch('rating', 4);
        onPatch('rating', undefined);
      });
      expect(mockSetEpisodeState).toHaveBeenLastCalledWith({
        itemId: 'item',
        season: 1,
        episode: 1,
        clearRating: true,
      });
      await fail(1);
      await fail(0);
      expect(card().props.draft.rating).toBeUndefined();
      await publish(undefined);
      await act(async () => requests[2].resolve());
      await publish(5);
      expect(card().props.draft.rating).toBe(5);
    });

    it('keeps the latest draft through older server updates and mutation completion', async () => {
      const { card, patch, publish, requests } = await setup();
      await patch('rating', 3);
      await patch('rating', 4);
      await act(async () => requests[0].resolve());
      await publish(3);
      expect(card().props.draft.rating).toBe(4);
      await publish(4);
      await act(async () => requests[1].resolve());
      expect(card().props.draft.rating).toBe(4);
      await publish(1);
      expect(card().props.draft.rating).toBe(1);
    });

    it('releases acknowledged fields independently while another field is pending', async () => {
      const { card, patch, publish, fail, requests } = await setup();
      await patch('rating', 4);
      await patch('tags', ['favorite']);
      await publish(4);
      await act(async () => requests[0].resolve());
      await publish(3, ['external']);
      expect(card().props.draft).toEqual({ rating: 3, tags: ['favorite'] });
      await fail(1);
      expect(card().props.draft).toEqual({ rating: 3, tags: ['external'] });
      await patch('tags', ['new']);
      await publish(3, ['new']);
      await act(async () => requests[2].resolve());
      await publish(1, ['remote']);
      expect(card().props.draft).toEqual({ rating: 1, tags: ['remote'] });
    });

    it('retains drafts across season switches and reconciles on returning', async () => {
      const { view, card, patch, publish, requests } = await setup();
      mockSeasonView[2] = { season: seasonTwo, requestState: { state: 'succeeded' } };
      await patch('rating', 4);
      const user = userEvent.setup();
      savedEpisodes = [{ season: 2, episode: 1, watched: true, rating: 1, tags: [] }];
      await user.press(view.getByLabelText('Choose season, current Season 1'));
      await user.press(view.getByLabelText('Select Season 2'));
      expect(card().props.draft.rating).toBe(1);
      await user.press(view.getByLabelText('Dismiss drawer'));
      savedEpisodes = [{ season: 1, episode: 1, watched: true, rating: 2, tags: [] }];
      await user.press(view.getByLabelText('Choose season, current Season 2'));
      await user.press(view.getByLabelText('Select Season 1'));
      expect(card().props.draft.rating).toBe(4);
      await publish(4);
      await act(async () => requests[0].resolve());
      await publish(5);
      expect(card().props.draft.rating).toBe(5);
    });

    it('does not apply old route completions to a new item', async () => {
      const { view, card, patch, fail } = await setup();
      // Accepted writes report failures after their view's observers are disposed.
      const report = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      await patch('rating', 4);
      mockParams = { id: 'item-b' };
      itemView = { ...itemView, item: { ...item, _id: 'item-b' } };
      await view.rerender(screen());
      await patch('rating', 5);
      await fail(0);
      expect(card().props.draft.rating).toBe(5);
      await view.unmount();
      await fail(1);
      expect(report).toHaveBeenCalledTimes(2);
      expect(report).toHaveBeenCalledWith('Unexpected client operation failure');
    });
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
      item: { ...item, _id: 'item-b', tmdbId: 999, title: 'Item B', rating: 1.5 },
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

    expect(view.getByText('1.5')).toBeTruthy();
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
