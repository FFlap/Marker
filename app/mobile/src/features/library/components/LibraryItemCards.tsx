import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { NativePressable } from '@/components/ui/NativePressable';
import { PosterImage } from '@/components/ui/PosterImage';
import { colors } from '@/constants/colors';
import { listTypography, type ListTextSize } from '@/lib/displayPreferences';
import { LIBRARY_STATUSES } from '@/lib/libraryFilters';
import { createAppStyles } from '@/lib/typography';
import type { LibraryItem, Status } from '@/types';

const categoryActions = LIBRARY_STATUSES.map(([status, label]) => ({
  name: `moveTo:${status}`,
  label: `Move to ${label}`,
}));

type ReorderProps = {
  disabled: boolean;
  onCategoryMove?: (status: Status) => void;
  onMove: (direction: -1 | 1) => void;
};

function handleReorderAction(
  actionName: string,
  onMove: ReorderProps['onMove'],
  onCategoryMove: ReorderProps['onCategoryMove'],
) {
  if (actionName === 'moveUp') onMove(-1);
  if (actionName === 'moveDown') onMove(1);
  if (actionName.startsWith('moveTo:')) onCategoryMove?.(actionName.slice(7) as Status);
}

export function LibraryPosterCard({
  item,
  rank,
  ranked,
  disabled,
  onCategoryMove,
  onMove = () => undefined,
}: {
  item: LibraryItem;
  rank: number;
  ranked: boolean;
  onMove?: ReorderProps['onMove'];
} & Pick<ReorderProps, 'disabled' | 'onCategoryMove'>) {
  return (
    <NativePressable
      accessibilityRole="button"
      accessibilityLabel={item.title}
      accessibilityHint={
        disabled
          ? 'Clear filters to reorder your library'
          : 'Long press and drag to reorder this title'
      }
      accessibilityActions={
        disabled
          ? undefined
          : [
              { name: 'moveUp', label: 'Move up' },
              { name: 'moveDown', label: 'Move down' },
              ...categoryActions,
            ]
      }
      onAccessibilityAction={(event) =>
        handleReorderAction(event.nativeEvent.actionName, onMove, onCategoryMove)
      }
      onPress={() => router.push(`/item/${item._id}`)}
      style={s.card}
      pressedStyle={s.cardPressed}
    >
      <View pointerEvents="none">
        <PosterImage path={item.posterPath} title={item.title} />
        <Text numberOfLines={2} style={s.cardTitle}>
          {ranked && <Text style={s.rank}>{rank}. </Text>}
          {item.title}
        </Text>
      </View>
    </NativePressable>
  );
}

export function LibraryRow({
  item,
  drag,
  isActive,
  rank,
  ranked,
  disabled,
  onCategoryMove,
  onMove,
  textSize,
  contained = false,
}: {
  item: LibraryItem;
  drag?: () => void;
  isActive?: boolean;
  rank: number;
  ranked: boolean;
  textSize: ListTextSize;
  contained?: boolean;
} & ReorderProps) {
  const typography = listTypography(textSize);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.title}
      accessibilityHint={disabled ? undefined : 'Use accessibility actions to reorder this title'}
      accessibilityActions={
        disabled
          ? undefined
          : [
              { name: 'moveUp', label: 'Move up' },
              { name: 'moveDown', label: 'Move down' },
              ...categoryActions,
            ]
      }
      onAccessibilityAction={(event) =>
        handleReorderAction(event.nativeEvent.actionName, onMove, onCategoryMove)
      }
      onPress={() => router.push(`/item/${item._id}`)}
      onLongPress={disabled ? undefined : drag}
      delayLongPress={220}
      hitSlop={{ top: 7, bottom: 7, left: 0, right: 0 }}
      style={[
        s.row,
        { minHeight: typography.minHeight },
        contained && s.rowContained,
        isActive && s.dragActive,
      ]}
    >
      {ranked && (
        <Text numberOfLines={1} style={s.rowRank}>
          {rank}.
        </Text>
      )}
      <View style={s.rowTitleShell}>
        <Text
          numberOfLines={contained ? 2 : 1}
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
    </Pressable>
  );
}

const s = createAppStyles(
  {
    card: { flex: 1, width: '100%', maxWidth: '100%', minWidth: 0 },
    cardPressed: { opacity: 0.82 },
    cardTitle: {
      color: colors.text,
      fontSize: 12,
      lineHeight: 16,
      marginTop: 6,
      fontWeight: '600',
    },
    rank: { color: colors.muted },
    row: {
      minHeight: 30,
      width: '100%',
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 4,
      borderRadius: 8,
      gap: 8,
      overflow: 'hidden',
    },
    rowContained: { flex: 1, width: '100%' },
    rowRank: {
      color: colors.muted,
      fontSize: 16,
      lineHeight: 22,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
      width: 36,
    },
    rowTitleShell: { flex: 1, minWidth: 0, overflow: 'hidden' },
    rowTitle: {
      color: colors.text,
      fontSize: 16,
      lineHeight: 22,
      fontWeight: '500',
      flexShrink: 1,
    },
    rating: {
      color: colors.text,
      fontSize: 16,
      lineHeight: 22,
      fontVariant: ['tabular-nums'],
      width: 34,
      textAlign: 'right',
    },
    dragActive: {
      backgroundColor: colors.elevated,
      borderWidth: 1,
      borderColor: colors.text,
      borderRadius: 10,
      opacity: 0.96,
      zIndex: 2,
    },
  },
  ['cardTitle', 'rank', 'rowRank', 'rowTitle', 'rating'] as const,
);
