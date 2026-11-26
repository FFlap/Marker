import { useEffect, useState, type ComponentType, type ReactNode, type Ref } from 'react';
import type { StyleProp, TextInputProps, ViewStyle } from 'react-native';
import { Pressable, Text, TextInput, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Search from 'lucide-react-native/icons/search';
import X from 'lucide-react-native/icons/x';
import type { LucideProps } from 'lucide-react-native';
import { NativePressable } from '@/components/ui/NativePressable';
import { colors } from '@/constants/colors';
import { controlHeight, iconButtonSize, radius, typeRamp } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
type ControlSize = 'sm' | 'md' | 'lg';

const motion = { duration: 220, easing: Easing.bezier(0.22, 1, 0.36, 1) } as const;

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  testID,
  icon,
  style,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ControlSize;
  disabled?: boolean;
  testID?: string;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** When the visible title needs more context for screen readers. */
  accessibilityLabel?: string;
}) {
  return (
    <NativePressable
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        // A minimum, not a fixed height: at large system text a label wraps to two lines
        // instead of being clipped.
        {
          minHeight: controlHeight[size],
          paddingHorizontal: size === 'sm' ? 14 : 20,
          paddingVertical: size === 'sm' ? 4 : 6,
        },
        styles[variant],
        disabled && styles.disabled,
        style,
      ]}
      pressedStyle={styles.pressed}
    >
      <View style={styles.buttonContent}>
        {icon}
        <Text
          numberOfLines={2}
          style={[
            styles.buttonText,
            size === 'sm' && styles.buttonTextSmall,
            variant === 'primary' && styles.primaryButtonText,
            variant === 'danger' && styles.dangerButtonText,
          ]}
        >
          {title}
        </Text>
      </View>
    </NativePressable>
  );
}

/** Round icon-only control. Transparent until pressed so it sits on any surface. */
export function IconButton({
  icon: Icon,
  accessibilityLabel,
  onPress,
  size = 'md',
  variant = 'ghost',
  disabled = false,
  color = colors.text,
  testID,
  hitSlop = 4,
  style,
  accessibilityHint,
}: {
  icon: ComponentType<LucideProps>;
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress?: () => void;
  size?: ControlSize;
  variant?: 'ghost' | 'filled';
  disabled?: boolean;
  color?: string;
  testID?: string;
  hitSlop?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const diameter = iconButtonSize[size];
  return (
    <NativePressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      testID={testID}
      disabled={disabled}
      hitSlop={hitSlop}
      onPress={onPress}
      style={[
        styles.iconButton,
        { width: diameter, height: diameter },
        variant === 'filled' && styles.iconButtonFilled,
        disabled && styles.disabled,
        style,
      ]}
      pressedStyle={styles.iconButtonPressed}
    >
      <Icon
        size={size === 'sm' ? 16 : size === 'lg' ? 22 : 19}
        color={disabled ? colors.faint : color}
        strokeWidth={1.9}
      />
    </NativePressable>
  );
}

export function Chip({
  label,
  selected = false,
  onPress,
  accessibilityLabel = label,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  icon?: ReactNode;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityState={onPress ? { selected } : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipOn]}
    >
      {icon}
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

export function Input({
  compact = false,
  style,
  onFocus,
  onBlur,
  ...props
}: TextInputProps & { compact?: boolean; ref?: Ref<TextInput> }) {
  // A visible outline at rest and a white one while typing, so fields are easy to find.
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={colors.muted}
      selectionColor={colors.text}
      cursorColor={colors.text}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      style={[styles.input, compact && styles.compactInput, focused && styles.inputFocused, style]}
      {...props}
    />
  );
}

/** The one search field: a 44dp pill with a leading icon (a magnifier by default). */
export function SearchField({
  style,
  containerStyle,
  icon: Icon = Search,
  trailing,
  onFocus,
  onBlur,
  ...props
}: TextInputProps & {
  containerStyle?: StyleProp<ViewStyle>;
  icon?: ComponentType<LucideProps>;
  /** A small control at the end, such as a clear button. */
  trailing?: ReactNode;
}) {
  // Outlined like `Input`: visible at rest, white while typing.
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.searchField, focused && styles.inputFocused, containerStyle]}>
      <Icon size={17} color={focused ? colors.text : colors.muted} strokeWidth={1.9} />
      <TextInput
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        placeholderTextColor={colors.muted}
        selectionColor={colors.text}
        cursorColor={colors.text}
        autoCorrect={false}
        returnKeyType="search"
        hitSlop={{ top: 4, bottom: 4 }}
        style={[styles.searchInput, style]}
        {...props}
      />
      {trailing ??
        // Any typed query can be cleared in one tap.
        (!!props.value && props.onChangeText && (
          <NativePressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={8}
            onPress={() => props.onChangeText?.('')}
            style={styles.searchClear}
            pressedStyle={styles.searchClearPressed}
          >
            <X size={15} color={colors.muted} strokeWidth={2.2} />
          </NativePressable>
        ))}
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: readonly {
    label: string;
    value: T;
    accessibilityLabel?: string;
    icon?: (color: string) => ReactNode;
  }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const stacked = options.some((option) => option.icon);
  const [width, setWidth] = useState(0);
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const segmentWidth = width ? (width - SEGMENT_INSET * 2) / options.length : 0;
  const offset = useSharedValue(index * segmentWidth);
  useEffect(() => {
    offset.set(withTiming(index * segmentWidth, { ...motion, reduceMotion: ReduceMotion.System }));
  }, [index, offset, segmentWidth]);
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.get() }] }));
  return (
    <View
      style={[styles.segmented, stacked && styles.segmentedStacked]}
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width;
        if (next !== width) {
          setWidth(next);
          offset.set(index * ((next - SEGMENT_INSET * 2) / options.length));
        }
      }}
    >
      {segmentWidth > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.segmentThumb,
            stacked && styles.segmentThumbStacked,
            { width: segmentWidth },
            thumbStyle,
          ]}
        />
      )}
      {options.map((option) => {
        const selected = value === option.value;
        const tint = selected ? colors.bg : colors.secondary;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.segment, stacked && styles.stackedSegment, disabled && styles.disabled]}
          >
            {option.icon?.(tint)}
            <Text
              // Large system text wraps a long label ("Watchlist") instead of clipping it.
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
              style={[styles.segmentText, selected && styles.segmentTextOn]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const SEGMENT_INSET = 4;

/** Animated on/off switch. The caller owns the row and the accessibility role. */
export function SwitchIndicator({ value }: { value: boolean }) {
  const progress = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    progress.set(withTiming(value ? 1 : 0, { ...motion, reduceMotion: ReduceMotion.System }));
  }, [progress, value]);
  // Off reads as an outlined, still-active control (not a disabled one); on is solid white.
  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: progress.get() > 0.5 ? colors.text : 'transparent',
    borderColor: progress.get() > 0.5 ? colors.text : colors.control,
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.get() * 20 }],
    backgroundColor: progress.get() > 0.5 ? colors.bg : colors.secondary,
  }));
  return (
    <Animated.View style={[styles.switchTrack, trackStyle]}>
      <Animated.View style={[styles.switchThumb, thumbStyle]} />
    </Animated.View>
  );
}

export function SwitchRow({
  label,
  detail,
  value,
  disabled = false,
  onChange,
  icon,
}: {
  label: string;
  detail?: string;
  value: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  icon?: ReactNode;
}) {
  return (
    <NativePressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={detail}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={styles.listRow}
      pressedStyle={styles.listRowPressed}
    >
      {icon}
      <View style={styles.listRowCopy}>
        <Text style={styles.listRowTitle}>{label}</Text>
        {detail ? <Text style={styles.listRowDetail}>{detail}</Text> : null}
      </View>
      <SwitchIndicator value={value} />
    </NativePressable>
  );
}

/** Tappable row that leads somewhere else, with the current value on the right. */
export function ListRow({
  label,
  value,
  detail,
  icon,
  onPress,
  accessibilityLabel,
  trailing,
  testID,
}: {
  label: string;
  value?: string;
  detail?: string;
  icon?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  trailing?: ReactNode;
  testID?: string;
}) {
  return (
    <NativePressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel ?? (value ? `${label}, ${value}` : label)}
      disabled={!onPress}
      testID={testID}
      onPress={onPress}
      style={styles.listRow}
      pressedStyle={styles.listRowPressed}
    >
      {icon}
      <View style={styles.listRowCopy}>
        <Text style={styles.listRowTitle}>{label}</Text>
        {detail ? <Text style={styles.listRowDetail}>{detail}</Text> : null}
      </View>
      {value ? (
        <Text numberOfLines={1} style={styles.listRowValue}>
          {value}
        </Text>
      ) : null}
      {trailing ??
        (onPress ? <ChevronRight size={18} color={colors.muted} strokeWidth={1.8} /> : null)}
    </NativePressable>
  );
}

/** Rounded container that separates its rows with hairlines. */
export function ListGroup({
  children,
  title,
  inset = 16,
}: {
  children: ReactNode;
  title?: string;
  /** Where hairlines start, so they line up with the row text. */
  inset?: number;
}) {
  const rows = (Array.isArray(children) ? children : [children]).filter(Boolean);
  return (
    <View style={styles.listGroupShell}>
      {title ? <Text style={styles.listGroupTitle}>{title}</Text> : null}
      <View style={styles.listGroup}>
        {rows.map((row, index) => (
          <View key={index}>
            {index > 0 && <View style={[styles.listDivider, { marginLeft: inset }]} />}
            {row}
          </View>
        ))}
      </View>
    </View>
  );
}

/** The one radio mark: a ring that gains a dot when selected. Purely visual; the row
 * that contains it carries the radio role and state. */
export function Radio({ selected }: { selected: boolean }) {
  return (
    <View style={[styles.radio, selected && styles.radioOn]}>
      {selected && <View style={styles.radioDot} />}
    </View>
  );
}

/** Heading for a block of content. Always primary white; counts and actions trail it. */
export function SectionHeading({
  title,
  count,
  action,
  style,
  large = false,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Over large list text, so the heading stays bigger than the rows under it. */
  large?: boolean;
}) {
  return (
    <View style={[styles.sectionHeading, style]}>
      <View style={styles.sectionHeadingCopy}>
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={[styles.sectionHeadingTitle, large && styles.sectionHeadingTitleLarge]}
        >
          {title}
        </Text>
        {count !== undefined && (
          <Text style={[styles.sectionHeadingCount, large && styles.sectionHeadingCountLarge]}>
            {count}
          </Text>
        )}
      </View>
      {action}
    </View>
  );
}

/** A text-only action beside a heading ("See all", "Clear", "Add"), with an optional icon. */
export function TextAction({
  title,
  onPress,
  icon: Icon,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  icon?: ComponentType<LucideProps>;
  accessibilityLabel?: string;
}) {
  return (
    <NativePressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      hitSlop={10}
      onPress={onPress}
      style={styles.textAction}
      pressedStyle={styles.textActionPressed}
    >
      {Icon && <Icon size={14} color={colors.text} strokeWidth={2.2} />}
      <Text style={styles.textActionText}>{title}</Text>
    </NativePressable>
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
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      {detail ? <Text style={styles.statDetail}>{detail}</Text> : null}
    </View>
  );
}

const styles = createAppStyles(
  {
    button: {
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: 'transparent',
    },
    primary: { backgroundColor: colors.accent },
    secondary: { backgroundColor: colors.elevated, borderColor: colors.borderStrong },
    outline: { backgroundColor: 'transparent', borderColor: colors.borderStrong },
    danger: { backgroundColor: 'rgba(229, 103, 95, 0.12)' },
    ghost: { backgroundColor: 'transparent' },
    disabled: { opacity: 0.45 },
    pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
    buttonContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      maxWidth: '100%',
    },
    buttonText: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
      flexShrink: 1,
      textAlign: 'center',
    },
    buttonTextSmall: { fontSize: 13 },
    primaryButtonText: { color: colors.bg },
    dangerButtonText: { color: colors.danger },
    iconButton: {
      flexShrink: 0,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    iconButtonFilled: { backgroundColor: colors.elevated },
    iconButtonPressed: { backgroundColor: colors.elevated },
    chip: {
      flexDirection: 'row',
      gap: 6,
      height: controlHeight.sm,
      borderRadius: radius.pill,
      paddingHorizontal: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.elevated,
    },
    chipOn: { backgroundColor: colors.text },
    chipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    chipTextOn: { color: colors.bg },
    inputFocused: { borderColor: colors.text },
    input: {
      height: controlHeight.lg,
      borderWidth: 1,
      borderColor: colors.control,
      borderRadius: radius.md,
      color: colors.text,
      paddingHorizontal: 16,
      fontSize: 15,
      backgroundColor: colors.surface,
    },
    searchField: {
      flex: 1,
      minWidth: 0,
      height: controlHeight.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingLeft: 16,
      paddingRight: 12,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.control,
      backgroundColor: colors.surface,
    },
    searchClear: {
      width: 28,
      height: 28,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    searchClearPressed: { backgroundColor: colors.elevated },
    searchInput: {
      flex: 1,
      minWidth: 0,
      height: controlHeight.md,
      padding: 0,
      color: colors.text,
      fontSize: 15,
    },
    compactInput: {
      height: controlHeight.md,
      borderRadius: radius.pill,
      borderWidth: 0,
      paddingHorizontal: 18,
    },
    segmented: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderRadius: radius.pill,
      padding: SEGMENT_INSET,
    },
    segmentedStacked: { borderRadius: radius.lg },
    segmentThumb: {
      position: 'absolute',
      top: SEGMENT_INSET,
      bottom: SEGMENT_INSET,
      left: SEGMENT_INSET,
      borderRadius: radius.pill,
      backgroundColor: colors.text,
    },
    segmentThumbStacked: { borderRadius: radius.md },
    segment: {
      flex: 1,
      minHeight: 40,
      paddingVertical: 9,
      paddingHorizontal: 4,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.pill,
    },
    stackedSegment: { minHeight: 60, paddingVertical: 9, gap: 6 },
    segmentText: { color: colors.secondary, fontSize: 13, fontWeight: '600', textAlign: 'center' },
    segmentTextOn: { color: colors.bg },
    switchTrack: {
      width: 46,
      height: 26,
      borderRadius: radius.pill,
      borderWidth: 1.5,
      padding: 1.5,
      justifyContent: 'center',
    },
    switchThumb: { width: 20, height: 20, borderRadius: radius.pill },
    listRow: {
      minHeight: 56,
      borderRadius: radius.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 16,
      paddingVertical: 12,
    },
    listRowPressed: { backgroundColor: colors.elevated },
    listRowCopy: { flex: 1, minWidth: 0, gap: 3 },
    listRowTitle: { ...typeRamp.rowTitle, fontWeight: '500' },
    listRowDetail: { ...typeRamp.meta },
    listRowValue: { color: colors.muted, fontSize: 14, maxWidth: '45%' },
    listGroupShell: { gap: 10 },
    radio: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: colors.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioOn: { borderWidth: 2, borderColor: colors.text },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.text },
    listGroupTitle: { ...typeRamp.sectionTitle, fontSize: 15 },
    listGroup: {
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    },
    listDivider: { height: 1, backgroundColor: colors.border },
    sectionHeading: {
      minHeight: 32,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    sectionHeadingCopy: {
      flexShrink: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 8,
    },
    sectionHeadingTitle: { ...typeRamp.sectionTitle, flexShrink: 1 },
    // Restates the weight: a size-only override would otherwise pick the regular face.
    sectionHeadingTitleLarge: { fontSize: 20, lineHeight: 26, fontWeight: '700' },
    // The count grows with its heading.
    sectionHeadingCountLarge: { fontSize: 17, fontWeight: '500' },
    sectionHeadingCount: {
      color: colors.muted,
      fontSize: 14,
      fontWeight: '500',
      fontVariant: ['tabular-nums'],
    },
    empty: { paddingVertical: 22, alignItems: 'center', gap: 4 },
    textAction: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 28 },
    textActionPressed: { opacity: 0.6 },
    textActionText: { color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: '600' },
    emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
    muted: { color: colors.muted, fontSize: 13, lineHeight: 18, textAlign: 'center' },
    stat: {
      flexGrow: 1,
      flexBasis: '45%',
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      padding: 16,
      gap: 6,
    },
    statValue: {
      color: colors.text,
      fontSize: 24,
      fontWeight: '700',
      letterSpacing: -0.4,
      fontVariant: ['tabular-nums'],
    },
    statLabel: { color: colors.muted, fontSize: 12, fontWeight: '600' },
    statDetail: { color: colors.muted, fontSize: 11 },
  },
  [
    'buttonText',
    'buttonTextSmall',
    'primaryButtonText',
    'dangerButtonText',
    'chipText',
    'chipTextOn',
    'input',
    'searchInput',
    'segmentText',
    'segmentTextOn',
    'listRowTitle',
    'listRowDetail',
    'listRowValue',
    'listGroupTitle',
    'sectionHeadingTitle',
    'sectionHeadingTitleLarge',
    'sectionHeadingCount',
    'sectionHeadingCountLarge',
    'emptyTitle',
    'textActionText',
    'muted',
    'statValue',
    'statLabel',
    'statDetail',
  ] as const,
);
