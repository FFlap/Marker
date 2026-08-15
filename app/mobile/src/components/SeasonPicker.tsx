import { useRef } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Check, ChevronDown } from 'lucide-react-native';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { NativePressable } from '@/components/ui/NativePressable';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';

export type SeasonChoice = {
  season: number;
  name?: string;
  episodeCount: number;
};

type SeasonPickerProps = {
  open: boolean;
  value: number;
  options: SeasonChoice[];
  onOpenChange: (open: boolean) => void;
  onChange: (season: number) => void;
};

const seasonLabel = (choice: SeasonChoice) =>
  choice.name || (choice.season === 0 ? 'Specials' : `Season ${choice.season}`);

const seasonDisplayLabel = (choice: SeasonChoice) => {
  const label = seasonLabel(choice);
  if (choice.season === 0 || label.toLocaleLowerCase() === `season ${choice.season}`) return label;
  return `Season ${choice.season} · ${label}`;
};

export function SeasonPicker({ open, value, options, onOpenChange, onChange }: SeasonPickerProps) {
  const menuRef = useRef<ScrollView>(null);
  const positionedForOpen = useRef(false);
  const visibleOptions = options.filter((choice) => choice.season >= 0);
  const selected =
    visibleOptions.find((choice) => choice.season === value) ??
    ({
      season: value,
      name: value === 0 ? 'Specials' : `Season ${value}`,
      episodeCount: 0,
    } as const);
  const selectedIndex = Math.max(
    0,
    visibleOptions.findIndex((choice) => choice.season === value),
  );
  const menuHeight = Math.min(420, visibleOptions.length * 52);

  return (
    <Drawer
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) positionedForOpen.current = false;
        onOpenChange(nextOpen);
      }}
    >
      <View style={s.root}>
        <DrawerTrigger asChild>
          <NativePressable
            accessibilityRole="button"
            accessibilityLabel={`Choose season, current ${seasonLabel(selected)}`}
            accessibilityState={{ expanded: open }}
            style={[s.trigger, open && s.triggerOpen]}
            pressedStyle={s.pressed}
          >
            <Text numberOfLines={1} style={s.value}>
              {seasonDisplayLabel(selected)}
            </Text>
            <ChevronDown
              size={19}
              color={colors.text}
              strokeWidth={1.8}
              style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}
            />
          </NativePressable>
        </DrawerTrigger>
        <DrawerContent className="max-w-xl">
          <DrawerHeader>
            <DrawerTitle>Choose season</DrawerTitle>
          </DrawerHeader>
          <View style={[s.listFrame, { height: menuHeight }]}>
            <ScrollView
              ref={menuRef}
              accessibilityLabel="Season options"
              style={s.list}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              onContentSizeChange={() => {
                if (positionedForOpen.current) return;
                positionedForOpen.current = true;
                menuRef.current?.scrollTo({
                  y: Math.max(0, selectedIndex - 2) * 52,
                  animated: false,
                });
              }}
            >
              {visibleOptions.map((item) => {
                const label = seasonLabel(item);
                const isSelected = item.season === value;
                return (
                  <DrawerClose key={item.season} asChild>
                    <NativePressable
                      accessibilityRole="menuitem"
                      accessibilityLabel={`Select ${label}`}
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => onChange(item.season)}
                      style={[s.option, isSelected && s.optionSelected]}
                      pressedStyle={s.pressed}
                    >
                      <Text numberOfLines={1} style={s.optionTitle}>
                        {seasonDisplayLabel(item)}
                      </Text>
                      {isSelected && <Check size={17} color={colors.text} strokeWidth={2} />}
                    </NativePressable>
                  </DrawerClose>
                );
              })}
            </ScrollView>
          </View>
        </DrawerContent>
      </View>
    </Drawer>
  );
}

const s = createAppStyles(
  {
    root: { position: 'relative' },
    trigger: {
      minHeight: 56,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      paddingHorizontal: 16,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      backgroundColor: colors.surface,
    },
    triggerOpen: {
      borderColor: colors.muted,
      borderBottomLeftRadius: 8,
      borderBottomRightRadius: 8,
    },
    pressed: { opacity: 0.72 },
    value: { flex: 1, minWidth: 0, color: colors.text, fontSize: 15, fontWeight: '600' },
    listFrame: {
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      backgroundColor: colors.bg,
    },
    list: { flex: 1 },
    option: {
      height: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    optionSelected: { backgroundColor: colors.elevated },
    optionTitle: { flex: 1, minWidth: 0, color: colors.text, fontSize: 13, fontWeight: '600' },
  },
  ['value', 'optionTitle'] as const,
);
