import { act, fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { NativeDraggableGrid } from '@/components/NativeDraggableGrid';

type GestureCallbacks = {
  onBegin: () => void;
  onStart: () => void;
  onUpdate: (event: {
    absoluteX: number;
    absoluteY: number;
    translationX: number;
    translationY: number;
  }) => void;
  onEnd: () => void;
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
    gesture.onStart();
  });
  expect(onDragBegin).toHaveBeenCalledWith({ item: 'a', index: 0 });
  await act(() =>
    gesture.onUpdate({ absoluteX: 150, absoluteY: 66, translationX: 0, translationY: 44 }),
  );
  await act(() => {
    gesture.onEnd();
    gesture.onFinalize({}, true);
  });
  expect(onDragEnd).toHaveBeenCalledWith({ data: ['b', 'a'], from: 0, to: 1 });
  onDragEnd.mockClear();
  const next = mockGestures.get('native-grid-item-a')!;
  await act(() => next.onStart());
  await act(() => next.onFinalize({}, false));
  expect(onDragCancel).toHaveBeenCalledTimes(1);
  expect(onDragEnd).not.toHaveBeenCalled();
});
