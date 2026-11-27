import { useCallback, useMemo, type ReactNode } from 'react';
import { useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';

/** A deliberate sideways swipe: far enough or fast enough, and mostly horizontal. */
const SWIPE_DISTANCE = 56;
const SWIPE_VELOCITY = 550;

/**
 * Content under a row of tab chips. Swiping it sideways selects the neighbouring tab, like
 * the swipeable pages elsewhere; vertical scrolling inside is left alone.
 */
export function SwipeTabsArea<T extends string>({
  tabs,
  value,
  onChange,
  style,
  children,
}: {
  tabs: readonly T[];
  value: T;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  // Fill the visible pane below the chips, so a swipe works on empty space too, not only
  // over the rows (about 240dp sit above it: header, search field and chips).
  const { height } = useWindowDimensions();
  const index = tabs.indexOf(value);
  const step = useCallback(
    (direction: 1 | -1) => {
      const next = tabs[index + direction];
      if (next !== undefined) onChange(next);
    },
    [index, onChange, tabs],
  );
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-24, 24])
        .failOffsetY([-14, 14])
        .onEnd((event) => {
          if (
            Math.abs(event.translationX) < SWIPE_DISTANCE &&
            Math.abs(event.velocityX) < SWIPE_VELOCITY
          )
            return;
          // Where the swipe was heading, so a quick flick counts its direction too.
          const projected = event.translationX + event.velocityX * 0.08;
          if (projected === 0) return;
          runOnJS(step)(projected < 0 ? 1 : -1);
        }),
    [step],
  );
  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false} style={[{ minHeight: Math.max(240, height - 240) }, style]}>
        {children}
      </View>
    </GestureDetector>
  );
}
