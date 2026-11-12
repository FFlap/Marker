import React from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { PortalHost } from '@rn-primitives/portal';
import { Platform, TextInput } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '../../src/components/ui/drawer';

jest.mock('@rn-primitives/dialog', () => {
  const React = require('react');
  const actual = jest.requireActual('@rn-primitives/dialog');
  return {
    ...actual,
    Overlay: (props: object) =>
      React.createElement(actual.Overlay, { ...props, testID: 'backdrop' }),
  };
});

jest.mock('react-native-screens', () => ({
  FullWindowOverlay: ({ children }: { children: React.ReactNode }) => children,
}));

it('keeps a closed drawer idle and mounts its contents when opened and reopened', async () => {
  const timing = jest.spyOn(Reanimated, 'withTiming');
  const scene = (open: boolean) => (
    <>
      <Drawer open={open}>
        <DrawerContent>
          <TextInput accessibilityLabel="Deferred drawer input" />
        </DrawerContent>
      </Drawer>
      <PortalHost />
    </>
  );
  try {
    const view = await render(scene(false));
    expect(view.queryByLabelText('Deferred drawer input')).toBeNull();
    expect(timing).not.toHaveBeenCalled();
    await view.rerender(scene(true));
    expect(view.getByLabelText('Deferred drawer input')).toBeTruthy();
    expect(timing).toHaveBeenCalledWith(1, expect.objectContaining({ reduceMotion: 'system' }));
    await view.rerender(scene(false));
    expect(view.queryByLabelText('Deferred drawer input')).toBeNull();
    expect(timing).toHaveBeenCalledWith(0, expect.anything());
    await view.rerender(scene(true));
    expect(view.getByLabelText('Deferred drawer input')).toBeTruthy();
  } finally {
    timing.mockRestore();
  }
});

it.each([
  ['ios', 0],
  ['android', -34],
] as const)(
  'accounts for the %s drawer bounds when reserving keyboard space',
  async (os, space) => {
    const originalOS = Platform.OS;
    Platform.OS = os;
    try {
      const view = await render(
        <SafeAreaInsetsContext.Provider value={{ top: 59, bottom: 34, left: 0, right: 0 }}>
          <Drawer open>
            <DrawerContent>
              <TextInput accessibilityLabel="Drawer input" />
            </DrawerContent>
          </Drawer>
          <PortalHost />
        </SafeAreaInsetsContext.Provider>,
      );
      expect(view.getByTestId('drawer-scroll-view').props.extraKeyboardSpace).toBe(space);
      expect(view.getByLabelText('Drawer input')).toBeTruthy();
    } finally {
      Platform.OS = originalOS;
    }
  },
);

it('dismisses through the native overlay after the exit animation', async () => {
  jest.useFakeTimers();
  try {
    const onOpenChange = jest.fn();
    const view = await render(
      <>
        <Drawer open onOpenChange={onOpenChange}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Example drawer</DrawerTitle>
            </DrawerHeader>
          </DrawerContent>
        </Drawer>
        <PortalHost />
      </>,
    );
    await fireEvent.press(view.getByText('Example drawer'));
    expect(onOpenChange).not.toHaveBeenCalled();
    await fireEvent.press(view.getByTestId('backdrop'));
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTime(200));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  } finally {
    jest.useRealTimers();
  }
});

// Keep callbacks and detector placement observable without running a native UI thread.
jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  const { View } = require('react-native');
  const makeGesture = (kind: string) => {
    const handlers: Record<string, unknown> = { kind };
    const gesture = new Proxy(handlers, {
      get: (target, key: string) =>
        key in target
          ? target[key]
          : (value: unknown) => {
              target[key] = value;
              return gesture;
            },
    });
    return gesture;
  };
  return {
    Gesture: { Pan: () => makeGesture('pan'), Native: () => makeGesture('native') },
    GestureDetector: ({
      gesture,
      children,
    }: {
      gesture: { kind: string };
      children: React.ReactNode;
    }) => React.createElement(View, { testID: `gesture-${gesture.kind}`, gesture }, children),
  };
});

it('drags from the body at the top, yields to scrolling, and settles short drags', async () => {
  jest.useFakeTimers();
  try {
    const onOpenChange = jest.fn();
    const view = await render(
      <>
        <Drawer open onOpenChange={onOpenChange}>
          <DrawerContent>
            <TextInput accessibilityLabel="Body input" />
          </DrawerContent>
        </Drawer>
        <PortalHost />
      </>,
    );
    const body = view.getAllByTestId('gesture-pan')[1];
    expect(within(body).getByLabelText('Body input')).toBeTruthy();
    const gesture = body.props.gesture;
    const scroll = view.getByTestId('drawer-scroll-view');
    const manager = { fail: jest.fn(), activate: jest.fn() };
    const touches = (x: number, y: number) => ({ allTouches: [{ absoluteX: x, absoluteY: y }] });
    gesture.onTouchesDown(touches(100, 100), manager);
    gesture.onTouchesMove(touches(100, 130), manager);
    expect(manager.activate).toHaveBeenCalledTimes(1);
    manager.activate.mockClear();
    gesture.onTouchesDown(touches(100, 100), manager);
    gesture.onTouchesMove(touches(100, 80), manager);
    expect(manager.fail).toHaveBeenCalledTimes(1);
    scroll.props.onScroll({ contentOffset: { y: 40 } });
    gesture.onTouchesDown(touches(100, 100), manager);
    gesture.onTouchesMove(touches(100, 130), manager);
    expect(manager.fail).toHaveBeenCalledTimes(2);
    expect(manager.activate).not.toHaveBeenCalled();
    await act(() => {
      gesture.onStart();
      gesture.onUpdate({ translationY: 10 });
      gesture.onEnd({ translationY: 10, velocityY: 0 });
    });
    expect(onOpenChange).not.toHaveBeenCalled();
    scroll.props.onScroll({ contentOffset: { y: 0 } });
    await act(() => {
      gesture.onStart();
      gesture.onUpdate({ translationY: 40 });
      gesture.onEnd({ translationY: 40, velocityY: 1000 });
    });
    await act(() => jest.advanceTimersByTime(200));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  } finally {
    jest.useRealTimers();
  }
});
