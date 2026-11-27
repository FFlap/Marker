import { useCallback, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

/** Tracks whether a list has scrolled past a point, re-rendering only when that flips. */
export function useScrolledPast(threshold: number) {
  const [past, setPast] = useState(false);
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = event.nativeEvent.contentOffset.y > threshold;
      setPast((current) => (current === next ? current : next));
    },
    [threshold],
  );
  return { past, onScroll };
}
