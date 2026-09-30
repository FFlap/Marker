import type { ComponentType } from 'react';
import { Text, View } from 'react-native';
import type { LucideProps } from 'lucide-react-native';
import { NativePressable } from '@/components/ui/NativePressable';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';

type InlineActionProps = {
  label: string;
  icon: ComponentType<LucideProps>;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  /** Header actions match the heading's size; inline ones sit at body size. */
  size?: 'body' | 'heading';
};

/**
 * Borderless icon-and-label action used across the detail pages, so page-level
 * actions read as part of the text rather than as boxed buttons.
 */
export function InlineAction({
  label,
  icon: Icon,
  onPress,
  disabled = false,
  accessibilityLabel,
  size = 'body',
}: InlineActionProps) {
  const heading = size === 'heading';
  return (
    <NativePressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 8 }}
      onPress={onPress}
      style={[styles.action, disabled && styles.disabled]}
      pressedStyle={styles.pressed}
    >
      <Icon size={heading ? 14 : 13} color={colors.text} strokeWidth={2} />
      <Text style={[styles.actionText, heading && styles.actionTextHeading]}>{label}</Text>
    </NativePressable>
  );
}

/** Detail-page section title on a hairline rule, with an optional inline action. */
export function SectionHeader({ title, action }: { title: string; action?: InlineActionProps }) {
  return (
    <View style={styles.header}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {action ? <InlineAction size="heading" {...action} /> : null}
    </View>
  );
}

const styles = createAppStyles(
  {
    header: {
      minHeight: 28,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      borderBottomWidth: 1,
      borderColor: colors.border,
      paddingBottom: 9,
      marginTop: 28,
      marginBottom: 16,
    },
    title: { color: colors.text, fontSize: 13, fontWeight: '600' },
    action: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    actionText: { color: colors.text, fontSize: 12, fontWeight: '600' },
    actionTextHeading: { fontSize: 13, fontWeight: '500' },
    disabled: { opacity: 0.4 },
    pressed: { opacity: 0.6 },
  },
  ['title', 'actionText', 'actionTextHeading'] as const,
);
