import type { ComponentProps, ReactNode } from 'react';
import { Text, View } from 'react-native';
import { NativePressable } from '@/components/ui/NativePressable';
import { Radio } from '@/components/ui/primitives';
import { LibraryPageSkeleton } from '@/components/PageSkeletons';
import { LibraryPosterCard, LibraryRow } from '@/features/library/components/LibraryItemCards';
import type { ListTextSize } from '@/lib/displayPreferences';
import type { LibraryItem, Status } from '@/types';
import { tagDetailStyles as s } from '../screens/TagDetailScreen.styles';

export type RankedItem = LibraryItem & { tagRank?: number };

export function VisibilityOption({
  label,
  detail,
  selected,
  disabled,
  icon,
  onPress,
}: {
  label: string;
  detail: string;
  selected: boolean;
  disabled: boolean;
  icon: ReactNode;
  onPress: () => void;
}) {
  return (
    <NativePressable
      accessibilityRole="radio"
      accessibilityLabel={`${label} tag`}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[s.visibilityOption, selected && s.visibilityOptionSelected]}
      pressedStyle={s.pressed}
    >
      <View style={s.visibilityIcon}>{icon}</View>
      <View style={s.visibilityCopy}>
        {/* Like other single-choice lists: the pick is semibold, the rest regular. */}
        <Text style={[s.visibilityLabel, !selected && s.visibilityLabelPlain]}>{label}</Text>
        <Text style={s.visibilityDetail}>{detail}</Text>
      </View>
      <Radio selected={selected} />
    </NativePressable>
  );
}

/** Tag pages use the library's cards; titles only move between sections here. */
export function TagPoster({
  item,
  index,
  rank = index + 1,
  ranked,
  disabled,
  compact,
  onCategoryMove,
}: {
  item: RankedItem;
  index: number;
  rank?: number;
  ranked: boolean;
  disabled: boolean;
  compact?: boolean;
  onCategoryMove: (status: Status) => void;
}) {
  return (
    <LibraryPosterCard
      item={item}
      rank={rank}
      ranked={ranked}
      disabled={disabled}
      compact={compact}
      disabledHint="Clear filters to reorder this tag"
      onCategoryMove={onCategoryMove}
    />
  );
}

export function TagRow({
  item,
  index,
  rank = index + 1,
  ranked,
  disabled,
  textSize,
  contained = false,
  pairHeight,
  onTitleLines,
  onCategoryMove,
}: {
  item: RankedItem;
  index: number;
  rank?: number;
  ranked: boolean;
  disabled: boolean;
  textSize: ListTextSize;
  contained?: boolean;
  pairHeight?: number;
  onTitleLines?: (id: string, lines: number) => void;
  onCategoryMove: (status: Status) => void;
}) {
  return (
    <LibraryRow
      pairHeight={pairHeight}
      onTitleLines={onTitleLines}
      item={item}
      rank={rank}
      ranked={ranked}
      disabled={disabled}
      textSize={textSize}
      contained={contained}
      onCategoryMove={onCategoryMove}
    />
  );
}

export function TagSkeleton(props: ComponentProps<typeof LibraryPageSkeleton>) {
  return <LibraryPageSkeleton accessibilityLabel="Loading tag" {...props} />;
}
