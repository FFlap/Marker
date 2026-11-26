import { useState, type ReactNode } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import { NativePressable } from '@/components/ui/NativePressable';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';

const PILL_MIN_HEIGHT = 52;
const GAP_ABOVE_PILL = 16;
// The root SafeAreaView already reserves the bottom inset.
const GAP_BELOW_PILL = 12;
const GAP_ABOVE_IN_BAR = 12;
const FADE = 28;

/**
 * Tracks the floating pill's rendered height so scrolling content can end above it,
 * including when larger system font sizes make the pill taller.
 */
export function useEntryActionBarLayout() {
  const [barHeight, setBarHeight] = useState(PILL_MIN_HEIGHT + GAP_BELOW_PILL + GAP_ABOVE_IN_BAR);
  return {
    contentPaddingBottom: barHeight + GAP_ABOVE_PILL,
    onLayout: (event: LayoutChangeEvent) => setBarHeight(event.nativeEvent.layout.height),
  };
}

/** Full-width pill docked in a footer at the bottom of a screen for adding or updating an entry. */
export function EntryActionBar({
  label,
  onPress,
  onLayout,
  disabled = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  return (
    <View onLayout={onLayout} style={s.bar}>
      {/* Content fades out above the bar instead of being cut by a line. The wrapper spans
          the full screen width, past the bar's side padding. */}
      <View pointerEvents="none" style={s.fade}>
        <Svg width="100%" height={FADE}>
          <Defs>
            <LinearGradient id="entryBarFade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.bg} stopOpacity={0} />
              <Stop offset="1" stopColor={colors.bg} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height={FADE} fill="url(#entryBarFade)" />
        </Svg>
      </View>
      <NativePressable
        testID="entry-action-bar"
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={[s.pill, disabled && s.disabled]}
        pressedStyle={s.pressed}
      >
        <View style={s.content}>
          {icon}
          <Text style={s.label}>{label}</Text>
        </View>
      </NativePressable>
    </View>
  );
}

const s = createAppStyles(
  {
    bar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 20,
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: GAP_ABOVE_IN_BAR,
      paddingBottom: GAP_BELOW_PILL,
      backgroundColor: colors.bg,
    },
    fade: { position: 'absolute', left: 0, right: 0, top: -FADE, height: FADE },
    pill: {
      width: '100%',
      maxWidth: 720,
      minHeight: PILL_MIN_HEIGHT,
      paddingVertical: 13,
      paddingHorizontal: 24,
      borderRadius: PILL_MIN_HEIGHT / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
    content: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    label: { color: colors.bg, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  },
  ['label'] as const,
);
