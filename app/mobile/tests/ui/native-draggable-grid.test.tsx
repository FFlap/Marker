import { render, fireEvent } from '@testing-library/react-native';
import { Text } from 'react-native';
import type { NativeGridDropTarget } from '@/components/NativeDraggableGrid';
import {
  NativeDraggableGrid,
  moveGridItem,
  nearestGridSlot,
  nativeGridAutoScrollVelocity,
  nativeRowWindow,
} from '@/components/NativeDraggableGrid';

const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('NativeDraggableGrid', () => {
  it('moves one poster into an adjacent slot without grouping the row', () => {
    expect(moveGridItem(items, 0, 1).map((item) => item.id)).toEqual(['b', 'a', 'c']);
    expect(moveGridItem(items, 2, 1).map((item) => item.id)).toEqual(['a', 'c', 'b']);
  });

  it('chooses the nearest two-dimensional poster slot', () => {
    const layouts = new Map([
      [0, { x: 0, y: 0, width: 100, height: 150 }],
      [1, { x: 120, y: 0, width: 100, height: 150 }],
      [2, { x: 0, y: 170, width: 100, height: 150 }],
    ]);

    expect(nearestGridSlot(layouts, { x: 170, y: 75 }, 0)).toBe(1);
    expect(nearestGridSlot(layouts, { x: 50, y: 245 }, 0)).toBe(2);
  });

  it('scrolls toward screen edges and rests in the center', () => {
    const bounds = { top: 100, bottom: 700 };
    expect(nativeGridAutoScrollVelocity(100, bounds)).toBeLessThan(0);
    expect(nativeGridAutoScrollVelocity(400, bounds)).toBe(0);
    expect(nativeGridAutoScrollVelocity(700, bounds)).toBeGreaterThan(0);
  });

  it('keeps the viewport and nearby rows mounted while omitting distant sections', () => {
    expect(nativeRowWindow(500, 44, 0, 704)).toEqual({ start: 0, end: 32 });
    expect(nativeRowWindow(500, 44, 4400, 5104)).toEqual({ start: 84, end: 132 });
    expect(nativeRowWindow(500, 44, -22000, -21296)).toEqual({ start: 0, end: 0 });
    expect(nativeRowWindow(500, 44, 23000, 23704)).toEqual({ start: 500, end: 500 });
  });
});

describe('cross-section grid targets', () => {
  it('opens the hovered slot and exposes an append position beyond the last row', async () => {
    let target: NativeGridDropTarget | undefined;
    const props = {
      data: items,
      disabled: false,
      columns: 1,
      keyExtractor: (item: { id: string }) => item.id,
      onDragBegin: jest.fn(),
      onDragEnd: jest.fn(),
      onDropTarget: (next: typeof target) => {
        target = next;
      },
      renderItem: ({ item }: { item: { id: string } }) => <Text>{item.id}</Text>,
    };
    const view = await render(<NativeDraggableGrid {...props} />);
    for (let index = 0; index < items.length; index++) {
      await fireEvent(view.getByTestId(`native-grid-item-${items[index].id}`).parent!, 'layout', {
        nativeEvent: { layout: { x: 0, y: index * 50, width: 300, height: 50 } },
      });
    }
    expect(target?.(150, 75, 0).index).toBe(1);
    expect(target?.(150, 151, 0).index).toBe(3);
    await view.rerender(
      <NativeDraggableGrid {...props} externalPlaceholder={{ index: 1, height: 50 }} />,
    );
    expect(view.getByTestId('native-grid-drop-placeholder')).toBeTruthy();
    expect(target?.(150, 75, 0).index).toBe(1);
  });
});

it('targets the extra poster row created by a cross-section placeholder', async () => {
  let target: NativeGridDropTarget | undefined;
  const data = [...items, { id: 'd' }];
  const props = {
    data,
    disabled: false,
    columns: 2,
    keyExtractor: (item: { id: string }) => item.id,
    onDragBegin: jest.fn(),
    onDragEnd: jest.fn(),
    onDropTarget: (next: NativeGridDropTarget | undefined) => {
      target = next;
    },
    renderItem: ({ item }: { item: { id: string } }) => <Text>{item.id}</Text>,
  };
  const view = await render(<NativeDraggableGrid {...props} />);
  const layoutCards = async (shift: number) => {
    for (let index = 0; index < data.length; index++) {
      const slot = index + shift;
      await fireEvent(view.getByTestId(`native-grid-item-${data[index].id}`).parent!, 'layout', {
        nativeEvent: {
          layout: { x: (slot % 2) * 120, y: Math.floor(slot / 2) * 170, width: 100, height: 150 },
        },
      });
    }
  };
  await layoutCards(0);
  expect(target?.(50, 75, 0).index).toBe(0);
  await view.rerender(
    <NativeDraggableGrid {...props} externalPlaceholder={{ index: 0, height: 150 }} />,
  );
  await fireEvent(view.getByTestId('native-grid-drop-placeholder'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 100, height: 150 } },
  });
  await layoutCards(1);
  expect(target?.(50, 75, 0).index).toBe(0);
  expect(target?.(230, 245, 0).index).toBe(3);
  expect(target?.(50, 415, 0)).toEqual({ index: 4, distance: 0 });
});
