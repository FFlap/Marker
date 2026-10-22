import { PanResponder } from 'react-native';
import type { AppDrawerHandle } from '@/components/AppDrawer';

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
