import { Children, useEffect, useRef, useState, type ReactNode } from 'react';
import { PixelRatio, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

const SWIPE_VELOCITY = 500;
const settle = {
  duration: 280,
  easing: Easing.bezier(0.22, 1, 0.36, 1),
  reduceMotion: ReduceMotion.System,
} as const;

/**
 * Side-by-side pages that follow the finger and settle on the nearest page, like a
 * native pager. Every page stays mounted, so state such as a chosen period survives
 * switching back. The pager takes the height of the page being shown, and vertical
 * movement is left to the surrounding scroll view.
 */
export function SwipePages({
  index,
  onIndexChange,
  children,
  minHeight,
  gutter = 0,
  position: externalPosition,
  onSwipeStart,
}: {
  index: number;
  onIndexChange: (index: number) => void;
  children: ReactNode;
  /** Keeps short pages swipeable across the visible area. */
  minHeight?: number;
  /**
   * The screen's side padding. Pages extend into it so rails that bleed to the screen
   * edge are not clipped.
   */
  gutter?: number;
  /** Fractional page position, for tab indicators that follow the swipe. */
  position?: SharedValue<number>;
  /** Called when a sideways swipe takes over, before any page moves. */
  onSwipeStart?: () => void;
}) {
  const pages = Children.toArray(children);
  const count = pages.length;
  const [width, setWidth] = useState(0);
  const internalPosition = useSharedValue(index);
  const position = externalPosition ?? internalPosition;
  const heights = useSharedValue<number[]>([]);
  const measured = useRef<number[]>([]);
  const start = useSharedValue(index);
  const committed = useRef(index);
  // The selected page, readable from gesture worklets.
  const selected = useSharedValue(index);

  useEffect(() => {
    selected.set(index);
    // A swipe already animates to the page it chose; taps on tabs animate here.
    if (committed.current === index) return;
    committed.current = index;
    position.set(withTiming(index, settle));
  }, [index, position, selected]);

  const commit = (next: number) => {
    committed.current = next;
    onIndexChange(next);
  };

  const pan = Gesture.Pan()
    .enabled(width > 0 && count > 1)
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .onStart(() => {
      start.set(position.get());
      if (onSwipeStart) runOnJS(onSwipeStart)();
    })
    .onUpdate((event) => {
      let next = start.get() - event.translationX / width;
      // Resist dragging past the first and last page.
      if (next < 0) next *= 0.25;
      if (next > count - 1) next = count - 1 + (next - (count - 1)) * 0.25;
      position.set(next);
    })
    .onEnd((event, success) => {
      // A cancelled pan also ends here; onFinalize settles it back on the selected page.
      if (!success) return;
      // Measure from the selected page, even if a tab animation was still running.
      const from = selected.get();
      let target = Math.round(position.get());
      if (Math.abs(event.velocityX) > SWIPE_VELOCITY)
        target = event.velocityX < 0 ? from + 1 : from - 1;
      // One page per swipe, within the first and last page.
      target = Math.max(0, Math.min(count - 1, Math.max(from - 1, Math.min(from + 1, target))));
      position.set(withTiming(target, settle));
      if (target !== from) {
        selected.set(target);
        runOnJS(commit)(target);
      }
    })
    .onFinalize((_event, success) => {
      // An interrupted swipe returns to the selected page so the tabs stay in sync.
      if (!success) position.set(withTiming(selected.get(), settle));
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -position.get() * width }],
  }));
  // Blend between neighboring pages' heights so the content below moves smoothly.
  const frameStyle = useAnimatedStyle(() => {
    const measured = heights.get();
    const current = Math.max(0, Math.min(count - 1, position.get()));
    const lower = Math.floor(current);
    const upper = Math.ceil(current);
    const low = measured[lower];
    const high = measured[upper];
    if (low === undefined || high === undefined) return {};
    return { height: low + (high - low) * (current - lower) };
  });

  const measuredWidth = width > 0;
  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        collapsable={false}
        // Whole pixels, so the shift lines up exactly with where each page is drawn.
        onLayout={(event) =>
          setWidth(PixelRatio.roundToNearestPixel(event.nativeEvent.layout.width))
        }
        style={[
          { minHeight, overflow: 'hidden', marginHorizontal: -gutter },
          measuredWidth && frameStyle,
        ]}
      >
        <Animated.View
          style={[{ flexDirection: 'row', alignItems: 'flex-start' }, measuredWidth && rowStyle]}
        >
          {pages.map((page, pageIndex) => (
            <View
              key={pageIndex}
              // Until the width is known, only the selected page is laid out.
              style={[
                // Clip each page so a rail bleeding to the screen edge can't show on its neighbor.
                { paddingHorizontal: gutter, overflow: 'hidden' },
                measuredWidth
                  ? { width }
                  : pageIndex === index
                    ? { width: '100%' }
                    : { display: 'none' },
              ]}
              onLayout={(event) => {
                measured.current[pageIndex] = event.nativeEvent.layout.height;
                heights.set([...measured.current]);
              }}
              accessibilityElementsHidden={pageIndex !== index}
              importantForAccessibility={pageIndex === index ? 'auto' : 'no-hide-descendants'}
            >
              {page}
            </View>
          ))}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}
