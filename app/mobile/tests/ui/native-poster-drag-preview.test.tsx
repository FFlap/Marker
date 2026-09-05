import React from 'react';
import { render } from '@testing-library/react-native';
import {
  clampNativePosterTop,
  NativePosterDragPreview,
  type NativePosterDragMotion,
} from '@/components/NativePosterDragPreview';

describe('NativePosterDragPreview', () => {
  it('carries the poster title and optional rank with the active touch', async () => {
    const motion = {
      horizontalTranslate: { value: 36 },
      isTouchActiveNative: { value: true },
      touchTranslate: { value: 48 },
    } as NativePosterDragMotion;
    const view = await render(
      <NativePosterDragPreview
        bounds={{ top: 60, bottom: 700 }}
        layout={{ height: 190, left: 20, top: 80, width: 110, rank: 2 }}
        motion={motion}
        title="The Carried Title"
      />,
    );

    expect(view.getByText(/2\./, { includeHiddenElements: true })).toBeTruthy();
    expect(view.getByText(/The Carried Title/, { includeHiddenElements: true })).toBeTruthy();
  });

  it('keeps the carried poster below the header and above the bottom boundary', () => {
    const bounds = { top: 60, bottom: 700 };
    expect(clampNativePosterTop(-100, 190, bounds)).toBe(60);
    expect(clampNativePosterTop(300, 190, bounds)).toBe(300);
    expect(clampNativePosterTop(650, 190, bounds)).toBe(510);
    expect(clampNativePosterTop(-100, 190, bounds, 1.025)).toBeCloseTo(62.375);
  });
});
