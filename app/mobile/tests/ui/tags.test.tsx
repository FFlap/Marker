import React from 'react';
import { act, fireEvent, render, userEvent, waitFor } from '@testing-library/react-native';

const mockReorderTag = jest.fn().mockResolvedValue(1.5);
const mockReorderItem = jest.fn().mockResolvedValue(1.5);
const mockMoveItemToWatched = jest.fn().mockResolvedValue(1.5);
const mockSetVisibility = jest.fn().mockResolvedValue('collection');
let mockRouteTag = 'Favorites';
let mockDragEnd: ((event: { from: number; to: number }) => void) | undefined;
let mockTagVisibility: { isPublic: boolean } | undefined = { isPublic: false };
const mockTagPreviews = [
  {
    tag: 'Favorites',
    count: 2,
    posters: [
      { itemId: 'a', title: 'First Movie' },
      { itemId: 'b', title: 'Second Show' },
    ],
  },
  {
    tag: 'Weekend',
    count: 3,
    posters: [
      { itemId: 'a', title: 'First Movie' },
      { itemId: 'b', title: 'Second Show' },
      { itemId: 'c', title: 'Weekend Movie' },
    ],
  },
];
const mockItems = [
  {
    _id: 'a',
    _creationTime: 1,
    userId: 'u',
    tmdbId: 1,
    mediaType: 'movie' as const,
    title: 'First Movie',
    status: 'watched' as const,
    rating: 9,
    timesWatched: 1,
    tags: ['Favorites', 'Weekend'],
    rank: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    _id: 'b',
    _creationTime: 2,
    userId: 'u',
    tmdbId: 2,
    mediaType: 'tv' as const,
    title: 'Second Show',
    status: 'watched' as const,
    timesWatched: 0,
    tags: ['Favorites', 'Weekend'],
    rank: 1,
    createdAt: 2,
    updatedAt: 2,
  },
  {
    _id: 'c',
    _creationTime: 3,
    userId: 'u',
    tmdbId: 3,
    mediaType: 'movie' as const,
    title: 'Weekend Movie',
    status: 'watchlist' as const,
    timesWatched: 0,
    tags: ['Weekend'],
    rank: 2,
    createdAt: 3,
    updatedAt: 3,
  },
];

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(() => false),
  },
  useLocalSearchParams: () => ({ tag: mockRouteTag }),
}));
jest.mock('convex/react', () => ({
  useQuery: (ref: string) => {
    if (ref === 'library/items:listItems') return mockItems;
    if (ref === 'library/items:listTagRanks') return [];
    if (ref === 'settings.getSettings') return { defaultView: 'list' };
    if (ref === 'tags.visibility') return mockTagVisibility;
    if (ref === 'profiles.me') return { username: 'tester', isPublic: false };
    return undefined;
  },
  usePaginatedQuery: () => ({
    results: mockTagPreviews,
    status: 'Exhausted',
    loadMore: jest.fn(),
  }),
  useMutation: (ref: string) => {
    if (ref === 'tags.setVisibility') return mockSetVisibility;
    if (ref === 'library/ordering:reorderItem') return mockReorderItem;
    return mockReorderTag;
  },
  useAction: () => mockMoveItemToWatched,
}));
jest.mock('../../convex/_generated/api', () => ({
  api: {
    library: {
      items: {
        listItems: 'library/items:listItems',
        listTagRanks: 'library/items:listTagRanks',
      },
      seasonWatched: { moveItemToWatched: 'library/seasonWatched:moveItemToWatched' },
      ordering: {
        reorderItem: 'library/ordering:reorderItem',
        reorderTagItem: 'library/ordering:reorderTagItem',
      },
    },
    settings: { getSettings: 'settings.getSettings' },
    tags: {
      mine: 'tags.mine',
      visibility: 'tags.visibility',
      setVisibility: 'tags.setVisibility',
    },
    profiles: { me: 'profiles.me' },
  },
}));
jest.mock('@/components/AppDrawer', () => {
  const { Pressable } = require('react-native');
  return {
    AppDrawer: () => (
      <Pressable accessibilityRole="button" accessibilityLabel="Open account menu" />
    ),
  };
});
jest.mock('react-native-draggable-flatlist', () => {
  const { View } = require('react-native');
  const Decorator = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  const MockList = ({
    data,
    renderItem,
    onDragEnd,
  }: {
    data: typeof mockItems;
    renderItem: (params: {
      item: (typeof mockItems)[number];
      drag: () => void;
      getIndex: () => number;
    }) => React.ReactNode;
    onDragEnd: (event: { data: typeof mockItems; from: number; to: number }) => void;
  }) => {
    if (data.length > 1) mockDragEnd = ({ from, to }) => onDragEnd({ data, from, to });
    return (
      <View>
        {data.map((item, index) => (
          <View key={item._id}>{renderItem({ item, drag: jest.fn(), getIndex: () => index })}</View>
        ))}
      </View>
    );
  };
  return {
    __esModule: true,
    default: MockList,
    NestableDraggableFlatList: MockList,
    NestableScrollContainer: View,
    ScaleDecorator: Decorator,
    ShadowDecorator: Decorator,
  };
});
jest.mock('@/components/ui/drawer', () => {
  const { Text, View } = require('react-native');
  const passthrough = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  const container = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  const label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  return {
    Drawer: passthrough,
    DrawerClose: passthrough,
    DrawerContent: container,
    DrawerFooter: container,
    DrawerHeader: container,
    DrawerTitle: label,
    DrawerTrigger: passthrough,
  };
});

import TagsScreen from '@/app/(tabs)/tags';
import TagDetailScreen from '@/app/tags/[tag]';

describe('Tags screens', () => {
  const mockedRouter = jest.requireMock('expo-router').router as {
    push: jest.Mock;
    replace: jest.Mock;
  };
  beforeEach(() => {
    mockRouteTag = 'Favorites';
    mockTagVisibility = { isPublic: false };
    mockDragEnd = undefined;
    mockedRouter.push.mockClear();
    mockedRouter.replace.mockClear();
    mockReorderTag.mockClear();
    mockReorderItem.mockClear();
    mockMoveItemToWatched.mockClear();
    mockSetVisibility.mockClear();
  });

  it('shows searchable tag collections without redundant counts', async () => {
    const user = userEvent.setup();
    const view = await render(<TagsScreen />);
    expect(view.getByLabelText('Open account menu')).toBeTruthy();
    expect(view.getByLabelText('Open Favorites tag')).toBeTruthy();
    expect(view.getByLabelText('Open Weekend tag')).toBeTruthy();
    expect(view.queryByText('2 titles')).toBeNull();
    await user.type(view.getByLabelText('Search your tags'), 'fav');
    expect(view.getByLabelText('Open Favorites tag')).toBeTruthy();
    expect(view.queryByLabelText('Open Weekend tag')).toBeNull();
    await user.press(view.getByLabelText('Open Favorites tag'));
    expect(mockedRouter.push).toHaveBeenCalledWith({
      pathname: '/tags/[tag]',
      params: { tag: 'Favorites' },
    });
    await user.press(view.getByRole('tab', { name: 'Tags' }));
    expect(mockedRouter.replace).not.toHaveBeenCalled();
  });

  it('searches titles and saves an independent tag reorder', async () => {
    const user = userEvent.setup();
    const view = await render(<TagDetailScreen />);
    expect(view.getByText('First Movie')).toBeTruthy();
    expect(view.getByText('Second Show')).toBeTruthy();
    await act(async () =>
      fireEvent.changeText(view.getByLabelText('Search titles in Favorites'), 'second'),
    );
    expect(view.queryByText('First Movie')).toBeNull();
    expect(view.getByText('Second Show')).toBeTruthy();
    await act(async () =>
      fireEvent.changeText(view.getByLabelText('Search titles in Favorites'), ''),
    );
    await user.press(view.getByLabelText('Filter tag titles'));
    await user.press(view.getByText('Movies'));
    expect(view.getByText('First Movie')).toBeTruthy();
    expect(view.queryByText('Second Show')).toBeNull();
    await user.press(view.getByText('Clear filters'));
    await act(async () => mockDragEnd?.({ from: 0, to: 1 }));
    expect(mockReorderTag).toHaveBeenCalledWith({
      tag: 'Favorites',
      itemId: 'a',
      beforeId: 'b',
    });
  });

  it('disables visibility choices until the saved setting loads', async () => {
    mockTagVisibility = undefined;
    const view = await render(<TagDetailScreen />);
    const publicOption = view.getByRole('radio', { name: 'Public tag' });
    const privateOption = view.getByRole('radio', { name: 'Private tag' });

    expect(publicOption.props.accessibilityState).toMatchObject({ disabled: true });
    expect(privateOption.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(privateOption);
    expect(mockSetVisibility).not.toHaveBeenCalled();
  });

  it('does not carry an optimistic order into another tag', async () => {
    mockReorderTag.mockImplementationOnce(() => new Promise(() => {}));
    const view = await render(<TagDetailScreen />);
    await act(async () => mockDragEnd?.({ from: 0, to: 1 }));
    expect(
      view
        .getAllByRole('button')
        .map((node) => node.props.accessibilityLabel)
        .filter((label) => /^\d+\./.test(label ?? '')),
    ).toEqual(['1. Second Show', '2. First Movie']);

    mockRouteTag = 'Weekend';
    await view.rerender(<TagDetailScreen />);
    expect(
      view
        .getAllByRole('button')
        .map((node) => node.props.accessibilityLabel)
        .filter((label) => /^\d+\./.test(label ?? '')),
    ).toEqual(['1. First Movie', '2. Second Show']);
  });

  it('releases a saved optimistic order so server changes remain visible', async () => {
    let finish!: () => void;
    mockReorderTag.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const view = await render(<TagDetailScreen />);
    await act(async () => mockDragEnd?.({ from: 0, to: 1 }));
    const titles = () =>
      view
        .getAllByRole('button')
        .map((node) => node.props.accessibilityLabel)
        .filter((label) => /^\d+\./.test(label ?? ''));
    expect(titles()).toEqual(['1. Second Show', '2. First Movie']);
    await act(async () => finish());
    expect(titles()).toEqual(['1. First Movie', '2. Second Show']);
  });

  it('moves a tagged title into another library status', async () => {
    const view = await render(<TagDetailScreen />);
    await act(async () => {
      fireEvent(view.getByLabelText('2. Second Show'), 'accessibilityAction', {
        nativeEvent: { actionName: 'moveTo:watching' },
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(mockReorderItem).toHaveBeenCalledWith({ itemId: 'b', status: 'watching' }),
    );
    expect(mockReorderTag).toHaveBeenCalledWith({ tag: 'Favorites', itemId: 'b' });
  });

  it('confirms a watched move and marks every episode watched', async () => {
    mockRouteTag = 'Weekend';
    const view = await render(<TagDetailScreen />);
    await act(async () => {
      fireEvent(view.getByLabelText('Weekend Movie'), 'accessibilityAction', {
        nativeEvent: { actionName: 'moveTo:watched' },
      });
    });
    expect(view.getByText('Mark as watched?')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText('Mark watched'));
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(mockMoveItemToWatched).toHaveBeenCalledWith({ itemId: 'c', beforeId: 'b' }),
    );
    expect(mockReorderTag).toHaveBeenCalledWith({
      tag: 'Weekend',
      itemId: 'c',
      beforeId: 'b',
    });
  });

  it('publishes a personal tag from the visibility menu', async () => {
    const view = await render(<TagDetailScreen />);
    fireEvent.press(view.getByLabelText('Tag visibility'));
    await act(async () => fireEvent.press(view.getByLabelText('Public tag')));
    expect(mockSetVisibility).toHaveBeenCalledWith({
      tag: 'Favorites',
      isPublic: true,
    });
  });

  it('opens the bulk library picker from a personal tag', async () => {
    const view = await render(<TagDetailScreen />);
    await userEvent.setup().press(view.getByLabelText('Add titles to Favorites'));
    expect(mockedRouter.push).toHaveBeenCalledWith({
      pathname: '/tags/add/[tag]',
      params: { tag: 'Favorites' },
    });
  });
});
