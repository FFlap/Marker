import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Star } from 'lucide-react-native';
import { colors } from '@/constants/colors';
import { createStyles } from '@/lib/typography';
import { Button, Chip, Input } from './primitives';

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
    <View style={styles.stepper}>
      {label ? <Text style={styles.controlLabel}>{label}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${accessibleLabel}`}
        accessibilityState={{ disabled: value <= min }}
        disabled={value <= min}
        onPress={() => changeBy(-step)}
        hitSlop={2}
        style={styles.stepButton}
      >
        <Text style={styles.stepMark}>−</Text>
      </Pressable>
      <Text style={styles.stepValue}>{Number.isInteger(value) ? value : value.toFixed(1)}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Increase ${accessibleLabel}`}
        accessibilityState={{ disabled: value >= max }}
        disabled={value >= max}
        onPress={() => changeBy(step)}
        hitSlop={2}
        style={styles.stepButton}
      >
        <Text style={styles.stepMark}>+</Text>
      </Pressable>
    </View>
  );
}

export function RatingControl({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
}) {
  const starValue = (value ?? 0) / 2;
  const accessibleValue =
    value === undefined
      ? 'Not rated'
      : `${Number.isInteger(starValue) ? starValue : starValue.toFixed(1)} out of 5 stars`;
  return (
    <View>
      <View style={styles.controlHead}>
        <Text style={styles.controlLabel}>Your Rating</Text>
        {value !== undefined ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear rating"
            hitSlop={15}
            onPress={() => onChange(undefined)}
          >
            <Text style={styles.clear}>Clear</Text>
          </Pressable>
        ) : null}
      </View>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Current rating"
        accessibilityValue={{ text: accessibleValue }}
        style={styles.ratingRow}
      >
        {Array.from({ length: 5 }, (_, index) => {
          const fill = Math.max(0, Math.min(1, starValue - index));
          const halfRating = index + 0.5;
          const wholeRating = index + 1;
          return (
            <View key={wholeRating} style={styles.ratingButton}>
              <View pointerEvents="none" style={styles.ratingStar}>
                <Star size={28} color={colors.muted} strokeWidth={1.6} />
                {fill > 0 ? (
                  <View
                    pointerEvents="none"
                    style={[styles.ratingStarFill, { width: `${fill * 100}%` }]}
                  >
                    <Star size={28} color={colors.accent} fill={colors.accent} strokeWidth={1.6} />
                  </View>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="radio"
                accessibilityLabel={`Rate ${halfRating} stars`}
                accessibilityState={{ selected: starValue === halfRating }}
                onPress={() => onChange(halfRating * 2)}
                style={styles.ratingHalfLeft}
              />
              <Pressable
                accessibilityRole="radio"
                accessibilityLabel={`Rate ${wholeRating} ${wholeRating === 1 ? 'star' : 'stars'}`}
                accessibilityState={{ selected: starValue === wholeRating }}
                onPress={() => onChange(wholeRating * 2)}
                style={styles.ratingHalfRight}
              />
            </View>
          );
        })}
      </View>
    </View>
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
  const selectedTags = new Set(tags.map((tag) => tag.trim().toLocaleLowerCase()));
  const [text, setText] = useState('');
  const add = () => {
    const tag = text.trim();
    if (tag && !selectedTags.has(tag.toLocaleLowerCase())) onChange([...tags, tag]);
    setText('');
    onInputChange?.('');
  };
  return (
    <View>
      <Text style={styles.controlLabel}>Tags</Text>
      <View style={styles.tagInput}>
        <Input
          value={text}
          onChangeText={(value) => {
            setText(value);
            onInputChange?.(value);
          }}
          onSubmitEditing={add}
          placeholder="Add a tag"
          style={styles.tagTextInput}
        />
        <Button title="Add" onPress={add} variant="ghost" />
      </View>
      <View style={styles.wrap}>
        {tags.map((tag) => (
          <Chip
            key={tag}
            label={`${tag} ×`}
            onPress={() => onChange(tags.filter((candidate) => candidate !== tag))}
          />
        ))}
        {suggestions
          .filter((tag) => !selectedTags.has(tag.trim().toLocaleLowerCase()))
          .slice(0, 5)
          .map((tag) => (
            <Chip key={tag} label={`+ ${tag}`} onPress={() => onChange([...tags, tag])} />
          ))}
      </View>
    </View>
  );
}

const styles = createStyles({
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepMark: { color: colors.text, fontSize: 22 },
  stepValue: {
    color: colors.text,
    fontSize: 18,
    fontVariant: ['tabular-nums'],
    minWidth: 40,
    textAlign: 'center',
  },
  controlHead: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  controlLabel: {
    color: colors.muted,
    fontSize: 12,
    letterSpacing: 0.15,
    marginBottom: 10,
  },
  clear: { color: colors.accent, fontSize: 12 },
  ratingRow: { flexDirection: 'row', justifyContent: 'center', gap: 4 },
  ratingButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  ratingStar: { width: 28, height: 28 },
  ratingStarFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: 28,
    overflow: 'hidden',
  },
  ratingHalfLeft: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 22 },
  ratingHalfRight: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 22 },
  tagInput: { flexDirection: 'row', alignItems: 'center' },
  tagTextInput: { flex: 1, borderWidth: 0 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
});
