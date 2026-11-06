import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ScrollView, Text } from 'react-native';
import { useAnimatedReaction, useAnimatedRef, useSharedValue } from 'react-native-reanimated';
import { NativeDraggableGrid, type NativeGridDropTarget } from '@/components/NativeDraggableGrid';

let mockGridY = 0;
let mockMeasured = false;
jest.mock('react-native', () => {
  const native = jest.requireActual('react-native');
  const React = jest.requireActual('react');
  return Object.defineProperty(Object.create(native), 'View', {
    value: React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
      React.useImperativeHandle(ref, () => ({
        measureInWindow: (callback: (...values: number[]) => void) =>
          callback(0, mockGridY, mockMeasured ? 400 : 0, 22000),
      }));
      return <native.View {...props} />;
    }),
  });
});

const items = Array.from({ length: 500 }, (_, id) => ({ id: String(id) }));
let updateOffset: (offset: number, previous: number | null) => void;

let dropTarget: NativeGridDropTarget | undefined;

function LibraryRows({
  data = items,
  sectionTop = 0,
  externalPlaceholder,
}: {
  data?: typeof items;
  sectionTop?: number;
  externalPlaceholder?: { index: number; height: number };
}) {
  const offset = useSharedValue(0);
  const scrollRef = useAnimatedRef<ScrollView>();
  return (
    <NativeDraggableGrid
      autoScroll={{
        offset,
        scrollRef,
        getBounds: () => ({ top: 0, bottom: 704 }),
        getMaxOffset: () => 22_000,
      }}
      sectionTop={sectionTop}
      externalPlaceholder={externalPlaceholder}
      onDropTarget={(target) => {
        dropTarget = target;
      }}
      columns={1}
      rowHeight={44}
      data={data}
      disabled={false}
      keyExtractor={(item) => item.id}
      onDragBegin={() => undefined}
      onDragEnd={() => undefined}
      renderItem={({ item }) => <Text>Title {item.id}</Text>}
    />
  );
}

beforeEach(() => {
  mockGridY = 0;
  mockMeasured = false;
  jest.mocked(useAnimatedReaction).mockImplementation((_prepare, react) => {
    updateOffset = react;
  });
});

it('opens a large library with a bounded number of real rows and mounts later rows on scroll', async () => {
  const view = await render(<LibraryRows />);
  expect(view.queryAllByTestId(/^native-grid-item-/)).toHaveLength(0);
  mockMeasured = true;
  await fireEvent(view.getByTestId('native-grid'), 'layout', {
    nativeEvent: { layout: { width: 400, height: 22000 } },
  });
  expect(view.getAllByTestId(/^native-grid-item-/)).toHaveLength(32);
  expect(view.getByText('Title 0')).toBeTruthy();
  expect(view.queryByText('Title 100')).toBeNull();
  for (let index = 0; index < 32; index++) {
    await fireEvent(view.getByTestId(`native-grid-item-${index}`), 'layout', {
      nativeEvent: { layout: { x: 0, y: index * 44, width: 400, height: 44 } },
    });
  }
  await act(() => updateOffset(4400, 0));
  expect(view.getByText('Title 100')).toBeTruthy();
  expect(view.queryByText('Title 0')).toBeNull();
  expect(view.getAllByTestId(/^native-grid-item-/)).toHaveLength(48);
});

it('does not mount starter rows for a section below the viewport', async () => {
  mockGridY = 22000;
  mockMeasured = true;
  const view = await render(<LibraryRows />);
  expect(view.queryAllByTestId(/^native-grid-item-/)).toHaveLength(0);
});

it('clamps the rendered rows after a large library is filtered down', async () => {
  const view = await render(<LibraryRows />);
  mockMeasured = true;
  await fireEvent(view.getByTestId('native-grid'), 'layout', {
    nativeEvent: { layout: { width: 400, height: 22000 } },
  });
  await act(() => updateOffset(4400, 0));
  await view.rerender(<LibraryRows data={items.slice(0, 5)} />);
  expect(view.getAllByTestId(/^native-grid-item-/)).toHaveLength(5);
  expect(view.getByText('Title 0')).toBeTruthy();
});

it('refreshes drop bounds when a preceding section grows without a local grid layout event', async () => {
  mockMeasured = true;
  const data = items.slice(0, 3);
  const view = await render(<LibraryRows data={data} sectionTop={0} />);
  for (let index = 0; index < data.length; index++) {
    await fireEvent(view.getByTestId(`native-grid-item-${index}`).parent!, 'layout', {
      nativeEvent: { layout: { x: 0, y: index * 44, width: 400, height: 44 } },
    });
  }
  expect(dropTarget?.(150, 66, 0)).toEqual({ index: 1, distance: 0 });
  mockGridY = 200;
  await view.rerender(<LibraryRows data={data} sectionTop={200} />);
  expect(dropTarget?.(150, 266, 0)).toEqual({ index: 1, distance: 0 });
  expect(dropTarget?.(150, 66, 0).distance).toBeGreaterThan(0);
});

it('waits for the grid origin and keeps targeting unmounted rows after auto-scrolling', async () => {
  const data = items.slice(0, 100);
  const view = await render(<LibraryRows data={data} />);
  expect(dropTarget?.(150, 66, 0).distance).toBe(Number.POSITIVE_INFINITY);
  mockMeasured = true;
  await fireEvent(view.getByTestId('native-grid'), 'layout', {
    nativeEvent: { layout: { width: 400, height: 4400 } },
  });
  expect(dropTarget?.(150, 66, 0).index).toBe(1);
  await view.rerender(<LibraryRows data={data} externalPlaceholder={{ index: 1, height: 44 }} />);
  expect(dropTarget?.(150, 66, 2640)).toEqual({ index: 61, distance: 0 });
  expect(dropTarget?.(150, 66, 5000).index).toBe(100);
  expect(dropTarget?.(150, -10, 0).index).toBe(0);
});
