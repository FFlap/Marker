import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ScrollView, Text } from 'react-native';
import { useAnimatedReaction, useAnimatedRef, useSharedValue } from 'react-native-reanimated';
import { NativeDraggableGrid } from '@/components/NativeDraggableGrid';

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

function LibraryRows({ data = items }: { data?: typeof items }) {
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
