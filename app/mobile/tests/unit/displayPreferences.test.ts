import { describe, expect, it } from 'vitest';
import { gridMetrics } from '../../src/lib/displayPreferences';

describe('display preferences', () => {
  it('fits every grid row on any screen width and density', () => {
    for (const pixelRatio of [2, 2.625, 2.75, 3, 3.5]) {
      for (let width = 280; width <= 880; width += 0.5) {
        for (const columns of [3, 4, 5]) {
          const { gap, itemWidth } = gridMetrics(width, columns, pixelRatio);
          const px = (value: number) => Math.round(value * pixelRatio * 1e6) / 1e6;
          expect(Number.isInteger(px(itemWidth))).toBe(true);
          expect(Number.isInteger(px(gap))).toBe(true);
          const rowPixels = px(itemWidth) * columns + px(gap) * (columns - 1);
          expect(rowPixels).toBeLessThanOrEqual(Math.floor(px(width)));
          expect(px(width) - rowPixels).toBeLessThan(columns + 1);
        }
      }
    }
  });
});
