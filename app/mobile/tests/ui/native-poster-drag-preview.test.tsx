import { clampNativePosterTop } from '@/components/NativePosterDragPreview';

describe('NativePosterDragPreview', () => {
  it('keeps the carried poster below the header and above the bottom boundary', () => {
    const bounds = { top: 60, bottom: 700 };
    expect(clampNativePosterTop(-100, 190, bounds)).toBe(60);
    expect(clampNativePosterTop(300, 190, bounds)).toBe(300);
    expect(clampNativePosterTop(650, 190, bounds)).toBe(510);
    expect(clampNativePosterTop(-100, 190, bounds, 1.025)).toBeCloseTo(62.375);
  });
});
