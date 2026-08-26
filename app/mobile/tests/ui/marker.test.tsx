import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';

const mockReorderItem = jest.fn();
const mockMoveItemToWatched = jest.fn();
let mockQueryShouldThrow = false;
const mockUseQuery = jest.fn((ref: unknown) =>
  mockQueryShouldThrow
    ? (() => {
        throw new Error('query failed');
      })()
    : String(ref).includes('getSettings')
      ? { defaultView: 'list' }
      : items,
);

const items = [
  {
    _id: 'a',
    _creationTime: 1,
    userId: 'u',
    tmdbId: 299534,
    mediaType: 'movie',
    isAnime: false,
    title: 'Avengers: Endgame',
    releaseDate: '2019-04-24',
    status: 'watched',
    rating: 9,
    timesWatched: 1,
    tags: ['hero'],
    rank: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    _id: 'b',
    _creationTime: 1,
    userId: 'u',
    tmdbId: 61889,
    mediaType: 'tv',
    isAnime: false,
    title: 'Daredevil',
    status: 'watching',
    timesWatched: 0,
    tags: ['hero'],
    rank: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    _id: 'c',
    _creationTime: 1,
    userId: 'u',
    tmdbId: 83121,
    mediaType: 'tv',
    title: 'Kaguya-sama: Love Is War',
    status: 'watchlist',
    timesWatched: 0,
    tags: [],
    genres: ['Animation'],
    isAnime: true,
    rank: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    _id: 'd',
    _creationTime: 1,
    userId: 'u',
    tmdbId: 1422,
    mediaType: 'tv',
    isAnime: false,
    title: 'The Middle',
    status: 'watched',
    rating: 8,
    timesWatched: 1,
    tags: ['comedy'],
    rank: 2,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    _id: 'e',
    _creationTime: 1,
    userId: 'u',
    tmdbId: 203737,
    mediaType: 'tv',
    isAnime: true,
    title: 'Oshi no Ko',
    status: 'watched',
    rating: 8.5,
    timesWatched: 1,
    tags: ['anime'],
    rank: 3,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    _id: 'f',
    _creationTime: 1,
    userId: 'u',
    tmdbId: 154391,
    mediaType: 'tv',
    isAnime: true,
    title: "Shikimori's Not Just a Cutie",
    status: 'watching',
    timesWatched: 0,
    tags: ['anime'],
    rank: 2,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    _id: 'g',
    _creationTime: 1,
    userId: 'u',
    tmdbId: 1399,
    mediaType: 'tv',
    isAnime: false,
    title: 'Game of Thrones',
    status: 'dropped',
    timesWatched: 0,
    tags: ['fantasy'],
    rank: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    _id: 'h',
    _creationTime: 1,
    userId: 'u',
    tmdbId: 12225,
    mediaType: 'tv',
    title: 'Peppa Pig',
    status: 'watchlist',
    timesWatched: 0,
    tags: [],
    genres: ['Animation', 'Kids'],
    isAnime: false,
    rank: 2,
    createdAt: 1,
    updatedAt: 1,
  },
];
const mockDragEnds = new Map<
  string,
  (event: { data: typeof items; from: number; to: number }) => void
>();
jest.mock('convex/react', () => ({
  useQuery: (...args: [unknown]) => mockUseQuery(...args),
  useMutation: () => mockReorderItem,
  useAction: (ref: unknown) =>
    String(ref).includes('moveItemToWatched') ? mockMoveItemToWatched : jest.fn(),
}));
jest.mock('../../convex/_generated/api', () => ({
  api: {
    library: {
      items: { listItems: 'library/items:listItems' },
      ordering: { reorderItem: 'library/ordering:reorderItem' },
      seasonWatched: { moveItemToWatched: 'library/seasonWatched:moveItemToWatched' },
    },
    settings: { getSettings: 'settings.getSettings' },
    profiles: { me: 'profiles.me' },
  },
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-native-draggable-flatlist', () => {
  const React = require('react');
  const { ScrollView, View } = require('react-native');
  const Decorator = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  const MockDraggableList = ({
    data,
    renderItem,
    onDragEnd,
  }: {
    data: typeof items;
    renderItem: (p: unknown) => React.ReactNode;
    onDragEnd: (event: { data: typeof items; from: number; to: number }) => void;
  }) => (
    <View>
      {(() => {
        mockDragEnds.set(data.map((item) => item._id).join(','), onDragEnd);
        return null;
      })()}
      {data.map((item, index) => (
        <React.Fragment key={item._id}>
          {renderItem({ item, index, drag: jest.fn(), isActive: false, getIndex: () => index })}
        </React.Fragment>
      ))}
    </View>
  );
  return {
    __esModule: true,
    NestableDraggableFlatList: MockDraggableList,
    NestableScrollContainer: ScrollView,
    ScaleDecorator: Decorator,
    ShadowDecorator: Decorator,
    default: MockDraggableList,
  };
});
jest.mock('@/components/NativeDraggableGrid', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    NativeDraggableGrid: ({
      data,
      renderItem,
      onDragEnd,
    }: {
      data: typeof items;
      renderItem: (event: {
        item: (typeof items)[number];
        index: number;
        isActive: boolean;
      }) => React.ReactNode;
      onDragEnd: (event: { data: typeof items; from: number; to: number }) => void;
    }) => (
      <View>
        {(() => {
          mockDragEnds.set(data.map((item) => item._id).join(','), onDragEnd);
          return null;
        })()}
        {data.map((item, index) => (
          <View key={item._id} style={{ width: '31%', flexGrow: 0, flexShrink: 0 }}>
            {renderItem({ item, index, isActive: false })}
          </View>
        ))}
      </View>
    ),
  };
});
jest.mock('expo-image', () => ({ Image: require('react-native').Image }));
jest.mock('../../src/components/ui/drawer', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  const Passthrough = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  const Container = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  const Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;
  return {
    Drawer: Passthrough,
    DrawerClose: Passthrough,
    DrawerContent: Container,
    DrawerFooter: Container,
    DrawerHeader: Container,
    DrawerTitle: Label,
    DrawerTrigger: ({ children }: { children: React.ReactNode }) => children,
  };
});
import Library from '../../src/app/(tabs)/index';
import { ToastProvider } from '../../src/components/ui/Toast';

describe('Marker library', () => {
  beforeEach(() => {
    mockReorderItem.mockReset();
    mockMoveItemToWatched.mockReset();
    (jest.requireMock('expo-router').router.push as jest.Mock).mockReset();
    mockDragEnds.clear();
    mockQueryShouldThrow = false;
    mockUseQuery.mockImplementation((ref: unknown) => {
      if (mockQueryShouldThrow) throw new Error('query failed');
      if (String(ref).includes('getSettings')) return { defaultView: 'list' };
      if (String(ref).includes('profiles.me')) return { username: 'markerfan', isPublic: false };
      return items;
    });
  });
  it('shows a retry boundary when the library query throws', async () => {
    mockQueryShouldThrow = true;
    const consoleError = console.error as jest.Mock;
    const errorImplementation = consoleError.getMockImplementation();
    consoleError.mockImplementation(() => {});
    const q = await render(
      <ToastProvider>
        <Library />
      </ToastProvider>,
    );
    expect(q.getByText('Couldn’t load your library.')).toBeTruthy();
    mockQueryShouldThrow = false;
    await fireEvent.press(q.getByText('Retry'));
    expect(q.getByText('Avengers: Endgame')).toBeTruthy();
    consoleError.mockImplementation(errorImplementation);
  });
  it('renders an empty library for a newly provisioned account', async () => {
    mockUseQuery.mockImplementation((ref: unknown) => {
      if (String(ref).includes('getSettings')) return { defaultView: 'list' };
      if (String(ref).includes('profiles.me')) return { username: 'newviewer', isPublic: false };
      return [];
    });

    const q = await render(
      <ToastProvider>
        <Library />
      </ToastProvider>,
    );

    expect(q.queryByText('Couldn’t load your library.')).toBeNull();
    expect(q.getAllByText('Nothing here yet')).toHaveLength(4);
    expect(q.getByLabelText('Add title')).toBeTruthy();
  });
  const view = () =>
    render(
      <ToastProvider>
        <Library />
      </ToastProvider>,
    );
  it('renders sections in order and watched ranks', async () => {
    const q = await view();
    const text = q
      .getAllByText(/Watched|Watching|Watchlist|Dropped/)
      .map((x) => String(x.props.children));
    expect(text.slice(-4)).toEqual(['Watched', 'Watching', 'Watchlist', 'Dropped']);
    expect(q.getByText('1.')).toBeTruthy();
    expect(q.getByText('Avengers: Endgame')).toBeTruthy();
    expect(q.getByText('Game of Thrones')).toBeTruthy();
  });
  it('separates movies, TV shows, and anime without changing the stored media type', async () => {
    const q = await view();
    await fireEvent.press(q.getByLabelText('TV Shows type'));
    expect(q.queryByText('Avengers: Endgame')).toBeNull();
    expect(q.getByText('Daredevil')).toBeTruthy();
    expect(q.queryByText('Kaguya-sama: Love Is War')).toBeNull();
    await fireEvent.press(q.getByLabelText('Anime type'));
    expect(q.getByText('Kaguya-sama: Love Is War')).toBeTruthy();
    expect(q.getByText('Oshi no Ko')).toBeTruthy();
    expect(q.queryByText('Daredevil')).toBeNull();
    expect(q.queryByText('Peppa Pig')).toBeNull();
  });

  it('filters by entry status and only shows the selected status section', async () => {
    const q = await view();
    await fireEvent.press(q.getByLabelText('Watching status'));
    expect(q.getByText('Daredevil')).toBeTruthy();
    expect(q.getByText("Shikimori's Not Just a Cutie")).toBeTruthy();
    expect(q.queryByText('Avengers: Endgame')).toBeNull();
    expect(q.queryByText('Game of Thrones')).toBeNull();
    expect(q.getAllByText('Watched', { exact: true })).toHaveLength(1);
    expect(q.getAllByText('Watching', { exact: true })).toHaveLength(2);
    await fireEvent.press(q.getByLabelText('Dropped status'));
    expect(q.getByText('Game of Thrones')).toBeTruthy();
    expect(q.queryByText('Daredevil')).toBeNull();
    expect(q.getAllByText('Dropped', { exact: true })).toHaveLength(2);
  });

  it('filters rating and tags', async () => {
    const q = await view();
    await fireEvent.press(q.getByLabelText('9+ rating'));
    expect(q.getByText('Avengers: Endgame')).toBeTruthy();
    expect(q.queryByText('Oshi no Ko')).toBeNull();
    await fireEvent.press(q.getByLabelText('Any rating'));
    await fireEvent.press(q.getByLabelText('anime'));
    expect(q.getByText('Oshi no Ko')).toBeTruthy();
    expect(q.queryByText('The Middle')).toBeNull();
  });
  it('search narrows the library', async () => {
    const q = await view();
    await fireEvent.changeText(q.getByTestId('library-search'), 'Dare');
    expect(q.getByText('Daredevil')).toBeTruthy();
    expect(q.queryByText('Avengers: Endgame')).toBeNull();
  });

  it('fades, slides, and disables the add button from native scroll progress', async () => {
    const q = await view();
    const scroll = q.getByTestId('library-scroll');
    const motion = q.getByTestId('library-add-motion');
    const motionStyle = StyleSheet.flatten(motion.props.style);
    expect(motionStyle.transformOrigin).toBeUndefined();
    expect(motionStyle.opacity).toBeDefined();
    expect(motionStyle.transform).toHaveLength(2);
    await act(async () => {
      fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { y: 80 } } });
      await Promise.resolve();
    });
    expect(q.getByTestId('library-add-motion').props.pointerEvents).toBe('none');
    await act(async () => {
      fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { y: 0 } } });
      await Promise.resolve();
    });
    expect(q.getByTestId('library-add-motion').props.pointerEvents).toBe('auto');
  });

  it('opens the account drawer and navigates to the profile', async () => {
    const reduceMotionSpy = jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const q = await view();
    await waitFor(() => expect(reduceMotionSpy).toHaveBeenCalled());
    await fireEvent.press(q.getByLabelText('Open account menu'));
    expect(q.getByText('Settings')).toBeTruthy();
    expect(q.getByRole('menuitem', { name: 'Explore' })).toBeTruthy();
    expect(q.queryByRole('menuitem', { name: 'Library' })).toBeNull();
    expect(q.queryByRole('menuitem', { name: 'Episodes' })).toBeNull();
    expect(q.queryByRole('menuitem', { name: 'Tags' })).toBeNull();
    expect(q.getAllByRole('menuitem').map((item) => item.props.accessibilityLabel)).toEqual([
      'Explore',
      'Notifications',
      'Calendar',
      'Settings',
    ]);
    await fireEvent.press(q.getByLabelText('View profile'));
    await waitFor(() => {
      expect(jest.requireMock('expo-router').router.push).toHaveBeenCalledWith('/(tabs)/profile');
    });
  });

  it.each([
    ['start', ['e', 'a', 'd'], 2, 0, { itemId: 'e', afterId: 'a' }],
    ['middle', ['a', 'e', 'd'], 2, 1, { itemId: 'e', beforeId: 'a', afterId: 'd' }],
    ['end', ['d', 'e', 'a'], 0, 2, { itemId: 'a', beforeId: 'e' }],
  ])('reorders an item to the %s with exact neighbors', async (_label, ids, from, to, payload) => {
    await view();
    const onDragEnd = mockDragEnds.get('a,d,e');
    expect(onDragEnd).toBeDefined();
    await act(async () => {
      onDragEnd?.({ data: ids.map((id) => items.find((item) => item._id === id)!), from, to });
    });
    expect(mockReorderItem).toHaveBeenCalledWith(payload);
  });

  it('shows a toast when reorder fails', async () => {
    mockReorderItem.mockRejectedValueOnce(new Error('nope'));
    const q = await view();
    await act(async () => {
      mockDragEnds.get('a,d,e')?.({ data: [items[3], items[4], items[0]], from: 0, to: 2 });
    });
    expect(await q.findByText('Couldn’t save order')).toBeTruthy();
  });

  it('reorders with accessibility move actions using exact neighbors', async () => {
    const q = await view();
    await act(async () => {
      fireEvent(q.getByLabelText('The Middle'), 'accessibilityAction', {
        nativeEvent: { actionName: 'moveUp' },
      });
      await Promise.resolve();
    });
    expect(mockReorderItem).toHaveBeenCalledWith({
      itemId: 'd',
      afterId: 'a',
      beforeId: undefined,
    });

    mockReorderItem.mockClear();
    await act(async () => {
      fireEvent(q.getByLabelText('The Middle'), 'accessibilityAction', {
        nativeEvent: { actionName: 'moveDown' },
      });
      await Promise.resolve();
    });
    expect(mockReorderItem).toHaveBeenCalledWith({
      itemId: 'd',
      beforeId: 'a',
      afterId: 'e',
    });
  });

  it('confirms watched category moves and applies the watched action', async () => {
    const q = await view();
    await act(async () => {
      fireEvent(q.getByLabelText('Daredevil'), 'accessibilityAction', {
        nativeEvent: { actionName: 'moveTo:watched' },
      });
    });
    expect(q.getByText('Mark as watched?')).toBeTruthy();
    expect(q.getByText(/every episode will be marked watched/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(q.getByText('Mark watched'));
      await Promise.resolve();
    });
    expect(mockMoveItemToWatched).toHaveBeenCalledWith({
      itemId: 'b',
      beforeId: 'e',
    });
  });

  it('moves directly into non-watched categories', async () => {
    const q = await view();
    await act(async () => {
      fireEvent(q.getByLabelText('Kaguya-sama: Love Is War'), 'accessibilityAction', {
        nativeEvent: { actionName: 'moveTo:dropped' },
      });
      await Promise.resolve();
    });
    expect(mockReorderItem).toHaveBeenCalledWith({
      itemId: 'c',
      beforeId: 'g',
      status: 'dropped',
    });
  });

  it('uses the saved poster view and reorders tiles with accessibility actions', async () => {
    mockUseQuery.mockImplementation((ref: unknown) =>
      String(ref).includes('getSettings') ? { defaultView: 'posters' } : items,
    );
    const q = await view();
    const tile = q.getByLabelText('The Middle');
    expect(StyleSheet.flatten(tile.props.style)).toMatchObject({
      width: '100%',
      maxWidth: '100%',
    });
    expect(StyleSheet.flatten(tile.parent?.props.style)).toMatchObject({
      width: '31%',
      flexGrow: 0,
      flexShrink: 0,
    });
    await act(async () => {
      fireEvent(tile, 'accessibilityAction', {
        nativeEvent: { actionName: 'moveUp' },
      });
      await Promise.resolve();
    });
    expect(mockReorderItem).toHaveBeenCalledWith({
      itemId: 'd',
      afterId: 'a',
      beforeId: undefined,
    });
  });

  it('persists drag-and-drop ordering from poster view', async () => {
    mockUseQuery.mockImplementation((ref: unknown) =>
      String(ref).includes('getSettings') ? { defaultView: 'posters' } : items,
    );
    await view();
    await act(async () => {
      mockDragEnds.get('a,d,e')?.({
        data: [items[3], items[0], items[4]],
        from: 0,
        to: 1,
      });
    });
    expect(mockReorderItem).toHaveBeenCalledWith({
      itemId: 'a',
      beforeId: 'd',
      afterId: 'e',
    });
  });

  it('blocks reorder while filters are active', async () => {
    const q = await view();
    await fireEvent.press(q.getByLabelText('9+ rating'));
    expect(q.getByText(/Clear filters to reorder/)).toBeTruthy();
    await act(async () => {
      mockDragEnds.get('a')?.({ data: [items[0]], from: 0, to: 0 });
    });
    expect(mockReorderItem).not.toHaveBeenCalled();
  });
});
