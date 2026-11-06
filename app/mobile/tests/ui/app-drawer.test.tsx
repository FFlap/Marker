import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import {
  Animated,
  PanResponder,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';

jest.mock('../../src/hooks/use-reduced-motion', () => ({ useReducedMotion: () => true }));

let mockProfile: { username: string } | null | undefined;
jest.mock('convex/react', () => ({
  useQuery: (_ref: unknown, args: unknown) => (args === 'skip' ? undefined : mockProfile),
}));
jest.mock('@marker/shared/api', () => ({ api: { profiles: { me: 'profiles.me' } } }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-image', () => ({ Image: require('react-native').Image }));

import { AppDrawer, type AppDrawerHandle } from '../../src/components/AppDrawer';
import { AccountLoadingContext } from '../../src/hooks/useAccountLoading';
import { router } from 'expo-router';

let timingSpy: jest.SpiedFunction<typeof Animated.timing>;
let responderSpy: jest.SpiedFunction<typeof PanResponder.create>;

it.each([
  { profileReady: false, profile: { username: 'marker' } },
  { profileReady: true, profile: undefined },
  { profileReady: true, profile: null },
])('blocks edge-swipe opening until a profile is ready (%p)', async ({ profileReady, profile }) => {
  mockProfile = profile;
  const ref = React.createRef<AppDrawerHandle>();
  const view = await render(
    <AccountLoadingContext value={{ profileReady, libraryReady: false }}>
      <AppDrawer ref={ref} />
    </AccountLoadingContext>,
  );
  expect(view.getByRole('button', { name: 'Open account menu' })).toBeDisabled();

  // The library's edge-swipe gesture calls this imperative entry point.
  await act(() => ref.current?.open());
  expect(view.queryByTestId('account-menu-panel')).toBeNull();

  mockProfile = { username: 'marker' };
  await view.rerender(
    <AccountLoadingContext value={{ profileReady: true, libraryReady: true }}>
      <AppDrawer ref={ref} />
    </AccountLoadingContext>,
  );
  await act(() => ref.current?.open());
  expect(view.getByRole('menuitem', { name: 'Explore' })).toBeTruthy();
});

// Exercise the responder callbacks with real Animated values so the tests check
// finger tracking as well as the final open/closed state.
async function openDraggableDrawer() {
  mockProfile = { username: 'marker' };
  const ref = React.createRef<AppDrawerHandle>();
  const view = await render(
    <AccountLoadingContext value={{ profileReady: true, libraryReady: true }}>
      <AppDrawer ref={ref} />
    </AccountLoadingContext>,
  );
  await act(() => ref.current?.open());
  const handlers = responderSpy.mock.calls[responderSpy.mock.calls.length - 1][0];
  const event = {} as GestureResponderEvent;
  const gesture = (dx: number, dy = 0, vx = 0) =>
    ({ dx, dy, vx, numberActiveTouches: 1 }) as PanResponderGestureState;
  return { view, handlers, event, gesture };
}

beforeEach(() => {
  responderSpy = jest.spyOn(PanResponder, 'create');
  timingSpy = jest.spyOn(Animated, 'timing').mockImplementation((value, config) => ({
    start: (callback) => {
      value.setValue(config.toValue as number);
      callback?.({ finished: true });
    },
    stop: jest.fn(),
    reset: jest.fn(),
  }));
});

afterEach(() => {
  timingSpy.mockRestore();
  responderSpy.mockRestore();
});

it('tracks a horizontal drag, clamps at the open position, and restores a short drag', async () => {
  const { view, handlers, event, gesture } = await openDraggableDrawer();
  expect(handlers.onMoveShouldSetPanResponder?.(event, gesture(-30))).toBe(true);
  expect(handlers.onMoveShouldSetPanResponder?.(event, gesture(0, 30))).toBe(false);
  expect(handlers.onMoveShouldSetPanResponder?.(event, gesture(-30, 60))).toBe(false);
  expect(handlers.onMoveShouldSetPanResponder?.(event, gesture(0))).toBe(false);

  await act(() => handlers.onPanResponderGrant?.(event, gesture(0)));
  await act(() => handlers.onPanResponderMove?.(event, gesture(-40)));
  expect(view.getByTestId('account-menu-panel')).toHaveStyle({ transform: [{ translateX: -40 }] });
  await act(() => handlers.onPanResponderMove?.(event, gesture(20)));
  expect(view.getByTestId('account-menu-panel')).toHaveStyle({ transform: [{ translateX: 0 }] });
  await act(() => handlers.onPanResponderMove?.(event, gesture(-40)));
  await act(() => handlers.onPanResponderRelease?.(event, gesture(-40)));
  expect(view.getByTestId('account-menu-panel')).toHaveStyle({ transform: [{ translateX: 0 }] });
});

it.each([
  { dx: -150, vx: 0 },
  { dx: -20, vx: -0.8 },
])('dismisses a long drag or quick left swipe (%p)', async ({ dx, vx }) => {
  const { view, handlers, event, gesture } = await openDraggableDrawer();
  await act(() => handlers.onPanResponderGrant?.(event, gesture(0)));
  await act(() => handlers.onPanResponderMove?.(event, gesture(dx)));
  await act(() => handlers.onPanResponderRelease?.(event, gesture(dx, 0, vx)));
  expect(view.queryByTestId('account-menu-panel')).toBeNull();
});

it('restores an interrupted drag without closing the drawer', async () => {
  const { view, handlers, event, gesture } = await openDraggableDrawer();
  await act(() => handlers.onPanResponderGrant?.(event, gesture(0)));
  await act(() => handlers.onPanResponderMove?.(event, gesture(-200)));
  await act(() => handlers.onPanResponderTerminate?.(event, gesture(-200)));
  expect(view.getByTestId('account-menu-panel')).toHaveStyle({ transform: [{ translateX: 0 }] });
});

it('keeps menu navigation and backdrop dismissal working without a drag', async () => {
  const { view } = await openDraggableDrawer();
  await fireEvent.press(view.getByRole('menuitem', { name: 'Explore' }));
  expect(router.push).toHaveBeenCalledWith('/explore');
  expect(view.queryByTestId('account-menu-panel')).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Open account menu' }));
  await fireEvent.press(
    view.getByRole('button', { name: 'Close account menu', includeHiddenElements: true }),
  );
  expect(view.queryByTestId('account-menu-panel')).toBeNull();
});
