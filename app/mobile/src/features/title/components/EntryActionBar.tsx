import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativePressable } from '@/components/ui/NativePressable';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';

/** Full-width pill pinned below a screen's scrolling content for adding or updating an entry. */
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
    <View style={[s.bar, { paddingBottom: Math.max(bottom, 12) + 4 }]}>
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
    bar: { alignItems: 'center', paddingHorizontal: 20, paddingTop: 10 },
    pill: {
      width: '100%',
      maxWidth: 720,
      minHeight: 54,
      paddingVertical: 14,
      paddingHorizontal: 24,
      borderRadius: 27,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },
    disabled: { opacity: 0.5 },
    pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },
    label: { color: colors.bg, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  },
  ['label'] as const,
);
