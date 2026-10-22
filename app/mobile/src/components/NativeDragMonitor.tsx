import { ReduceMotion, runOnJS, useAnimatedReaction } from 'react-native-reanimated';
import type { NativePosterDragMotion } from '@/components/NativePosterDragPreview';
import type { Status } from '@/types';

export type NativeDragValues = NativePosterDragMotion & {
  activeCellSize: { value: number };
  hoverOffset: { value: number };
};

export const nativeDragAnimation = {
  damping: 26,
  stiffness: 260,
  mass: 0.7,
  overshootClamping: true,
  reduceMotion: ReduceMotion.System,
};

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
