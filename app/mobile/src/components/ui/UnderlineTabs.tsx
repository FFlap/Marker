import { useEffect, useState, type ComponentType } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import type { LucideProps } from 'lucide-react-native';
import { NativePressable } from '@/components/ui/NativePressable';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';

/** Equal-width tabs with an indicator that slides to the selected tab. */
export function UnderlineTabs<T extends string>({
  tabs,
  value,
  onChange,
  position,
}: {
  tabs: readonly { value: T; label: string; icon?: ComponentType<LucideProps> }[];
  value: T;
  onChange: (value: T) => void;
  /** A pager's fractional position; the indicator then follows swipes 1:1. */
  position?: SharedValue<number>;
}) {
  const [width, setWidth] = useState(0);
  const index = Math.max(
    0,
    tabs.findIndex((tab) => tab.value === value),
  );
  const tabWidth = width / tabs.length;
  const offset = useSharedValue(index * tabWidth);
  useEffect(() => {
    offset.set(
      withTiming(index * tabWidth, {
        duration: 240,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [index, offset, tabWidth]);
  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: position ? position.get() * tabWidth : offset.get() }],
  }));
  return (
    <View
      accessibilityRole="tablist"
      style={s.tabs}
      onLayout={(event) => {
        const next = event.nativeEvent.layout.width;
        setWidth(next);
        offset.set(index * (next / tabs.length));
      }}
    >
      {tabWidth > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[s.indicatorTrack, { width: tabWidth }, indicatorStyle]}
        >
          <View style={s.indicator} />
        </Animated.View>
      )}
      {tabs.map((tab) => {
        const selected = tab.value === value;
        const Icon = tab.icon;
        return (
          <NativePressable
            key={tab.value}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(tab.value)}
            style={s.tab}
            pressedStyle={s.pressed}
          >
            <View style={s.tabContent}>
              {Icon && (
                <Icon
                  size={16}
                  color={selected ? colors.text : colors.muted}
                  strokeWidth={selected ? 2 : 1.8}
                />
              )}
              <Text style={[s.label, selected && s.labelSelected]}>{tab.label}</Text>
            </View>
          </NativePressable>
        );
      })}
    </View>
  );
}

const s = createAppStyles(
  {
    tabs: { flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.border },
    tab: { flex: 1, minWidth: 0, minHeight: 50, alignItems: 'center', justifyContent: 'center' },
    tabContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
    label: { color: colors.muted, fontSize: 14, fontWeight: '600' },
    labelSelected: { color: colors.text },
    indicatorTrack: { position: 'absolute', left: 0, bottom: -1, alignItems: 'center' },
    indicator: { width: '60%', height: 3, borderRadius: 2, backgroundColor: colors.text },
    pressed: { opacity: 0.62 },
  },
  ['label', 'labelSelected'] as const,
);
