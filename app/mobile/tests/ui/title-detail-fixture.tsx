import React from 'react';
import { render } from '@testing-library/react-native';

export const mockState = {
  titleView: undefined as any,
  mockSeasonView: undefined as any,
  library: [] as any[],
  mockParams: undefined as any,
  mockLoadedSeasonPages: {} as Record<number, number>,
};

const mockTouchTitle = jest.fn().mockResolvedValue(undefined);
const mockAddItem = jest.fn().mockResolvedValue('new-item');
const mockAddItemAndMarkWatched = jest.fn().mockResolvedValue('new-item');
const mockLoadMore = jest.fn();
const episodeData = (view: ReturnType<typeof render>) => {
  let node: any = view.getByTestId('episode-list');
  while (node && !Array.isArray(node.props?.data)) node = node.parent;
  return node?.props.data as unknown[] | undefined;
};

const mockUseQuery = jest.fn((ref: string, args?: any) => {
  if (ref === 'getOwnedItemByTmdb')
    return (
      mockState.library.find(
        (item) => item.tmdbId === args?.tmdbId && item.mediaType === args?.mediaType,
      ) ?? null
    );
  if (ref === 'listTagSuggestions')
    return args === 'skip'
      ? undefined
      : [...new Set(mockState.library.flatMap((item) => item.tags ?? []))];
  if (ref === 'getTitleView')
    return mockState.titleView === undefined ? undefined : { title: mockState.titleView.title };
  if (ref === 'getTitleRequestState') return mockState.titleView?.requestState;
  if (ref === 'getSeasonRequestState')
    return mockState.mockSeasonView?.[args?.season]?.requestState;
  return undefined;
});
jest.mock('convex/react', () => ({
  useQuery: (...args: any[]) => mockUseQuery(...args),
  usePaginatedQuery: (_ref: string, args: any) => {
    if (args === 'skip') return { results: [], status: 'LoadingFirstPage', loadMore: mockLoadMore };
    const value = mockState.mockSeasonView?.[args?.season];
    if (value == null) return { results: [], status: 'LoadingFirstPage', loadMore: mockLoadMore };
    const row = value.season;
    const pageCount = mockState.mockLoadedSeasonPages[args.season] ?? 1;
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
        mockState.mockLoadedSeasonPages[args.season] = pageCount + count;
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
  useLocalSearchParams: () => mockState.mockParams,
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

beforeEach(() => {
  mockState.mockParams = {
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
  mockState.titleView = {
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
  mockState.mockSeasonView = {
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
  mockState.library = [];
  mockState.mockLoadedSeasonPages = {};
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

export {
  mockTouchTitle,
  mockAddItem,
  mockAddItemAndMarkWatched,
  mockLoadMore,
  episodeData,
  screen,
  TitleDetail,
  ToastProvider,
};
