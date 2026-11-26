import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';

const TOUCH_HEIGHT = 44;
const TRACK_HEIGHT = 16;
const INSET = 14;
const THUMB_WIDTH = 10;
const THUMB_BORDER = 3;
// The track ends under the thumb's white core at the end stops, so no sliver of track
// shows beside it; the thumb's dark border sits on the page background there.
const TRACK_INSET = INSET - (THUMB_WIDTH / 2 - THUMB_BORDER);
const settle = { duration: 180, easing: Easing.bezier(0.22, 1, 0.36, 1) } as const;

/**
 * Discrete slider. Drag or tap anywhere on the track; the value snaps to the nearest stop.
 */
export function StepSlider({
  steps,
  index,
  onChange,
  onPreview,
  accessibilityLabel,
  valueLabel,
  disabled = false,
  stopLabels,
}: {
  steps: number;
  /** The saved stop. Previews stay inside the slider until a drag or tap ends. */
  index: number;
  /** Called once with the chosen stop when a drag or tap ends on a new stop. */
  onChange: (index: number) => void;
  /** Called while dragging so a preview can follow; `undefined` when the drag ends. */
  onPreview?: (index: number | undefined) => void;
  accessibilityLabel: string;
  valueLabel: string;
  disabled?: boolean;
  /** A label under each stop (such as 3 · 4 · 5); the current one is white. */
  stopLabels?: readonly string[];
}) {
  const [width, setWidth] = useState(0);
  const usable = Math.max(1, width - INSET * 2);
  const stepWidth = usable / Math.max(1, steps - 1);
  const position = useSharedValue(INSET + index * stepWidth);
  const dragging = useSharedValue(false);
  const [hovered, setHovered] = useState<number>();
  const shown = hovered ?? index;

  // The first layout places the thumb at once; only later changes animate, so opening the
  // screen doesn't look like the setting changing.
  const placed = useRef(false);
  useEffect(() => {
    if (dragging.get()) return;
    const target = INSET + index * stepWidth;
    if (!placed.current) {
      if (width > 0) {
        placed.current = true;
        position.set(target);
      }
      return;
    }
    position.set(withTiming(target, { ...settle, reduceMotion: ReduceMotion.System }));
  }, [dragging, index, position, stepWidth, width]);

  const select = (next: number) => {
    setHovered(undefined);
    onPreview?.(undefined);
    if (next !== index) onChange(next);
  };
  const preview = (next: number | undefined) => {
    setHovered(next);
    onPreview?.(next);
  };

  const nearest = (x: number) => {
    'worklet';
    return Math.max(0, Math.min(steps - 1, Math.round((x - INSET) / stepWidth)));
  };

  const pan = Gesture.Pan()
    .enabled(!disabled && width > 0)
    .activeOffsetX([-4, 4])
    .failOffsetY([-14, 14])
    .onStart(() => {
      dragging.set(true);
    })
    .onUpdate((event) => {
      position.set(Math.max(INSET, Math.min(width - INSET, event.x)));
      runOnJS(preview)(nearest(event.x));
    })
    .onFinalize((event, success) => {
      dragging.set(false);
      // A cancelled drag, such as one taken over by vertical scrolling, keeps the old value.
      const next = success ? nearest(event.x) : index;
      position.set(
        withTiming(INSET + next * stepWidth, { ...settle, reduceMotion: ReduceMotion.System }),
      );
      if (success) runOnJS(select)(next);
      else runOnJS(preview)(undefined);
    });
  const tap = Gesture.Tap()
    .enabled(!disabled && width > 0)
    .onEnd((event) => {
      const next = nearest(event.x);
      position.set(
        withTiming(INSET + next * stepWidth, { ...settle, reduceMotion: ReduceMotion.System }),
      );
      runOnJS(select)(next);
    });

  // The track ends under the thumb at both stops, so the last stop reads as all the way,
  // and the fill runs to the thumb's centre.
  const fillStyle = useAnimatedStyle(() => ({ width: position.get() - TRACK_INSET }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: position.get() - THUMB_WIDTH / 2 }],
  }));

  const slider = (
    <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: valueLabel }}
        accessibilityState={{ disabled }}
        accessibilityActions={[
          { name: 'increment', label: 'Increase' },
          { name: 'decrement', label: 'Decrease' },
        ]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === 'increment') select(Math.min(steps - 1, index + 1));
          if (nativeEvent.actionName === 'decrement') select(Math.max(0, index - 1));
        }}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        style={[s.touch, disabled && s.disabled]}
      >
        <View pointerEvents="none" style={s.track}>
          <Animated.View style={[s.fill, fillStyle]} />
        </View>
        {/* Inner stops only: the track's rounded ends already mark the first and last. */}
        {width > 0 &&
          Array.from({ length: steps }, (_, step) => step)
            .filter((step) => step > 0 && step < steps - 1)
            .map((step) => (
              <View
                key={step}
                pointerEvents="none"
                style={[
                  s.dot,
                  { left: INSET + step * stepWidth - 2.5 },
                  step <= shown ? s.dotOnFill : s.dotOnTrack,
                ]}
              />
            ))}
        <Animated.View pointerEvents="none" style={[s.thumb, thumbStyle]} />
      </View>
    </GestureDetector>
  );
  if (!stopLabels) return slider;
  return (
    <View>
      {slider}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={s.stopLabels}
      >
        {/* A row of equal columns: the first label starts with the track, the last ends
            with it, the middle one centres on its stop (exact for three stops). Labels wrap
            and push what follows down at large system text. */}
        {stopLabels.map((label, step) => (
          <Text
            key={label}
            style={[
              s.stopLabel,
              step === 0
                ? s.stopLabelFirst
                : step === stopLabels.length - 1
                  ? s.stopLabelLast
                  : s.stopLabelMiddle,
              step === shown && s.stopLabelCurrent,
            ]}
          >
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const s = createAppStyles(
  {
    touch: { height: TOUCH_HEIGHT, justifyContent: 'center' },
    track: {
      height: TRACK_HEIGHT,
      marginHorizontal: TRACK_INSET,
      borderRadius: radius.pill,
      backgroundColor: colors.elevated,
      // Outlined like unchecked toggles, so the rail still reads at the first stop.
      borderWidth: 1,
      borderColor: colors.control,
      overflow: 'hidden',
    },
    disabled: { opacity: 0.45 },
    fill: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      backgroundColor: colors.text,
    },
    dot: { position: 'absolute', width: 5, height: 5, borderRadius: 3 },
    dotOnFill: { backgroundColor: colors.bg },
    dotOnTrack: { backgroundColor: colors.muted },
    stopLabels: { flexDirection: 'row', marginTop: 2, paddingHorizontal: TRACK_INSET },
    stopLabel: { flex: 1, color: colors.muted, fontSize: 12, fontWeight: '600' },
    stopLabelCurrent: { color: colors.text },
    stopLabelFirst: { textAlign: 'left' },
    stopLabelLast: { textAlign: 'right' },
    stopLabelMiddle: { textAlign: 'center' },
    thumb: {
      position: 'absolute',
      left: 0,
      width: THUMB_WIDTH,
      height: TRACK_HEIGHT + 12,
      top: (TOUCH_HEIGHT - TRACK_HEIGHT - 12) / 2,
      borderRadius: 4,
      borderLeftWidth: THUMB_BORDER,
      borderRightWidth: THUMB_BORDER,
      borderColor: colors.bg,
      backgroundColor: colors.text,
    },
  },
  ['stopLabel'] as const,
);
