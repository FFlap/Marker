import { describe, expect, it } from 'vitest';
import {
  gridItemWidth,
  listItemWidth,
  listTypography,
  stepGridColumns,
} from '../../src/lib/displayPreferences';

describe('display preferences', () => {
  it('steps through the three grid intervals and clamps at the ends', () => {
    expect(stepGridColumns(3, 'out')).toBe(4);
    expect(stepGridColumns(4, 'out')).toBe(5);
    expect(stepGridColumns(5, 'out')).toBe(5);
    expect(stepGridColumns(5, 'in')).toBe(4);
    expect(stepGridColumns(4, 'in')).toBe(3);
    expect(stepGridColumns(3, 'in')).toBe(3);
  });

  it('provides non-overflowing widths for every layout', () => {
    expect(gridItemWidth(3)).toBe('31%');
    expect(gridItemWidth(4)).toBe('22.375%');
    expect(gridItemWidth(5)).toBe('17.2%');
    expect(listItemWidth(1)).toBe('100%');
    expect(listItemWidth(2)).toBe('48.25%');
  });

  it('keeps list text options ordered and touch rows accessible', () => {
    const small = listTypography('small');
    const medium = listTypography('medium');
    const large = listTypography('large');
    expect(small.fontSize).toBeLessThan(medium.fontSize);
    expect(medium.fontSize).toBeLessThan(large.fontSize);
    expect([small, medium, large].every((option) => option.minHeight >= 44)).toBe(true);
  });
});
