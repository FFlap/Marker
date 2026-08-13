import type { ReactNode } from 'react';
import type { TextInputProps } from 'react-native';
import { Pressable, Text, TextInput, View } from 'react-native';
import { NativePressable } from '@/components/ui/NativePressable';
import { colors } from '@/constants/colors';
import { createStyles } from '@/lib/typography';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  testID,
  icon,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'outline' | 'danger' | 'ghost';
  disabled?: boolean;
  testID?: string;
  icon?: ReactNode;
}) {
  return (
    <NativePressable
      accessibilityLabel={title}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, styles[variant], disabled && styles.disabled]}
      pressedStyle={styles.pressed}
    >
      <View style={styles.buttonContent}>
        {icon}
        <Text style={[styles.buttonText, variant === 'primary' && styles.primaryButtonText]}>
          {title}
        </Text>
      </View>
    </NativePressable>
  );
}

export function Chip({
  label,
  selected = false,
  onPress,
  accessibilityLabel = label,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipOn]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

export function Input({
  compact = false,
  style,
  ...props
}: TextInputProps & { compact?: boolean }) {
  return (
    <TextInput
      placeholderTextColor={colors.muted}
      style={[styles.input, compact && styles.compactInput, style]}
      {...props}
    />
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: readonly { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.segmented}>
      {options.map((option) => (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: value === option.value, disabled }}
          disabled={disabled}
          key={option.value}
          onPress={() => onChange(option.value)}
          style={[
            styles.segment,
            value === option.value && styles.segmentOn,
            disabled && styles.disabled,
          ]}
        >
          <Text style={[styles.segmentText, value === option.value && styles.segmentTextOn]}>
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {detail ? <Text style={styles.muted}>{detail}</Text> : null}
    </View>
  );
}

export function StatTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {detail ? <Text style={styles.statDetail}>{detail}</Text> : null}
    </View>
  );
}

const styles = createStyles({
  button: {
    height: 46,
    paddingHorizontal: 18,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  outline: { backgroundColor: colors.surface },
  danger: { backgroundColor: 'transparent', borderColor: colors.danger },
  ghost: { borderColor: 'transparent' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.78 },
  buttonContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  buttonText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  primaryButtonText: { color: colors.bg },
  chip: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 18,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { borderColor: colors.text, backgroundColor: colors.text },
  chipText: { color: colors.muted, fontSize: 13 },
  chipTextOn: { color: colors.bg },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    color: colors.text,
    paddingHorizontal: 14,
    fontSize: 15,
    backgroundColor: colors.surface,
  },
  compactInput: { height: 36 },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
  },
  segmentOn: { backgroundColor: colors.border },
  segmentText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  segmentTextOn: { color: colors.text },
  empty: { paddingVertical: 22, alignItems: 'center' },
  emptyTitle: { color: colors.text, fontSize: 15, marginBottom: 5 },
  muted: { color: colors.muted, fontSize: 13, textAlign: 'center' },
  stat: {
    width: '48%',
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingVertical: 18,
    minHeight: 110,
  },
  statValue: {
    color: colors.text,
    fontSize: 25,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 7,
    letterSpacing: 0.1,
  },
  statDetail: { color: colors.muted, fontSize: 11, marginTop: 4 },
});
