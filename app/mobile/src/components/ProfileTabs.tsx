import { Text, View } from 'react-native';
import { ChartNoAxesColumn, Library } from 'lucide-react-native';
import { NativePressable } from '@/components/ui/NativePressable';
import { colors } from '@/constants/colors';
import { createStyles } from '@/lib/typography';

export type ProfileTab = 'collection' | 'stats';

const tabs: { value: ProfileTab; label: string }[] = [
  { value: 'collection', label: 'Collection' },
  { value: 'stats', label: 'Stats' },
];

export function ProfileTabs({
  value,
  onChange,
}: {
  value: ProfileTab;
  onChange: (value: ProfileTab) => void;
}) {
  return (
    <View accessibilityRole="tablist" style={s.tabs}>
      {tabs.map((tab) => {
        const selected = tab.value === value;
        const Icon = tab.value === 'collection' ? Library : ChartNoAxesColumn;
        return (
          <NativePressable
            key={tab.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(tab.value)}
            style={s.tab}
            pressedStyle={s.pressed}
          >
            <View style={s.tabContent}>
              <Icon
                size={16}
                color={selected ? colors.text : colors.muted}
                strokeWidth={selected ? 2 : 1.7}
              />
              <Text style={[s.label, selected && s.labelSelected]}>{tab.label}</Text>
            </View>
            {selected && <View style={s.indicator} />}
          </NativePressable>
        );
      })}
    </View>
  );
}

const s = createStyles({
  tabs: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderColor: colors.border,
    marginBottom: 32,
  },
  tab: {
    flex: 1,
    minWidth: 0,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  tabContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  label: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  labelSelected: { color: colors.text, fontWeight: '700' },
  indicator: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -1,
    height: 2,
    backgroundColor: colors.text,
  },
  pressed: { opacity: 0.62 },
});
