import React from 'react';
import { Animated } from 'react-native';
import { render } from '@testing-library/react-native';

let mockReducedMotion = false;
jest.mock('../../src/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mockReducedMotion,
}));

import { SkeletonShimmer, SkeletonShimmerGroup } from '../../src/components/SkeletonShimmer';
import { LibraryPageSkeleton } from '../../src/components/PageSkeletons';

const start = jest.fn();
const stop = jest.fn();
let loop: jest.SpyInstance;

beforeEach(() => {
  mockReducedMotion = false;
  start.mockClear();
  stop.mockClear();
  loop = jest.spyOn(Animated, 'loop').mockReturnValue({ start, stop, reset: jest.fn() });
});
afterEach(() => loop.mockRestore());

it('runs one animation for the library loading screen and stops it on unmount', async () => {
  const view = await render(<LibraryPageSkeleton list />);
  expect(view.getByLabelText('Loading library')).toBeTruthy();
  expect(loop).toHaveBeenCalledTimes(1);
  expect(start).toHaveBeenCalledTimes(1);
  await view.unmount();
  expect(stop).toHaveBeenCalledTimes(1);
});

it('removes all grouped shimmer bands when reduced motion is enabled', async () => {
  const scene = () => (
    <SkeletonShimmerGroup>
      <SkeletonShimmer />
      <SkeletonShimmer />
    </SkeletonShimmerGroup>
  );
  const view = await render(scene());
  expect(view.toJSON()).not.toBeNull();
  mockReducedMotion = true;
  await view.rerender(scene());
  expect(view.toJSON()).toBeNull();
  expect(stop).toHaveBeenCalledTimes(1);
  expect(start).toHaveBeenCalledTimes(1);
});

it('still animates standalone placeholders without a group', async () => {
  const view = await render(<SkeletonShimmer />);
  expect(view.toJSON()).not.toBeNull();
  expect(start).toHaveBeenCalledTimes(1);
  await view.unmount();
  expect(stop).toHaveBeenCalledTimes(1);
});
