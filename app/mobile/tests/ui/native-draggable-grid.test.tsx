import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import {
  moveGridItem,
  NativeDraggableGrid,
  nearestGridSlot,
  nativeGridAutoScrollVelocity,
} from '@/components/NativeDraggableGrid';

const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('NativeDraggableGrid', () => {
  it('renders every poster as its own draggable grid cell', async () => {
    const view = await render(
      <NativeDraggableGrid
        data={items}
        disabled={false}
        itemWidth="31%"
        keyExtractor={(item) => item.id}
        onDragBegin={jest.fn()}
        onDragEnd={jest.fn()}
        renderItem={({ item }) => <Text>{item.id}</Text>}
      />,
    );

    expect(view.getByTestId('native-grid-item-a')).toBeTruthy();
    expect(view.getByTestId('native-grid-item-b')).toBeTruthy();
    expect(view.getByTestId('native-grid-item-c')).toBeTruthy();
  });

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
});
