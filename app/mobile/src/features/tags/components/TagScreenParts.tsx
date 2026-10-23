import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { NativePressable } from '@/components/ui/NativePressable';
import { PosterImage } from '@/components/ui/PosterImage';
import { SkeletonShimmer } from '@/components/SkeletonShimmer';
import { listTypography, type ListTextSize } from '@/lib/displayPreferences';
import { LIBRARY_STATUSES } from '@/lib/libraryFilters';
import type { LibraryItem, Status } from '@/types';
import { tagDetailStyles as s } from '../screens/TagDetailScreen.styles';

export type RankedItem = LibraryItem & { tagRank?: number };
const categoryAccessibilityActions = LIBRARY_STATUSES.map(([status, label]) => ({
  name: `moveTo:${status}`,
  label: `Move to ${label}`,
}));
const statusFromAccessibilityAction = (name: string) => {
  if (!name.startsWith('moveTo:')) return undefined;
  const target = name.slice('moveTo:'.length) as Status;
  return new Set<Status>(LIBRARY_STATUSES.map(([status]) => status)).has(target)
    ? target
    : undefined;
};

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
        <Text style={s.visibilityLabel}>{label}</Text>
        <Text style={s.visibilityDetail}>{detail}</Text>
      </View>
      <View style={[s.radio, selected && s.radioSelected]} />
    </NativePressable>
  );
}

export function TagPoster({
  item,
  index,
  ranked,
  disabled,
  onCategoryMove,
}: {
  item: RankedItem;
  index: number;
  ranked: boolean;
  disabled: boolean;
  onCategoryMove: (status: Status) => void;
}) {
  return (
    <NativePressable
      accessibilityRole="button"
      accessibilityLabel={`${ranked ? `${index + 1}. ` : ''}${item.title}`}
      accessibilityHint={disabled ? undefined : 'Long press and drag to reorder'}
      accessibilityActions={disabled ? undefined : categoryAccessibilityActions}
      onAccessibilityAction={(event) => {
        const target = statusFromAccessibilityAction(event.nativeEvent.actionName);
        if (target && target !== item.status) onCategoryMove(target);
      }}
      onPress={() => router.push(`/item/${item._id}`)}
      style={s.card}
      pressedStyle={s.pressed}
    >
      <PosterImage path={item.posterPath} title={item.title} style={s.poster} />
      <Text numberOfLines={2} style={s.cardTitle}>
        {ranked && <Text style={s.rank}>{index + 1}. </Text>}
        {item.title}
      </Text>
    </NativePressable>
  );
}

export function TagRow({
  item,
  index,
  ranked,
  disabled,
  textSize,
  contained = false,
  onCategoryMove,
}: {
  item: RankedItem;
  index: number;
  ranked: boolean;
  disabled: boolean;
  textSize: ListTextSize;
  contained?: boolean;
  onCategoryMove: (status: Status) => void;
}) {
  const typography = listTypography(textSize);
  return (
    <NativePressable
      accessibilityRole="button"
      accessibilityLabel={`${ranked ? `${index + 1}. ` : ''}${item.title}`}
      accessibilityHint={disabled ? undefined : 'Long press and drag to reorder'}
      accessibilityActions={disabled ? undefined : categoryAccessibilityActions}
      onAccessibilityAction={(event) => {
        const target = statusFromAccessibilityAction(event.nativeEvent.actionName);
        if (target && target !== item.status) onCategoryMove(target);
      }}
      onPress={() => router.push(`/item/${item._id}`)}
      style={[s.row, { minHeight: typography.minHeight }, contained && s.rowContained]}
      pressedStyle={s.pressed}
    >
      {ranked && <Text style={s.rowRank}>{index + 1}.</Text>}
      <View style={s.rowTitleShell}>
        <Text
          numberOfLines={contained ? 2 : 1}
          ellipsizeMode="tail"
          style={[s.rowTitle, { fontSize: typography.fontSize, lineHeight: typography.lineHeight }]}
        >
          {item.title}
        </Text>
      </View>
      {item.rating !== undefined && (
        <Text
          style={[s.rating, { fontSize: typography.fontSize, lineHeight: typography.lineHeight }]}
        >
          {item.rating.toFixed(1)}
        </Text>
      )}
    </NativePressable>
  );
}

export function TagSkeleton() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading tag" style={s.loading}>
      {[0, 1, 2, 3].map((index) => (
        <View key={index} style={s.skeletonRow}>
          <View style={s.skeletonTitle}>
            <SkeletonShimmer />
          </View>
          <View style={s.skeletonRating}>
            <SkeletonShimmer />
          </View>
        </View>
      ))}
    </View>
  );
}
