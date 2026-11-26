import { useCallback, useEffect, useRef } from 'react';
import type { LayoutChangeEvent, ScrollView } from 'react-native';

/**
 * For a horizontal strip of filter chips: whenever the selection changes (a tap, a swipe of
 * the results, or "See all"), scroll the strip so the selected chip is in view.
 */
export function useChipInView<T extends string>(selected: T) {
  const stripRef = useRef<ScrollView>(null);
  const chips = useRef(new Map<T, { x: number; width: number }>());
  const viewport = useRef(0);
  const offset = useRef(0);

  const reveal = useCallback((key: T, animated: boolean) => {
    const chip = chips.current.get(key);
    if (!chip || !viewport.current) return;
    // Leave a little room on that side, so the neighbouring chip peeks in.
    const margin = 24;
    if (chip.x - margin < offset.current)
      stripRef.current?.scrollTo({ x: Math.max(0, chip.x - margin), animated });
    else if (chip.x + chip.width + margin > offset.current + viewport.current)
      stripRef.current?.scrollTo({
        x: chip.x + chip.width + margin - viewport.current,
        animated,
      });
  }, []);

  useEffect(() => {
    reveal(selected, true);
  }, [reveal, selected]);

  /** Put on the strip's ScrollView. */
  const stripProps = {
    ref: stripRef,
    onLayout: (event: LayoutChangeEvent) => {
      viewport.current = event.nativeEvent.layout.width;
      // A narrower strip (or one laid out after its chips) can leave the selection outside.
      reveal(selected, false);
    },
    onScroll: (event: { nativeEvent: { contentOffset: { x: number } } }) => {
      offset.current = event.nativeEvent.contentOffset.x;
    },
    scrollEventThrottle: 32,
  };
  /** Put on each chip, keyed by its value. */
  const onChipLayout = (key: T) => (event: LayoutChangeEvent) => {
    const { x, width } = event.nativeEvent.layout;
    chips.current.set(key, { x, width });
    // A selection made before the chips were measured (opening on "See all").
    if (key === selected) reveal(key, false);
  };
  return { stripProps, onChipLayout };
}
