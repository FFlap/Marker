import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import {
  Animated,
  Dimensions,
  PanResponder,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';

let mockReducedMotion = true;
jest.mock('../../src/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mockReducedMotion,
}));

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
async function openDraggableDrawer(reducedMotion = true) {
  mockReducedMotion = reducedMotion;
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
  mockReducedMotion = true;
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

it('buffers movement and release until the native animation position arrives', async () => {
  const { view, handlers, event, gesture } = await openDraggableDrawer();
  let stopped: ((value: number) => void) | undefined;
  const stopSpy = jest
    .spyOn(Animated.Value.prototype, 'stopAnimation')
    .mockImplementation((callback) => {
      stopped = callback;
    });
  await act(() => handlers.onPanResponderGrant?.(event, gesture(0)));
  await act(() => handlers.onPanResponderMove?.(event, gesture(-40)));
  expect(view.getByTestId('account-menu-panel')).toHaveStyle({ transform: [{ translateX: 0 }] });
  const width = Math.min(Dimensions.get('window').width * 0.82, 320);
  await act(() => stopped?.(0.6));
  expect(view.getByTestId('account-menu-panel')).toHaveStyle({
    transform: [{ translateX: -width * 0.4 - 40 }],
  });
  await act(() => handlers.onPanResponderTerminate?.(event, gesture(-40)));

  await act(() => handlers.onPanResponderGrant?.(event, gesture(0)));
  const lateStop = stopped;
  await act(() => handlers.onPanResponderRelease?.(event, gesture(-20, 0, -0.8)));
  expect(view.getByTestId('account-menu-panel')).toBeTruthy();
  await act(() => lateStop?.(0.9));
  expect(view.queryByTestId('account-menu-panel')).toBeNull();
  stopSpy.mockRestore();
});

it('ignores a stale native position after cancellation', async () => {
  const { view, handlers, event, gesture } = await openDraggableDrawer();
  let stopped: ((value: number) => void) | undefined;
  const stopSpy = jest
    .spyOn(Animated.Value.prototype, 'stopAnimation')
    .mockImplementation((callback) => {
      stopped = callback;
    });
  await act(() => handlers.onPanResponderGrant?.(event, gesture(0)));
  await act(() => handlers.onPanResponderMove?.(event, gesture(-100)));
  await act(() => handlers.onPanResponderTerminate?.(event, gesture(-100)));
  await act(() => stopped?.(0.4));
  expect(view.getByTestId('account-menu-panel')).toHaveStyle({ transform: [{ translateX: 0 }] });
  stopSpy.mockRestore();
});

it('does not interrupt Android Back dismissal with an active drag', async () => {
  const frameSpy = jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0);
    return 0;
  });
  const { view, handlers, event, gesture } = await openDraggableDrawer(false);
  await act(() => handlers.onPanResponderGrant?.(event, gesture(0)));
  await act(() => handlers.onPanResponderMove?.(event, gesture(-40)));
  timingSpy.mockClear();
  // Keep the closing animation in flight while more touch events arrive.
  timingSpy.mockImplementationOnce(() => ({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() }));
  await fireEvent(view.getByTestId('account-menu-modal'), 'requestClose');
  const valueSpy = jest.spyOn(Animated.Value.prototype, 'setValue');
  await act(() => handlers.onPanResponderMove?.(event, gesture(-80)));
  await act(() => handlers.onPanResponderRelease?.(event, gesture(-80)));
  await act(() => handlers.onPanResponderTerminate?.(event, gesture(-80)));
  expect(valueSpy).not.toHaveBeenCalled();
  expect(timingSpy).toHaveBeenCalledTimes(1);
  expect(handlers.onMoveShouldSetPanResponder?.(event, gesture(-30))).toBe(false);
  valueSpy.mockRestore();
  frameSpy.mockRestore();
});
