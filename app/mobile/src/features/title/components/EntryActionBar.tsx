import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativePressable } from '@/components/ui/NativePressable';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';

const PILL_HEIGHT = 54;
const GAP_ABOVE_PILL = 24;
const MIN_BOTTOM_GAP = 12;

function bottomGap(safeAreaBottom: number) {
  return Math.max(safeAreaBottom, MIN_BOTTOM_GAP) + 4;
}

/** Bottom content padding that keeps the last row scrollable above the pill. */
export function useEntryActionBarSpace() {
  const { bottom } = useSafeAreaInsets();
  return PILL_HEIGHT + GAP_ABOVE_PILL + bottomGap(bottom);
}

/** Sticky full-width pill for adding or updating a library entry. */
export function EntryActionBar({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { bottom } = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[s.bar, { paddingBottom: bottomGap(bottom) }]}>
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
      height: PILL_HEIGHT,
      borderRadius: PILL_HEIGHT / 2,
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
    label: { color: colors.bg, fontSize: 16, fontWeight: '700', letterSpacing: 0.1 },
  },
  ['label'] as const,
);
