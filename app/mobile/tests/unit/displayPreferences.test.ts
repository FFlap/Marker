import { describe, expect, it } from 'vitest';
import { gridMetrics, stepGridColumns } from '../../src/lib/displayPreferences';

describe('display preferences', () => {
  it('steps through the three grid intervals and clamps at the ends', () => {
    expect(stepGridColumns(3, 'out')).toBe(4);
    expect(stepGridColumns(4, 'out')).toBe(5);
    expect(stepGridColumns(5, 'out')).toBe(5);
    expect(stepGridColumns(5, 'in')).toBe(4);
    expect(stepGridColumns(4, 'in')).toBe(3);
    expect(stepGridColumns(3, 'in')).toBe(3);
  });

  it('fits every grid row on any screen width and density', () => {
    for (const pixelRatio of [2, 2.625, 2.75, 3, 3.5]) {
      for (let width = 280; width <= 880; width += 0.5) {
        for (const columns of [3, 4, 5]) {
          const { gap, itemWidth } = gridMetrics(width, columns, pixelRatio);
          // Compare in device pixels, which is what actually renders.
          const px = (value: number) => Math.round(value * pixelRatio * 1e6) / 1e6;
          expect(Number.isInteger(px(itemWidth))).toBe(true);
          expect(Number.isInteger(px(gap))).toBe(true);
          const rowPixels = px(itemWidth) * columns + px(gap) * (columns - 1);
          expect(rowPixels).toBeLessThanOrEqual(Math.floor(px(width)));
          // …while wasting no more than about a pixel per cell.
          expect(px(width) - rowPixels).toBeLessThan(columns + 1);
        }
      }
    }
  });
});
