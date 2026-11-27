import type { ComponentType } from 'react';
import { Text, View } from 'react-native';
import type { LucideProps } from 'lucide-react-native';
import { NativePressable } from '@/components/ui/NativePressable';
import { colors } from '@/constants/colors';
import { radius, typeRamp } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';

type InlineActionProps = {
  label: string;
  icon: ComponentType<LucideProps>;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
};

export function InlineAction({
  label,
  icon: Icon,
  onPress,
  disabled = false,
  accessibilityLabel,
}: InlineActionProps) {
  return (
    <NativePressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      onPress={onPress}
      style={[styles.action, disabled && styles.disabled]}
      pressedStyle={styles.pressed}
    >
      <Icon size={14} color={colors.text} strokeWidth={2} />
      <Text style={styles.actionText}>{label}</Text>
    </NativePressable>
  );
}

export function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.header}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
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
      marginTop: 32,
      marginBottom: 14,
    },
    title: { ...typeRamp.sectionTitle },
    action: {
      height: 34,
      paddingHorizontal: 14,
      borderRadius: radius.pill,
      backgroundColor: colors.elevated,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    actionText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    disabled: { opacity: 0.4 },
    pressed: { opacity: 0.6 },
  },
  ['title', 'actionText'] as const,
);
