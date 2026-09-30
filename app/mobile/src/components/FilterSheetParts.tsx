import { forwardRef } from 'react';
import { Pressable, StyleSheet, View, type PressableProps } from 'react-native';
import { SlidersHorizontal } from 'lucide-react-native';
import { DrawerClose } from '@/components/ui/drawer';
import { Button } from '@/components/ui/primitives';
import { colors } from '@/constants/colors';

/** Toolbar button that opens a filter sheet; a dot marks active filters. */
export const FilterTrigger = forwardRef<
  View,
  PressableProps & { accessibilityLabel: string; active: boolean }
>(function FilterTrigger({ active, ...props }, ref) {
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      hitSlop={4}
      style={styles.trigger}
      {...props}
    >
      <SlidersHorizontal size={18} color={colors.text} strokeWidth={1.7} />
      {active && <View style={styles.activeDot} />}
    </Pressable>
  );
});

/** Filters apply as they change; the footer resets them or dismisses the sheet. */
export function FilterSheetFooter({ active, onClear }: { active: boolean; onClear: () => void }) {
  return (
    <View style={styles.footer}>
      <View style={styles.footerAction}>
        <Button title="Clear filters" variant="outline" disabled={!active} onPress={onClear} />
      </View>
      <View style={styles.footerAction}>
        <DrawerClose asChild>
          <Button title="Done" onPress={() => undefined} />
        </DrawerClose>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 44,
    height: 44,
    flexShrink: 0,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeDot: {
    position: 'absolute',
    right: 9,
    top: 9,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    borderWidth: 1.5,
    borderColor: colors.bg,
    backgroundColor: colors.text,
  },
  footer: { flexDirection: 'row', gap: 10, marginTop: 4 },
  footerAction: { flex: 1 },
});
