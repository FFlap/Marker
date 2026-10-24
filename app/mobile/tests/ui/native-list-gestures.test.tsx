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
        renderItem={({ item }) => <Text>{item}</Text>}
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
      renderItem={({ item }) => <Text>{item}</Text>}
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
          renderItem={({ item }) => <Text>{item}</Text>}
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
      // Scrolling must not continuously reorder/reflow the native cell tree.
      expect(screen.getAllByTestId(/^native-grid-item-/).map((cell) => cell.props.testID)).toEqual(
        data.map((item) => `native-grid-item-${item}`),
      );

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
