import { useEffect, useState, type ReactNode } from 'react';
import { BackHandler, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  ReduceMotion,
  SlideInLeft,
  SlideInRight,
  SlideOutLeft,
  SlideOutRight,
} from 'react-native-reanimated';
import Check from 'lucide-react-native/icons/check';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Star from 'lucide-react-native/icons/star';
import { FilterTrigger } from '@/components/FilterSheetParts';
import { NativePressable } from '@/components/ui/NativePressable';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerScrollView,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Button, IconButton, ListRow, Radio } from '@/components/ui/primitives';
import { colors } from '@/constants/colors';
import { radius, typeRamp } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';

type Option<T extends string> = { value: T; label: string };

/** One row on the first page of a filter sheet and the page it opens. */
export type FilterSection =
  | {
      kind: 'single';
      key: string;
      label: string;
      options: readonly Option<string>[];
      value: string;
      defaultValue: string;
      onChange: (value: string) => void;
    }
  | {
      kind: 'multi';
      key: string;
      label: string;
      options: readonly Option<string>[];
      values: readonly string[];
      onChange: (values: string[]) => void;
    }
  | {
      kind: 'rating';
      key: string;
      label: string;
      value: number;
      onChange: (value: number) => void;
    };

const PAGE_MS = 260;
const enterForward = SlideInRight.duration(PAGE_MS).reduceMotion(ReduceMotion.System);
const exitForward = SlideOutLeft.duration(PAGE_MS).reduceMotion(ReduceMotion.System);
const enterBack = SlideInLeft.duration(PAGE_MS).reduceMotion(ReduceMotion.System);
const exitBack = SlideOutRight.duration(PAGE_MS).reduceMotion(ReduceMotion.System);
const resize = LinearTransition.duration(PAGE_MS).reduceMotion(ReduceMotion.System);

export const ratingLabel = (value: number) =>
  value ? (value === 5 ? '5★ only' : `${value}★ & up`) : 'Any rating';

function isDefault(section: FilterSection) {
  if (section.kind === 'single') return section.value === section.defaultValue;
  if (section.kind === 'multi') return section.values.length === 0;
  return section.value === 0;
}

function summary(section: FilterSection) {
  if (section.kind === 'single')
    return section.options.find((option) => option.value === section.value)?.label ?? '';
  if (section.kind === 'multi') {
    if (!section.values.length)
      return `Any ${section.label.toLocaleLowerCase().replace(/s$/u, '')}`;
    if (section.values.length <= 2) return section.values.join(', ');
    return `${section.values.length} selected`;
  }
  return ratingLabel(section.value);
}

function reset(section: FilterSection) {
  if (section.kind === 'single') section.onChange(section.defaultValue);
  else if (section.kind === 'multi') section.onChange([]);
  else section.onChange(0);
}

function OptionRow({
  label,
  selected,
  multi,
  onPress,
  leading,
}: {
  label: string;
  selected: boolean;
  multi: boolean;
  onPress: () => void;
  leading?: ReactNode;
}) {
  return (
    <NativePressable
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityLabel={label}
      // Radios report "checked" too, which is what TalkBack announces for them.
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={s.option}
      pressedStyle={s.optionPressed}
    >
      {leading}
      <Text numberOfLines={2} style={[s.optionLabel, selected && s.optionLabelSelected]}>
        {label}
      </Text>
      {multi ? (
        <View style={[s.checkbox, selected && s.checkboxOn]}>
          {selected && <Check size={14} color={colors.bg} strokeWidth={2.6} />}
        </View>
      ) : (
        <Radio selected={selected} />
      )}
    </NativePressable>
  );
}

function SectionPage({ section }: { section: FilterSection }) {
  if (section.kind === 'rating') {
    return (
      <View accessibilityRole="radiogroup">
        {[0, 1, 2, 3, 4, 5].map((rating) => (
          <OptionRow
            key={rating}
            multi={false}
            label={ratingLabel(rating)}
            selected={section.value === rating}
            onPress={() => section.onChange(rating)}
            leading={
              rating ? (
                <View style={s.stars}>
                  {Array.from({ length: 5 }, (_, index) => (
                    <Star
                      key={index}
                      size={13}
                      color={index < rating ? colors.text : colors.faint}
                      fill={index < rating ? colors.text : 'transparent'}
                      strokeWidth={1.8}
                    />
                  ))}
                </View>
              ) : undefined
            }
          />
        ))}
      </View>
    );
  }
  if (section.kind === 'single') {
    return (
      <View accessibilityRole="radiogroup">
        {section.options.map((option) => (
          <OptionRow
            key={option.value}
            multi={false}
            label={option.label}
            selected={section.value === option.value}
            onPress={() => section.onChange(option.value)}
          />
        ))}
      </View>
    );
  }
  const selected = new Set(section.values);
  if (!section.options.length) return <Text style={s.empty}>Nothing to filter by yet.</Text>;
  return (
    <View>
      {section.options.map((option) => (
        <OptionRow
          key={option.value}
          multi
          label={option.label}
          selected={selected.has(option.value)}
          onPress={() =>
            section.onChange(
              selected.has(option.value)
                ? section.values.filter((value) => value !== option.value)
                : [...section.values, option.value],
            )
          }
        />
      ))}
    </View>
  );
}

/**
 * Filter sheet whose first page lists each filter with its current value. Choosing a row
 * slides in that filter's options, so new filters only add a row instead of more controls.
 */
export function FilterSheet({
  accessibilityLabel,
  title = 'Sort & filter',
  sections,
  resultLabel,
}: {
  accessibilityLabel: string;
  title?: string;
  sections: FilterSection[];
  /** Footer button label, such as "Show 12 titles". */
  resultLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<{ key?: string; forward: boolean }>({ forward: true });
  const active = sections.some((section) => !isDefault(section));
  const current = sections.find((section) => section.key === page.key);
  const go = (key?: string) => setPage({ key, forward: key !== undefined });
  useEffect(() => {
    if (!open || !page.key) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setPage({ forward: false });
      return true;
    });
    return () => subscription.remove();
  }, [open, page.key]);
  const resetTarget = current ? (isDefault(current) ? undefined : current) : undefined;
  const canReset = current ? !!resetTarget : active;

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setPage({ forward: false });
      }}
    >
      <DrawerTrigger asChild>
        <FilterTrigger accessibilityLabel={accessibilityLabel} active={active} />
      </DrawerTrigger>
      <DrawerContent className="max-w-md">
        <View style={s.header}>
          <View style={s.headerSide}>
            {current && (
              <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)}>
                <IconButton
                  icon={ChevronLeft}
                  accessibilityLabel={`Back to ${title.toLocaleLowerCase()}`}
                  onPress={() => go(undefined)}
                />
              </Animated.View>
            )}
          </View>
          <Text accessibilityRole="header" numberOfLines={2} style={s.title}>
            {current?.label ?? title}
          </Text>
          <View style={[s.headerSide, s.headerSideEnd]}>
            {/* Only offered when there is something to reset. */}
            {canReset && (
              <Animated.View
                key={current?.key ?? 'root'}
                entering={FadeIn.duration(160)}
                exiting={FadeOut.duration(120)}
              >
                <NativePressable
                  accessibilityRole="button"
                  accessibilityLabel={current ? `Reset ${current.label}` : 'Reset all'}
                  hitSlop={8}
                  onPress={() => {
                    if (current) reset(current);
                    else sections.forEach(reset);
                  }}
                  style={s.reset}
                  pressedStyle={s.resetPressed}
                >
                  <Text style={s.resetText}>{current ? 'Reset' : 'Reset all'}</Text>
                </NativePressable>
              </Animated.View>
            )}
          </View>
        </View>
        <Animated.View layout={resize} style={s.pages}>
          {current ? (
            <Animated.View
              key={current.key}
              entering={enterForward}
              exiting={exitBack}
              style={s.page}
            >
              <DrawerScrollView
                nestedScrollEnabled
                style={s.pageScroll}
                showsVerticalScrollIndicator={false}
              >
                <SectionPage section={current} />
              </DrawerScrollView>
            </Animated.View>
          ) : (
            <Animated.View
              key="root"
              entering={page.forward ? undefined : enterBack}
              exiting={exitForward}
              style={s.page}
            >
              <View>
                {sections.map((section) => (
                  <ListRow
                    key={section.key}
                    label={section.label}
                    detail={summary(section)}
                    accessibilityLabel={`${section.label}, ${summary(section)}`}
                    onPress={() => go(section.key)}
                    trailing={
                      <View style={s.rowTrailing}>
                        {!isDefault(section) && <View style={s.activeDot} />}
                        <ChevronRight size={18} color={colors.muted} strokeWidth={1.8} />
                      </View>
                    }
                  />
                ))}
              </View>
            </Animated.View>
          )}
        </Animated.View>
        <DrawerClose asChild>
          <Button title={resultLabel ?? 'Done'} size="lg" onPress={() => undefined} />
        </DrawerClose>
      </DrawerContent>
    </Drawer>
  );
}

const s = createAppStyles(
  {
    header: {
      // Grows when the title wraps at large system text.
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: -12,
      marginTop: -8,
      marginBottom: -8,
    },
    headerSide: { width: 96, flexDirection: 'row', alignItems: 'center' },
    headerSideEnd: { justifyContent: 'flex-end' },
    title: { ...typeRamp.sheetTitle, flex: 1, textAlign: 'center' },
    reset: {
      minHeight: 40,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      justifyContent: 'center',
    },
    resetPressed: { backgroundColor: colors.elevated },
    resetText: { color: colors.text, fontSize: 14, fontWeight: '600' },
    pages: { overflow: 'hidden', marginHorizontal: -24 },
    page: { paddingHorizontal: 8 },
    pageScroll: { maxHeight: 420 },
    // The chevron glyph has built-in padding; pull it to the edge the radios end on.
    rowTrailing: { flexDirection: 'row', alignItems: 'center', gap: 10, marginRight: -4 },
    activeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.text },
    option: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      borderRadius: radius.md,
    },
    optionPressed: { backgroundColor: colors.elevated },
    // Unselected options stay white (nothing looks disabled); the radio and weight mark the pick.
    optionLabel: { flex: 1, minWidth: 0, color: colors.text, fontSize: 15, fontWeight: '400' },
    optionLabelSelected: { color: colors.text, fontWeight: '600' },
    stars: { flexDirection: 'row', gap: 2 },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 7,
      borderWidth: 1.5,
      borderColor: colors.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxOn: { backgroundColor: colors.text, borderColor: colors.text },
    empty: { ...typeRamp.meta, paddingHorizontal: 16, paddingVertical: 20 },
  },
  ['title', 'resetText', 'optionLabel', 'optionLabelSelected', 'empty'] as const,
);
