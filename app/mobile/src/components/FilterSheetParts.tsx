import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, View, type PressableProps } from 'react-native';
import SlidersHorizontal from 'lucide-react-native/icons/sliders-horizontal';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/theme';

/** Round, transparent filter button with a dot while any filter is applied. */
export const FilterTrigger = forwardRef<
  View,
  PressableProps & { accessibilityLabel: string; active: boolean }
>(function FilterTrigger({ active, onPressIn, onPressOut, ...props }, ref) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      hitSlop={4}
      onPressIn={(event) => {
        setPressed(true);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        setPressed(false);
        onPressOut?.(event);
      }}
      style={[styles.trigger, pressed && styles.pressed]}
      {...props}
    >
      <SlidersHorizontal size={19} color={colors.text} strokeWidth={1.9} />
      {active && <View style={styles.activeDot} />}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  trigger: {
    width: 44,
    height: 44,
    flexShrink: 0,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: colors.elevated },
  activeDot: {
    position: 'absolute',
    right: 9,
    top: 9,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.bg,
    backgroundColor: colors.text,
  },
});
