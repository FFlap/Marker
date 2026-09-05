import type { ComponentProps, ReactNode } from 'react';
import { PanResponder, View } from 'react-native';
import { ReduceMotion, runOnJS, useAnimatedReaction } from 'react-native-reanimated';
import type { AppDrawerHandle } from '@/components/AppDrawer';
import type { Status } from '@/types';
import type { NativeDragValues } from '../hooks/useLibraryReordering';

export const nativeDragAnimation = {
  damping: 26,
  stiffness: 260,
  mass: 0.7,
  overshootClamping: true,
  reduceMotion: ReduceMotion.System,
};

export const createDrawerEdgeSwipe = (drawer: AppDrawerHandle | null, isBlocked: () => boolean) =>
  PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) =>
      !isBlocked() &&
      gesture.x0 <= 28 &&
      gesture.dx > 10 &&
      Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.25,
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dx >= 52 || gesture.vx >= 0.55) drawer?.open();
    },
    onPanResponderTerminate: (_, gesture) => {
      if (gesture.dx >= 72) drawer?.open();
    },
  });

export function StatusDropZone({
  children,
  onLayout,
  style,
}: {
  children: ReactNode;
  onLayout?: ComponentProps<typeof View>['onLayout'];
  style: ComponentProps<typeof View>['style'];
}) {
  return (
    <View onLayout={onLayout} style={style}>
      {children}
    </View>
  );
}

export function NativeDragMonitor({
  listTop,
  onHover,
  status,
  values,
}: {
  listTop: number;
  onHover: (status: Status, contentY: number) => void;
  status: Status;
  values: NativeDragValues;
}) {
  useAnimatedReaction(
    () => ({
      active: values.isTouchActiveNative.value,
      center: values.hoverOffset.value + values.activeCellSize.value / 2,
    }),
    (current) => {
      if (current.active) runOnJS(onHover)(status, listTop + current.center);
    },
    [listTop, onHover, status, values],
  );
  return null;
}
