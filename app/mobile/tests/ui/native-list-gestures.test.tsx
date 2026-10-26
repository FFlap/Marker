import { useEffect, useState } from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { NativeDraggableGrid, type NativeGridAutoScroll } from '@/components/NativeDraggableGrid';

type GestureCallbacks = {
  onBegin: () => void;
  onStart: (event: { absoluteX: number; absoluteY: number }) => void;
  onUpdate: (event: {
    absoluteX: number;
    absoluteY: number;
    translationX: number;
    translationY: number;
  }) => void;
  onEnd: (event: { absoluteX: number; absoluteY: number }, success: boolean) => void;
  onFinalize: (event: unknown, success: boolean) => void;
  enabled: boolean;
  activateAfterLongPress: number;
};
const mockGestures = new Map<string, GestureCallbacks>();
jest.mock('react-native-gesture-handler', () => ({
  Gesture: {
    Pan: () => {
      const config = {};
      const builder = new Proxy(
        {},
        {
          get: (_, key) =>
            key === 'config'
              ? config
              : (value: unknown) => {
                  Object.assign(config, { [key]: value });
                  return builder;
                },
        },
      );
      return builder;
    },
  },
  GestureDetector: ({
    gesture,
    children,
  }: {
    gesture: { config: GestureCallbacks };
    children: React.ReactElement<{ testID: string }>;
  }) => {
    mockGestures.set(children.props.testID, gesture.config);
    return children;
  },
}));
beforeEach(() => mockGestures.clear());
it.each([1, 2])(
  'keeps a pre-hold scroll out of reorder mode in a %i-column list',
  async (columns) => {
    const onDragBegin = jest.fn();
    const onDragEnd = jest.fn();
    const onDragCancel = jest.fn();
    await render(
      <NativeDraggableGrid
        columns={columns}
        data={['a', 'b']}
        disabled={false}
        keyExtractor={(item) => item}
        onDragBegin={onDragBegin}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
        renderItem={({ item }) => <Text testID={`rendered-title-${item}`}>{item}</Text>}
      />,
    );
    const gesture = mockGestures.get('native-grid-item-a')!;
    // Native movement before the hold fails recognition. Contact alone must not
    // disable parent scrolling or persist a reorder.
    expect(gesture.activateAfterLongPress).toBe(260);
    await act(() => {
      gesture.onBegin();
      gesture.onFinalize({}, false);
    });
    expect(onDragBegin).not.toHaveBeenCalled();
    expect(onDragEnd).not.toHaveBeenCalled();
    expect(onDragCancel).not.toHaveBeenCalled();
  },
);
it('reorders after activation and clears an interrupted drag without saving it', async () => {
  const onDragBegin = jest.fn();
  const onDragEnd = jest.fn();
  const onDragCancel = jest.fn();
  const screen = await render(
    <NativeDraggableGrid
      columns={1}
      data={['a', 'b']}
      disabled={false}
      keyExtractor={(item) => item}
      onDragBegin={onDragBegin}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
      renderItem={({ item }) => <Text testID={`rendered-title-${item}`}>{item}</Text>}
    />,
  );
  for (const [index, item] of ['a', 'b'].entries()) {
    await fireEvent(screen.getByTestId(`native-grid-item-${item}`), 'layout', {
      nativeEvent: { layout: { x: 0, y: index * 44, width: 300, height: 44 } },
    });
  }
  const gesture = mockGestures.get('native-grid-item-a')!;
  await act(() => {
    gesture.onBegin();
    gesture.onStart({ absoluteX: 150, absoluteY: 22 });
  });
  expect(onDragBegin).toHaveBeenCalledWith({ item: 'a', index: 0 });
  await act(() =>
    gesture.onUpdate({ absoluteX: 150, absoluteY: 66, translationX: 0, translationY: 44 }),
  );
  await act(() => {
    gesture.onEnd({ absoluteX: 150, absoluteY: 66 }, true);
    gesture.onFinalize({}, true);
  });
  expect(onDragEnd).toHaveBeenCalledWith({ data: ['b', 'a'], from: 0, to: 1 });
  onDragEnd.mockClear();
  const next = mockGestures.get('native-grid-item-a')!;
  await act(() => next.onStart({ absoluteX: 150, absoluteY: 22 }));
  await act(() => {
    next.onEnd({ absoluteX: 150, absoluteY: 66 }, false);
    next.onFinalize({}, false);
  });
  expect(onDragCancel).toHaveBeenCalledTimes(1);
  expect(onDragEnd).not.toHaveBeenCalled();
});

it.each([1, 3])(
  'scrolls a held drag through a large %i-column library without waiting for scroll events',
  async (columns) => {
    let frame: (info: Reanimated.FrameInfo) => void = () => {};
    const frameControl = { setActive: jest.fn(), isActive: false, callbackId: 1 };
    const frameSpy = jest.spyOn(Reanimated, 'useFrameCallback').mockImplementation((callback) => {
      frame = callback;
      return frameControl;
    });
    const scrollTo = Reanimated.scrollTo as jest.Mock;
    scrollTo.mockClear();
    const autoScroll = {
      getBounds: () => ({ top: 100, bottom: 700 }),
      getMaxOffset: () => 3000,
      offset: { value: 0 },
      scrollRef: jest.fn(),
    } as unknown as NativeGridAutoScroll;
    const onDragEnd = jest.fn();
    const onDragCancel = jest.fn();
    const onDragMove = jest.fn();
    const data = Array.from({ length: 180 }, (_, index) => String(index));
    try {
      const screen = await render(
        <NativeDraggableGrid
          autoScroll={autoScroll}
          columns={columns}
          data={data}
          disabled={false}
          keyExtractor={(item) => item}
          onDragBegin={jest.fn()}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
          onDragMove={onDragMove}
          renderItem={({ item }) => <Text testID={`rendered-title-${item}`}>{item}</Text>}
        />,
      );
      for (const [index, item] of data.entries()) {
        await fireEvent(screen.getByTestId(`native-grid-item-${item}`), 'layout', {
          nativeEvent: {
            layout: {
              x: (index % columns) * 100,
              y: 100 + Math.floor(index / columns) * 100,
              width: 100,
              height: 100,
            },
          },
        });
      }
      const gesture = mockGestures.get('native-grid-item-0')!;
      const move = (y: number) =>
        gesture.onUpdate({ absoluteX: 50, absoluteY: y, translationX: 0, translationY: y - 150 });
      const tick = (count: number) => {
        for (let index = 0; index < count; index++)
          frame({
            timestamp: index * 16,
            timeSincePreviousFrame: 16,
            timeSinceFirstFrame: index * 16,
          });
      };
      await act(() => {
        gesture.onStart({ absoluteX: 50, absoluteY: 150 });
        move(700);
      });
      expect(frameControl.setActive).toHaveBeenLastCalledWith(true);
      await act(() => tick(180));
      // No new pointer events or native scroll acknowledgements during the hold.
      expect(autoScroll.offset.value).toBe(0);
      expect(scrollTo).toHaveBeenLastCalledWith(
        autoScroll.scrollRef,
        0,
        expect.closeTo(2188.8),
        false,
      );
      expect(onDragMove).toHaveBeenLastCalledWith({
        absoluteX: 50,
        absoluteY: 700,
        scrollOffset: expect.closeTo(2188.8),
      });
      // Moving through slots keeps exactly one mounted card for each title.
      expect(
        screen
          .getAllByTestId(/^native-grid-item-/)
          .map((cell) => cell.props.testID)
          .sort(),
      ).toEqual(data.map((item) => `native-grid-item-${item}`).sort());
      expect(
        screen.getAllByTestId(/^rendered-title-/, { includeHiddenElements: true }),
      ).toHaveLength(data.length);

      await act(() => move(400));
      scrollTo.mockClear();
      await act(() => tick(5));
      expect(scrollTo).not.toHaveBeenCalled();
      await act(() => move(100));
      await act(() => tick(10));
      expect(scrollTo).toHaveBeenLastCalledWith(
        autoScroll.scrollRef,
        0,
        expect.closeTo(2067.2),
        false,
      );

      await act(() => move(700));
      await act(() => tick(100));
      expect(scrollTo).toHaveBeenLastCalledWith(autoScroll.scrollRef, 0, 3000, false);
      scrollTo.mockClear();
      await act(() => tick(5));
      expect(scrollTo).not.toHaveBeenCalled();
      await act(() => gesture.onEnd({ absoluteX: 50, absoluteY: 400 }, true));
      expect(onDragEnd).toHaveBeenCalledWith({
        data: expect.any(Array),
        from: 0,
        to: 32 * columns,
      });
      expect(onDragEnd.mock.calls[0][0].data[32 * columns]).toBe('0');
      expect(frameControl.setActive).toHaveBeenLastCalledWith(false);
      await act(() => tick(5));
      expect(scrollTo).not.toHaveBeenCalled();

      await act(() => {
        gesture.onStart({ absoluteX: 50, absoluteY: 150 });
        move(700);
      });
      await act(() => tick(5));
      await act(() => {
        gesture.onEnd({ absoluteX: 50, absoluteY: 700 }, false);
        gesture.onFinalize({}, false);
      });
      scrollTo.mockClear();
      await act(() => tick(5));
      expect(scrollTo).not.toHaveBeenCalled();
      expect(onDragCancel).toHaveBeenCalledTimes(1);
      expect(onDragEnd).toHaveBeenCalledTimes(1);
    } finally {
      frameSpy.mockRestore();
    }
  },
);

it('keeps edge scrolling registered across screen renders and uses the latest move handler', async () => {
  let frame: (info: Reanimated.FrameInfo) => void = () => {};
  const frameControl = { setActive: jest.fn(), isActive: false, callbackId: 1 };
  const frameSpy = jest.spyOn(Reanimated, 'useFrameCallback').mockImplementation((callback) => {
    frame = callback;
    return frameControl;
  });
  const autoScroll = {
    getBounds: () => ({ top: 0, bottom: 600 }),
    getMaxOffset: () => 3000,
    offset: { value: 0 },
    scrollRef: jest.fn(),
  } as unknown as NativeGridAutoScroll;
  const firstMove = jest.fn();
  const latestMove = jest.fn();
  const grid = (onDragMove: typeof firstMove) => (
    <NativeDraggableGrid
      autoScroll={autoScroll}
      columns={1}
      data={['a', 'b']}
      disabled={false}
      keyExtractor={(item) => item}
      onDragBegin={() => {}}
      onDragEnd={() => {}}
      onDragMove={onDragMove}
      renderItem={({ item }) => <Text>{item}</Text>}
    />
  );
  try {
    const screen = await render(grid(firstMove));
    const initialFrame = frame;
    await act(() =>
      mockGestures.get('native-grid-item-a')!.onStart({ absoluteX: 50, absoluteY: 600 }),
    );
    await screen.rerender(grid(latestMove));
    expect(frame).toBe(initialFrame);
    await act(() => frame({ timestamp: 16, timeSincePreviousFrame: 16, timeSinceFirstFrame: 16 }));
    expect(latestMove).toHaveBeenCalledWith({
      absoluteX: 50,
      absoluteY: 600,
      scrollOffset: 12.16,
    });
    expect(firstMove).not.toHaveBeenCalled();
  } finally {
    frameSpy.mockRestore();
  }
});

it.each([1, 3])('keeps a single card per title through a %i-column drop', async (columns) => {
  let previewLoaded: (() => void) | undefined;
  function Grid() {
    const [data, setData] = useState(['a', 'b', 'c']);
    return (
      <NativeDraggableGrid
        columns={columns}
        data={data}
        disabled={false}
        keyExtractor={(item) => item}
        onDragBegin={() => {}}
        onMotionInit={(motion) => {
          previewLoaded = motion.onPreviewReady;
        }}
        onDragEnd={({ data: next }) => setData(next)}
        renderItem={({ item }) => <Text testID={`card-${item}`}>{item}</Text>}
      />
    );
  }
  const screen = await render(<Grid />);
  expect(previewLoaded).toBeUndefined();
  for (const [index, item] of ['a', 'b', 'c'].entries()) {
    await fireEvent(screen.getByTestId(`native-grid-item-${item}`), 'layout', {
      nativeEvent: {
        layout: {
          x: (index % columns) * 100,
          y: Math.floor(index / columns) * 100,
          width: 100,
          height: 100,
        },
      },
    });
  }
  const order = () => screen.getAllByTestId(/^native-grid-item-/).map((cell) => cell.props.testID);
  const gesture = mockGestures.get('native-grid-item-a')!;
  await act(() => gesture.onStart({ absoluteX: 50, absoluteY: 50 }));
  expect(previewLoaded).toEqual(expect.any(Function));
  const end = columns === 1 ? { absoluteX: 50, absoluteY: 250 } : { absoluteX: 250, absoluteY: 50 };
  await act(() =>
    gesture.onUpdate({
      ...end,
      translationX: end.absoluteX - 50,
      translationY: end.absoluteY - 50,
    }),
  );
  // A slow-loading floating preview must not hide or relocate the loaded source.
  expect(order()).toEqual(['native-grid-item-a', 'native-grid-item-b', 'native-grid-item-c']);
  expect(screen.getByTestId('native-grid-item-a').props.style.at(-1)).toBe(false);
  await act(() => previewLoaded!());
  const finalOrder = ['native-grid-item-b', 'native-grid-item-c', 'native-grid-item-a'];
  expect(order()).toEqual(finalOrder);
  expect(
    screen.getByTestId('native-grid-item-a', { includeHiddenElements: true }).props.style.at(-1),
  ).toEqual({ opacity: 0 });
  expect(screen.getAllByTestId(/^card-/, { includeHiddenElements: true })).toHaveLength(3);
  await act(() => {
    gesture.onEnd(end, true);
    gesture.onFinalize({}, true);
  });
  expect(order()).toEqual(finalOrder);
  expect(screen.getByTestId('native-grid-item-a').props.style.at(-1)).toBe(false);
  expect(screen.getAllByTestId(/^card-/, { includeHiddenElements: true })).toHaveLength(3);
});

it('preserves loaded card instances across repeated drags and cancellation', async () => {
  const mount = jest.fn();
  const unmount = jest.fn();
  function Card({ item }: { item: string }) {
    useEffect(() => {
      mount(item);
      return () => unmount(item);
    }, [item]);
    return <Text>{item}</Text>;
  }
  function Grid() {
    const [data, setData] = useState(['a', 'b']);
    return (
      <NativeDraggableGrid
        columns={1}
        data={data}
        disabled={false}
        keyExtractor={(item) => item}
        onDragBegin={() => {}}
        onDragEnd={({ data: next }) => setData(next)}
        renderItem={({ item }) => <Card item={item} />}
      />
    );
  }
  const screen = await render(<Grid />);
  expect(mount).toHaveBeenCalledTimes(2);
  for (const success of [true, false, true]) {
    const cells = screen.getAllByTestId(/^native-grid-item-/);
    for (const [index, cell] of cells.entries()) {
      await fireEvent(cell, 'layout', {
        nativeEvent: { layout: { x: 0, y: index * 100, width: 100, height: 100 } },
      });
    }
    const gesture = mockGestures.get(cells[0].props.testID)!;
    await act(() => gesture.onStart({ absoluteX: 50, absoluteY: 50 }));
    await act(() => {
      gesture.onUpdate({ absoluteX: 50, absoluteY: 150, translationX: 0, translationY: 100 });
      gesture.onEnd({ absoluteX: 50, absoluteY: 150 }, success);
      gesture.onFinalize({}, success);
    });
    expect(mount).toHaveBeenCalledTimes(2);
    expect(unmount).not.toHaveBeenCalled();
  }
});
