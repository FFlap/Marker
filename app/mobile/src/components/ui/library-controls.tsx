import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, Minus, Plus, Search, Star, X } from 'lucide-react-native';
import { NativePressable } from '@/components/ui/NativePressable';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';
import { useKeyboardFieldSpace } from '@/components/ui/KeyboardScrollView';
import { Input } from './primitives';

// Compact controls keep a 44pt touch target through hit slop.
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
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
}) {
  const accessibleLabel = label ? label.toLocaleLowerCase() : 'value';
  const changeBy = (delta: number) => onChange(Math.max(min, Math.min(max, value + delta)));
  return (
    <View style={styles.stepperRow}>
      {label ? <Text style={styles.sectionLabel}>{label}</Text> : null}
      <View style={styles.stepper}>
        <NativePressable
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${accessibleLabel}`}
          accessibilityState={{ disabled: value <= min }}
          disabled={value <= min}
          onPress={() => changeBy(-step)}
          hitSlop={4}
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
          hitSlop={4}
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
      {/* Muted rather than border grey so empty stars stay visible on the dark sheet. */}
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
          <ClearAction label="Clear rating" onPress={() => onChange(undefined)} />
        ) : undefined
      }
    >
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Current rating"
        accessibilityValue={{ text: accessibleValue }}
        style={styles.ratingRow}
      >
        {Array.from({ length: 5 }, (_, index) => {
          const halfRating = index + 0.5;
          const wholeRating = index + 1;
          return (
            <View key={wholeRating} style={styles.ratingButton}>
              <StarGlyph fill={Math.max(0, Math.min(1, starValue - index))} />
              <Pressable
                accessibilityRole="radio"
                accessibilityLabel={`Rate ${halfRating} stars`}
                accessibilityState={{ selected: starValue === halfRating }}
                onPress={() => onChange(halfRating)}
                style={styles.ratingHalfLeft}
              />
              <Pressable
                accessibilityRole="radio"
                accessibilityLabel={`Rate ${wholeRating} ${wholeRating === 1 ? 'star' : 'stars'}`}
                accessibilityState={{ selected: starValue === wholeRating }}
                onPress={() => onChange(wholeRating)}
                style={styles.ratingHalfRight}
              />
            </View>
          );
        })}
      </View>
    </ControlSection>
  );
}

/** Filter by rating: tapping a star keeps titles rated that high or higher. */
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

/** A compact, toggleable tag for filter lists; `exclusive` lists allow one choice. */
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
  // Only offer to create a tag that does not exist yet, under any casing.
  const canCreate =
    query.length > 0 &&
    !unusedSuggestions.some((tag) => normalize(tag) === normalize(query)) &&
    !selectedTags.has(normalize(query));

  const optionCount = matches.length + (canCreate ? 1 : 0);
  // Keep the options list above the keyboard together with the field.
  useKeyboardFieldSpace(optionCount > 0 ? optionCount * TAG_OPTION_HEIGHT + TAG_OPTIONS_GAP : 0);

  const setQuery = (value: string) => {
    setText(value);
    onInputChange?.(value);
  };
  const appendTag = (rawTag: string) => {
    const tag = rawTag.trim();
    if (tag && !selectedTags.has(normalize(tag))) onChange([...tags, tag]);
    setQuery('');
  };

  return (
    <ControlSection label="Tags">
      <View>
        <View style={styles.tagField}>
          <Search size={16} color={colors.muted} strokeWidth={1.8} />
          <Input
            value={text}
            onChangeText={setQuery}
            onSubmitEditing={() => appendTag(text)}
            submitBehavior="submit"
            returnKeyType="done"
            autoCorrect={false}
            placeholder="Add a tag"
            style={styles.tagFieldInput}
          />
          {query.length > 0 && (
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
          )}
        </View>
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
      {query.length === 0 && unusedSuggestions.length > 0 && (
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
    sectionLabel: { color: colors.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.15 },
    accessory: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    accessoryValue: { color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
    clear: { color: colors.text, fontSize: 12, fontWeight: '600' },
    disabled: { opacity: 0.4 },
    stepperRow: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
    },
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      backgroundColor: colors.surface,
    },
    stepButton: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
    stepButtonPressed: { backgroundColor: colors.elevated },
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
    ratingHalfLeft: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 24 },
    ratingHalfRight: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 24 },
    tagField: {
      height: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      backgroundColor: colors.surface,
      paddingLeft: 14,
      paddingRight: 8,
    },
    tagFieldInput: {
      flex: 1,
      height: 46,
      paddingHorizontal: 0,
      borderWidth: 0,
      backgroundColor: 'transparent',
    },
    tagFieldClear: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
    options: {
      marginTop: TAG_OPTIONS_GAP,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
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
      height: 32,
      maxWidth: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 11,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
    },
    tagSelected: { borderColor: colors.text, backgroundColor: colors.text },
    tagOwned: { borderColor: colors.elevated, backgroundColor: colors.elevated },
    tagSuggestion: { borderStyle: 'dashed' },
    tagPressed: { opacity: 0.7 },
    tagText: { flexShrink: 1, color: colors.text, fontSize: 13, fontWeight: '500' },
    tagTextSelected: { color: colors.bg },
    suggestions: { gap: 8 },
    suggestionsLabel: { color: colors.muted, fontSize: 11 },
  },
  [
    'sectionLabel',
    'accessoryValue',
    'clear',
    'stepValue',
    'optionText',
    'optionMatch',
    'tagText',
    'tagTextSelected',
    'suggestionsLabel',
  ] as const,
);
