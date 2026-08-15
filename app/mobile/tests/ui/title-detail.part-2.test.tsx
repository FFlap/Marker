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
      items: {
        getOwnedItemByTmdb: 'getOwnedItemByTmdb',
        listTagSuggestions: 'listTagSuggestions',
        addItem: 'addItem',
      },
      seasonWatched: { addItemAndMarkWatched: 'addItemAndMarkWatched' },
    },
    resolvedMetadata: {
      reads: {
        getTitleView: 'getTitleView',
        getTitleRequestState: 'getTitleRequestState',
        getSeasonView: 'getSeasonView',
        getSeasonRequestState: 'getSeasonRequestState',
      },
      touch: { touchTitle: 'touchTitle' },
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

  it('shows the invalid-route state when route parameters are missing', async () => {
    mockParams = {};
    const view = await screen();
    expect(view.getByText('Title not found')).toBeTruthy();
    expect(view.getByText('This title link is invalid.')).toBeTruthy();
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
