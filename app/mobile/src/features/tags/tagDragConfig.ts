import { ReduceMotion } from 'react-native-reanimated';
import type { Status } from '@/types';

export type OptimisticTagOrders = {
  tagKey: string;
  orders: Partial<Record<Status, string[]>>;
};

export const TAG_HEADER_HEIGHT = 116;

export const tagDragAnimation = {
  damping: 26,
  stiffness: 260,
  mass: 0.7,
  overshootClamping: true,
  reduceMotion: ReduceMotion.System,
};
