import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Check from 'lucide-react-native/icons/check';
import Minus from 'lucide-react-native/icons/minus';
import Plus from 'lucide-react-native/icons/plus';
import TagIcon from 'lucide-react-native/icons/tag';
import Star from 'lucide-react-native/icons/star';
import X from 'lucide-react-native/icons/x';
import { NativePressable } from '@/components/ui/NativePressable';
import { colors } from '@/constants/colors';
import { radius, typeRamp } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';
import { useKeyboardFieldSpace } from '@/components/ui/KeyboardScrollView';
import { SearchField } from './primitives';

const TAG_HIT_SLOP = { top: 6, bottom: 6, left: 2, right: 2 };
const MAX_TAG_MATCHES = 5;
const TAG_OPTION_HEIGHT = 46;
const TAG_OPTIONS_GAP = 6;
const MAX_TAG_SUGGESTIONS = 6;

export function ControlSection({
  label,
  accessory,
  children,
}: {
  label: string;
  accessory?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionLabel}>{label}</Text>
        {accessory}
      </View>
      {children}
    </View>
  );
}

export function Stepper({
  value,
  onChange,
  min = 0,
  max = 99,
  step = 1,
  label,
  icon,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  /** Leading icon, so the row lines up with icon rows above or below it. */
  icon?: ReactNode;
}) {
  const accessibleLabel = label ? label.toLocaleLowerCase() : 'value';
  const changeBy = (delta: number) => onChange(Math.max(min, Math.min(max, value + delta)));
  return (
    <View style={styles.stepperRow}>
      {label ? (
        <View style={styles.stepperLead}>
          {icon}
          <Text style={styles.stepperLabel}>{label}</Text>
        </View>
      ) : null}
      <View style={styles.stepper}>
        <NativePressable
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${accessibleLabel}`}
          accessibilityState={{ disabled: value <= min }}
          disabled={value <= min}
          onPress={() => changeBy(-step)}
          style={[styles.stepButton, value <= min && styles.disabled]}
          pressedStyle={styles.stepButtonPressed}
        >
          <Minus size={16} color={colors.text} strokeWidth={2} />
        </NativePressable>
        <Text style={styles.stepValue}>{Number.isInteger(value) ? value : value.toFixed(1)}</Text>
        <NativePressable
          accessibilityRole="button"
          accessibilityLabel={`Increase ${accessibleLabel}`}
          accessibilityState={{ disabled: value >= max }}
          disabled={value >= max}
          onPress={() => changeBy(step)}
          style={[styles.stepButton, value >= max && styles.disabled]}
          pressedStyle={styles.stepButtonPressed}
        >
          <Plus size={16} color={colors.text} strokeWidth={2} />
        </NativePressable>
      </View>
    </View>
  );
}

function StarGlyph({ fill }: { fill: number }) {
  return (
    <View pointerEvents="none" style={styles.ratingStar}>
      <Star size={30} color={colors.muted} strokeWidth={1.6} />
      {fill > 0 ? (
        <View pointerEvents="none" style={[styles.ratingStarFill, { width: `${fill * 100}%` }]}>
          <Star size={30} color={colors.accent} fill={colors.accent} strokeWidth={1.6} />
        </View>
      ) : null}
    </View>
  );
}

function ClearAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={15} onPress={onPress}>
      <Text style={styles.clear}>Clear</Text>
    </Pressable>
  );
}

const formatRating = (value: number) => (Number.isInteger(value) ? value : value.toFixed(1));

export function RatingControl({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  const starValue = value ?? 0;
  const accessibleValue =
    value === undefined ? 'Not rated' : `${formatRating(starValue)} out of 5 stars`;
  return (
    <ControlSection
      label="Rating"
      accessory={
        value !== undefined ? (
          <View style={styles.accessory}>
            <Text style={styles.ratingValue}>★ {formatRating(starValue)}</Text>
            <ClearAction label="Clear rating" onPress={() => onChange(undefined)} />
          </View>
        ) : undefined
      }
    >
      {/* One full-size target per star. Tapping the selected star again takes off half a
          star, so half ratings never depend on hitting the left or right edge. */}
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Current rating"
        accessibilityValue={{ text: accessibleValue }}
        style={styles.ratingRow}
      >
        {Array.from({ length: 5 }, (_, index) => {
          const wholeRating = index + 1;
          const halfRating = index + 0.5;
          const onThisStar = starValue === wholeRating || starValue === halfRating;
          // What activating this star sets: the selected whole star steps down to its half.
          const target = starValue === wholeRating ? halfRating : wholeRating;
          return (
            <Pressable
              key={wholeRating}
              accessibilityRole="radio"
              accessibilityLabel={`Rate ${formatRating(target)} ${target === 1 ? 'star' : 'stars'}`}
              // The picked star says the exact rating, half stars included ("3.5 stars").
              accessibilityState={{ checked: onThisStar }}
              accessibilityValue={
                onThisStar ? { text: `${formatRating(starValue)} stars` } : undefined
              }
              onPress={() => onChange(target)}
              style={styles.ratingButton}
            >
              <StarGlyph fill={Math.max(0, Math.min(1, starValue - index))} />
            </Pressable>
          );
        })}
      </View>
      {/* Always shown: half stars stay discoverable after the first rating. */}
      <Text style={styles.ratingHint}>Tap a star twice for a half star.</Text>
    </ControlSection>
  );
}

export function MinimumRatingControl({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <ControlSection
      label="Minimum rating"
      accessory={
        <View style={styles.accessory}>
          <Text style={styles.accessoryValue}>{value ? `${value}★ and up` : 'Any rating'}</Text>
          {value ? <ClearAction label="Any rating" onPress={() => onChange(0)} /> : null}
        </View>
      }
    >
      <View accessibilityRole="radiogroup" style={styles.ratingRow}>
        {Array.from({ length: 5 }, (_, index) => {
          const rating = index + 1;
          return (
            <Pressable
              key={rating}
              accessibilityRole="radio"
              accessibilityLabel={`${rating} ${rating === 1 ? 'star' : 'stars'} and up`}
              accessibilityState={{ selected: value === rating }}
              onPress={() => onChange(value === rating ? 0 : rating)}
              style={styles.ratingButton}
            >
              <StarGlyph fill={rating <= value ? 1 : 0} />
            </Pressable>
          );
        })}
      </View>
    </ControlSection>
  );
}

export function SelectableTag({
  label,
  selected,
  exclusive = false,
  onPress,
}: {
  label: string;
  selected: boolean;
  exclusive?: boolean;
  onPress: () => void;
}) {
  return (
    <NativePressable
      accessibilityRole={exclusive ? 'radio' : 'checkbox'}
      accessibilityLabel={label}
      accessibilityState={exclusive ? { selected } : { checked: selected }}
      hitSlop={TAG_HIT_SLOP}
      onPress={onPress}
      style={[styles.tag, selected && styles.tagSelected]}
      pressedStyle={styles.tagPressed}
    >
      {selected ? <Check size={13} color={colors.bg} strokeWidth={2.4} /> : null}
      <Text numberOfLines={1} style={[styles.tagText, selected && styles.tagTextSelected]}>
        {label}
      </Text>
    </NativePressable>
  );
}

function MatchedTagLabel({ tag, query }: { tag: string; query: string }) {
  const index = tag.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (query.length === 0 || index < 0) {
    return (
      <Text numberOfLines={1} style={styles.optionText}>
        {tag}
      </Text>
    );
  }
  return (
    <Text numberOfLines={1} style={styles.optionText}>
      {tag.slice(0, index)}
      <Text style={styles.optionMatch}>{tag.slice(index, index + query.length)}</Text>
      {tag.slice(index + query.length)}
    </Text>
  );
}

/** Matches the server: at most 20 tags per title or episode, each up to 40 characters. */
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;

/**
 * Tags plus a tag still typed in the field, so closing a sheet or saving doesn't drop it. Only
 * a whole tag counts: an existing tag typed in full, or new text that matches no existing tag.
 * Text that only partly matches an existing tag was a search, and is left out — as is any text
 * while the existing tags for it are still loading (`suggestions` undefined), since it can't be
 * told apart yet.
 */
export function withPendingTag(
  tags: string[],
  pending: string,
  suggestions: readonly string[] | undefined,
) {
  const typed = pending.trim().slice(0, MAX_TAG_LENGTH);
  const key = typed.toLocaleLowerCase();
  if (!typed || tags.length >= MAX_TAGS || !suggestions) return tags;
  const existing = suggestions.find((tag) => tag.trim().toLocaleLowerCase() === key);
  if (!existing && suggestions.some((tag) => tag.toLocaleLowerCase().includes(key))) return tags;
  const tag = existing?.trim() ?? typed;
  if (tags.some((entry) => entry.trim().toLocaleLowerCase() === tag.toLocaleLowerCase()))
    return tags;
  return [...tags, tag];
}

export function TagEditor({
  tags,
  onChange,
  suggestions = [],
  onInputChange,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  onInputChange?: (value: string) => void;
}) {
  const normalize = (tag: string) => tag.trim().toLocaleLowerCase();
  const selectedTags = new Set(tags.map(normalize));
  const [text, setText] = useState('');
  const query = text.trim();
  const unusedSuggestions = suggestions.filter((tag) => !selectedTags.has(normalize(tag)));
  const matches = query
    ? unusedSuggestions
        .filter((tag) => normalize(tag).includes(normalize(query)))
        .slice(0, MAX_TAG_MATCHES)
    : [];
  const canCreate =
    query.length > 0 &&
    !unusedSuggestions.some((tag) => normalize(tag) === normalize(query)) &&
    !selectedTags.has(normalize(query));

  const optionCount = tags.length >= MAX_TAGS ? 0 : matches.length + (canCreate ? 1 : 0);
  useKeyboardFieldSpace(optionCount > 0 ? optionCount * TAG_OPTION_HEIGHT + TAG_OPTIONS_GAP : 0);

  const setQuery = (value: string) => {
    setText(value);
    onInputChange?.(value);
  };
  // The server's limits, applied here so a save never fails on them.
  const full = tags.length >= MAX_TAGS;
  const appendTag = (rawTag: string) => {
    const tag = rawTag.trim().slice(0, MAX_TAG_LENGTH);
    if (tag && !full && !selectedTags.has(normalize(tag))) onChange([...tags, tag]);
    setQuery('');
  };

  return (
    <ControlSection label="Tags">
      <View>
        <SearchField
          icon={TagIcon}
          containerStyle={styles.tagField}
          value={text}
          onChangeText={setQuery}
          onSubmitEditing={() => appendTag(text)}
          submitBehavior="submit"
          returnKeyType="done"
          maxLength={MAX_TAG_LENGTH}
          editable={!full}
          placeholder={full ? `Up to ${MAX_TAGS} tags` : 'Add a tag'}
          trailing={
            query.length > 0 ? (
              <NativePressable
                accessibilityRole="button"
                accessibilityLabel="Clear tag search"
                hitSlop={10}
                onPress={() => setQuery('')}
                style={styles.tagFieldClear}
                pressedStyle={styles.tagPressed}
              >
                <X size={15} color={colors.muted} strokeWidth={2} />
              </NativePressable>
            ) : undefined
          }
        />
        {optionCount > 0 && (
          <View accessibilityLabel="Tag suggestions" style={styles.options}>
            {matches.map((tag, index) => (
              <NativePressable
                key={tag}
                accessibilityRole="button"
                accessibilityLabel={`Add ${tag} tag`}
                onPress={() => appendTag(tag)}
                style={[styles.option, index > 0 && styles.optionDivider]}
                pressedStyle={styles.optionPressed}
              >
                <MatchedTagLabel tag={tag} query={query} />
                <Plus size={18} color={colors.muted} strokeWidth={2} />
              </NativePressable>
            ))}
            {canCreate && (
              <NativePressable
                accessibilityRole="button"
                accessibilityLabel={`Create tag ${query}`}
                onPress={() => appendTag(query)}
                style={[styles.option, matches.length > 0 && styles.optionDivider]}
                pressedStyle={styles.optionPressed}
              >
                <Text numberOfLines={1} style={styles.optionText}>
                  Create <Text style={styles.optionMatch}>{query}</Text>
                </Text>
                <Plus size={18} color={colors.text} strokeWidth={2} />
              </NativePressable>
            )}
          </View>
        )}
      </View>
      {tags.length > 0 && (
        <View style={styles.wrap}>
          {tags.map((tag) => (
            <NativePressable
              key={tag}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${tag} tag`}
              hitSlop={TAG_HIT_SLOP}
              onPress={() =>
                onChange(tags.filter((candidate) => normalize(candidate) !== normalize(tag)))
              }
              style={[styles.tag, styles.tagOwned]}
              pressedStyle={styles.tagPressed}
            >
              <Text numberOfLines={1} style={styles.tagText}>
                {tag}
              </Text>
              <X size={13} color={colors.muted} strokeWidth={2.2} />
            </NativePressable>
          ))}
        </View>
      )}
      {/* At the limit nothing more can be added, so suggestions would do nothing. */}
      {!full && query.length === 0 && unusedSuggestions.length > 0 && (
        <View style={styles.suggestions}>
          <Text style={styles.suggestionsLabel}>Suggested</Text>
          <View style={styles.wrap}>
            {unusedSuggestions.slice(0, MAX_TAG_SUGGESTIONS).map((tag) => (
              <NativePressable
                key={tag}
                accessibilityRole="button"
                accessibilityLabel={`Add ${tag} tag`}
                hitSlop={TAG_HIT_SLOP}
                onPress={() => appendTag(tag)}
                style={[styles.tag, styles.tagSuggestion]}
                pressedStyle={styles.tagPressed}
              >
                <Plus size={13} color={colors.muted} strokeWidth={2} />
                <Text numberOfLines={1} style={styles.tagText}>
                  {tag}
                </Text>
              </NativePressable>
            ))}
          </View>
        </View>
      )}
    </ControlSection>
  );
}

const styles = createAppStyles(
  {
    section: { gap: 12 },
    sectionHead: {
      minHeight: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    sectionLabel: { ...typeRamp.sectionTitle, fontSize: 15 },
    stepperLabel: { ...typeRamp.rowTitle, fontWeight: '500' },
    stepperLead: { flexDirection: 'row', alignItems: 'center', gap: 14, flexShrink: 1 },
    accessory: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    accessoryValue: { color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
    clear: { color: colors.text, fontSize: 13, fontWeight: '600' },
    disabled: { opacity: 0.4 },
    stepperRow: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
    },
    // The buttons fill the pill: each is a full 44dp target (a parent clips hit slop).
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: radius.pill,
      backgroundColor: colors.elevated,
    },
    stepButton: {
      width: 44,
      height: 44,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepButtonPressed: { backgroundColor: colors.borderStrong },
    stepValue: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
      minWidth: 32,
      textAlign: 'center',
    },
    ratingRow: { flexDirection: 'row', justifyContent: 'center' },
    ratingButton: { width: 48, height: 44, alignItems: 'center', justifyContent: 'center' },
    ratingStar: { width: 30, height: 30 },
    ratingStarFill: { position: 'absolute', left: 0, top: 0, height: 30, overflow: 'hidden' },
    ratingValue: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    ratingHint: { ...typeRamp.meta, marginTop: -4, textAlign: 'center' },

    tagField: { flex: 0 },
    tagFieldClear: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    options: {
      marginTop: TAG_OPTIONS_GAP,
      overflow: 'hidden',
      borderRadius: radius.md,
      backgroundColor: colors.surface,
    },
    option: {
      height: TAG_OPTION_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingHorizontal: 14,
    },
    optionDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    optionPressed: { backgroundColor: colors.elevated },
    optionText: { flexShrink: 1, color: colors.muted, fontSize: 14 },
    optionMatch: { color: colors.text, fontWeight: '600' },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    tag: {
      height: 34,
      maxWidth: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 13,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: radius.pill,
    },
    tagSelected: { borderColor: colors.text, backgroundColor: colors.text },
    tagOwned: { borderColor: colors.elevated, backgroundColor: colors.elevated },
    tagSuggestion: { borderColor: colors.borderStrong },
    tagPressed: { opacity: 0.7 },
    tagText: { flexShrink: 1, color: colors.text, fontSize: 13, fontWeight: '500' },
    tagTextSelected: { color: colors.bg },
    suggestions: { gap: 8 },
    suggestionsLabel: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  },
  [
    'sectionLabel',
    'stepperLabel',
    'accessoryValue',
    'clear',
    'stepValue',
    'optionText',
    'optionMatch',
    'tagText',
    'tagTextSelected',
    'suggestionsLabel',
    'ratingValue',
    'ratingHint',
  ] as const,
);
