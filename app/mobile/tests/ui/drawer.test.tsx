import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { PortalHost } from '@rn-primitives/portal';
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
