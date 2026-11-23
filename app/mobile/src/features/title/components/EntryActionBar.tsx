import { useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativePressable } from '@/components/ui/NativePressable';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';

const PILL_MIN_HEIGHT = 54;
const GAP_ABOVE_PILL = 24;

function bottomGap(safeAreaBottom: number) {
  return Math.max(safeAreaBottom, 12) + 4;
}

/**
 * Tracks the floating pill's rendered height so scrolling content can end above it,
 * including when larger system font sizes make the pill taller.
 */
export function useEntryActionBarLayout() {
  const { bottom } = useSafeAreaInsets();
  const [barHeight, setBarHeight] = useState(PILL_MIN_HEIGHT + bottomGap(bottom));
  return {
    contentPaddingBottom: barHeight + GAP_ABOVE_PILL,
    onLayout: (event: LayoutChangeEvent) => setBarHeight(event.nativeEvent.layout.height),
  };
}

/** Full-width pill floating over the bottom of a screen for adding or updating an entry. */
export function EntryActionBar({
  label,
  onPress,
  onLayout,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
  disabled?: boolean;
}) {
  const { bottom } = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      onLayout={onLayout}
      style={[s.bar, { paddingBottom: bottomGap(bottom) }]}
    >
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
        <Text style={s.label}>{label}</Text>
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
    },
    pill: {
      width: '100%',
      maxWidth: 720,
      minHeight: PILL_MIN_HEIGHT,
      paddingVertical: 14,
      paddingHorizontal: 24,
      borderRadius: PILL_MIN_HEIGHT / 2,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
      shadowColor: '#000',
      shadowOpacity: 0.45,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 10,
    },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
    label: { color: colors.bg, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  },
  ['label'] as const,
);
