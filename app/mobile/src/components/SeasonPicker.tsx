import { useRef } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
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
import { availableSeasons, type SeasonChoice } from '@/features/title/seasons';

type SeasonPickerProps = {
  open: boolean;
  value: number;
  options: SeasonChoice[];
  onOpenChange: (open: boolean) => void;
  onChange: (season: number) => void;
};

const seasonLabel = (choice: SeasonChoice) =>
  choice.name || (choice.season === 0 ? 'Specials' : `Season ${choice.season}`);

const SEASON_ROW_HEIGHT = 64;
// Drawer content is inset by 24pt; the season rows cancel it so they span the sheet.
const SHEET_INSET = 24;

const episodeCountLabel = (count: number) => `${count} ${count === 1 ? 'episode' : 'episodes'}`;
const seasonCountLabel = (choice: SeasonChoice) =>
  choice.episodeCountVerified === false
    ? 'Episodes pending'
    : episodeCountLabel(choice.episodeCount);

const seasonDisplayLabel = (choice: SeasonChoice) => {
  const label = seasonLabel(choice);
  if (choice.season === 0 || label.toLocaleLowerCase() === `season ${choice.season}`) return label;
  return `Season ${choice.season} · ${label}`;
};

export function SeasonPicker({ open, value, options, onOpenChange, onChange }: SeasonPickerProps) {
  const menuRef = useRef<ScrollView>(null);
  const positionedForOpen = useRef(false);
  const { height: windowHeight } = useWindowDimensions();
  const visibleOptions = availableSeasons(options);
  const selected = visibleOptions.find((choice) => choice.season === value) ?? visibleOptions[0];
  if (!selected) return null;
  const selectedIndex = Math.max(
    0,
    visibleOptions.findIndex((choice) => choice.season === value),
  );
  const menuHeight = Math.min(windowHeight * 0.6, visibleOptions.length * SEASON_ROW_HEIGHT);

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
            style={s.trigger}
            pressedStyle={s.pressed}
          >
            <Text numberOfLines={1} style={s.value}>
              {seasonDisplayLabel(selected)}
            </Text>
            <ChevronDown
              size={15}
              color={colors.muted}
              strokeWidth={2}
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
                  y: Math.max(0, selectedIndex - 2) * SEASON_ROW_HEIGHT,
                  animated: false,
                });
              }}
            >
              {visibleOptions.map((item, index) => {
                const label = seasonLabel(item);
                const isSelected = item.season === value;
                return (
                  <DrawerClose key={item.season} asChild>
                    <NativePressable
                      accessibilityRole="menuitem"
                      accessibilityLabel={`Select ${label}`}
                      accessibilityHint={seasonCountLabel(item)}
                      accessibilityState={{ selected: isSelected }}
                      onPress={() => onChange(item.season)}
                      style={[
                        s.option,
                        index > 0 && s.optionDivider,
                        isSelected && s.optionSelected,
                      ]}
                      pressedStyle={s.optionPressed}
                    >
                      <View style={s.optionCopy}>
                        <Text numberOfLines={1} style={s.optionTitle}>
                          {seasonDisplayLabel(item)}
                        </Text>
                        <Text style={s.optionMeta}>{seasonCountLabel(item)}</Text>
                      </View>
                      {isSelected && <Check size={18} color={colors.text} strokeWidth={2} />}
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
    // A heading you can tap, rather than a boxed field, so it sits with the section titles.
    trigger: {
      minHeight: 44,
      maxWidth: '100%',
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    pressed: { opacity: 0.6 },
    value: { flexShrink: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
    listFrame: { marginHorizontal: -SHEET_INSET, overflow: 'hidden' },
    list: { flex: 1 },
    option: {
      height: SEASON_ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      paddingHorizontal: SHEET_INSET,
    },
    optionDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    optionSelected: { backgroundColor: colors.surface },
    optionPressed: { backgroundColor: colors.elevated },
    optionCopy: { flex: 1, minWidth: 0, gap: 3 },
    optionTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
    optionMeta: { color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  },
  ['value', 'optionTitle', 'optionMeta'] as const,
);
