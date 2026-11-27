import { useCallback, useState } from 'react';
import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { NativePressable } from '@/components/ui/NativePressable';
import { PosterBadges } from '@/components/ui/PosterBadges';
import { PosterCaption } from '@/components/ui/PosterCaption';
import { PosterImage } from '@/components/ui/PosterImage';
import { colors } from '@/constants/colors';
import { listTypography, type ListTextSize } from '@/lib/displayPreferences';
import { LIBRARY_STATUSES } from '@/lib/libraryFilters';
import { captionCharsPerLine } from '@/lib/text';
import { createAppStyles } from '@/lib/typography';
import type { LibraryItem, Status } from '@/types';

const categoryActions = LIBRARY_STATUSES.map(([status, label]) => ({
  name: `moveTo:${status}`,
  label: `Move to ${label}`,
}));

type ReorderProps = {
  disabled: boolean;
  onCategoryMove?: (status: Status) => void;
  /** Omit where only moving between sections is supported (tag pages). */
  onMove?: (direction: -1 | 1) => void;
};

/** The fields a card shows, so previews can render the real cards from sample data. */
export type CardItem = Pick<LibraryItem, '_id' | 'title' | 'posterPath' | 'rating' | 'status'>;

function handleReorderAction(
  actionName: string,
  onMove: ReorderProps['onMove'],
  onCategoryMove: ReorderProps['onCategoryMove'],
) {
  if (actionName === 'moveUp') onMove?.(-1);
  if (actionName === 'moveDown') onMove?.(1);
  if (actionName.startsWith('moveTo:')) onCategoryMove?.(actionName.slice(7) as Status);
}

function reorderActions({ disabled, onMove, onCategoryMove }: ReorderProps, status?: Status) {
  if (disabled) return undefined;
  return [
    ...(onMove
      ? [
          { name: 'moveUp', label: 'Move up' },
          { name: 'moveDown', label: 'Move down' },
        ]
      : []),
    ...(onCategoryMove
      ? categoryActions.filter((action) => action.name !== `moveTo:${status}`)
      : []),
  ];
}

function cardLabel(item: CardItem, rank: number, ranked: boolean) {
  return `${ranked ? `${rank}. ` : ''}${item.title}`;
}

export function LibraryPosterCard({
  item,
  rank,
  ranked,
  disabled,
  onCategoryMove,
  onMove,
  compact = false,
  disabledHint = 'Clear filters to reorder your library',
}: {
  item: CardItem;
  rank: number;
  ranked: boolean;
  /** Narrow grids (five per row) use a smaller caption so words fit. */
  compact?: boolean;
  disabledHint?: string;
} & ReorderProps) {
  return (
    <NativePressable
      accessibilityRole="button"
      accessibilityLabel={cardLabel(item, rank, ranked)}
      accessibilityHint={disabled ? disabledHint : 'Long press and drag to reorder this title'}
      accessibilityActions={reorderActions({ disabled, onMove, onCategoryMove }, item.status)}
      onAccessibilityAction={(event) =>
        handleReorderAction(event.nativeEvent.actionName, onMove, onCategoryMove)
      }
      onPress={() => router.push(`/item/${item._id}`)}
      style={s.card}
      pressedStyle={s.cardPressed}
    >
      <View pointerEvents="none">
        <View>
          <PosterImage path={item.posterPath} title={item.title} />
          <PosterBadges rank={ranked ? rank : undefined} compact={compact} />
        </View>
        <PosterCaption
          title={item.title}
          textStyle={[s.cardTitle, compact && s.cardTitleCompact]}
          shrunkStyle={s.cardTitleShrunk}
          boxStyle={[s.captionBox, compact && s.captionBoxCompact]}
          ellipsisFontSize={compact ? 10 : 12}
        />
      </View>
    </NativePressable>
  );
}

export function LibraryRow({
  item,
  isActive,
  rank,
  ranked,
  disabled,
  onCategoryMove,
  onMove,
  textSize,
  contained = false,
  pairHeight,
  onTitleLines,
}: {
  item: CardItem;
  isActive?: boolean;
  rank: number;
  ranked: boolean;
  textSize: ListTextSize;
  contained?: boolean;
  /** Two columns: the height shared with the row beside it (see `twoColumnPairHeight`). */
  pairHeight?: number;
  /** Two columns: reports how many lines the title takes (see `useTitleLines`). */
  onTitleLines?: (key: string, lines: number) => void;
} & ReorderProps) {
  const typography = listTypography(textSize);
  const text = { fontSize: typography.fontSize, lineHeight: typography.lineHeight };
  const rating =
    item.rating !== undefined ? (
      <Text
        accessibilityLabel={`Rated ${item.rating} out of 5`}
        style={[
          s.rating,
          { fontSize: typography.fontSize * 0.85, lineHeight: typography.lineHeight },
        ]}
      >
        <Text style={s.ratingStar}>★ </Text>
        {item.rating.toFixed(1)}
      </Text>
    ) : null;
  return (
    <NativePressable
      accessibilityRole="button"
      accessibilityLabel={cardLabel(item, rank, ranked)}
      accessibilityHint={disabled ? undefined : 'Long press and drag to reorder this title'}
      accessibilityActions={reorderActions({ disabled, onMove, onCategoryMove }, item.status)}
      onAccessibilityAction={(event) =>
        handleReorderAction(event.nativeEvent.actionName, onMove, onCategoryMove)
      }
      onPress={() => router.push(`/item/${item._id}`)}
      style={[
        s.row,
        { minHeight: typography.minHeight },
        contained && s.rowContained,
        // Two columns: the pair beside each other share a height, so their meta lines
        // (pinned to the bottom) line up.
        contained && pairHeight !== undefined && { minHeight: pairHeight },
        isActive && s.dragActive,
      ]}
      pressedStyle={s.rowPressed}
    >
      {ranked ? (
        <Text
          numberOfLines={1}
          style={[s.rowRank, text, { minWidth: Math.round(typography.fontSize * 1.25) }]}
        >
          {rank}
        </Text>
      ) : null}
      {contained ? (
        <View style={s.rowStack}>
          <Text
            numberOfLines={2}
            onTextLayout={(event) =>
              onTitleLines?.(
                titleLinesKey(item._id, ranked, textSize),
                Math.min(2, Math.max(1, event.nativeEvent.lines.length)),
              )
            }
            style={[s.rowTitle, text]}
          >
            {item.title}
          </Text>
          {rating && <View style={s.rowMeta}>{rating}</View>}
        </View>
      ) : (
        <>
          <View style={s.rowTitleShell}>
            <Text numberOfLines={1} style={[s.rowTitle, text]}>
              {item.title}
            </Text>
          </View>
          {rating}
        </>
      )}
    </NativePressable>
  );
}

/**
 * In a two-column list, the height both rows of a pair share: enough for the longer title
 * (one or two lines) plus a meta line only when either row shows a rating.
 */
export function twoColumnPairHeight(
  items: readonly CardItem[],
  index: number,
  cellWidth: number,
  textSize: ListTextSize,
  measured?: ReadonlyMap<string, number>,
  /** Ranked rows give up the rank column's width to the number. */
  ranked = true,
) {
  const typography = listTypography(textSize);
  const start = index - (index % 2);
  const pair = items.slice(start, start + 2);
  const titleWidth = Math.max(
    40,
    cellWidth - (ranked ? Math.round(typography.fontSize * 1.25) + 8 : 0),
  );
  // Measured line counts once the titles have laid out; an estimate until then.
  const lines = Math.max(
    ...pair.map(
      (entry) =>
        measured?.get(titleLinesKey(entry._id, ranked, textSize)) ??
        (entry.title.length > captionCharsPerLine(entry.title, titleWidth, typography.fontSize)
          ? 2
          : 1),
    ),
  );
  const meta = pair.some((entry) => entry.rating !== undefined);
  return 16 + typography.lineHeight * (lines + (meta ? 1 : 0)) + (meta ? 2 : 0);
}

/** A measurement holds for one layout: ranked rows have less room, and text size changes it. */
function titleLinesKey(id: string, ranked: boolean, textSize: ListTextSize) {
  return `${id}:${ranked ? 'ranked' : 'plain'}:${textSize}`;
}

/**
 * Line counts reported by two-column rows, so `twoColumnPairHeight` sizes each pair to what
 * the titles actually take rather than an estimate.
 */
export function useTitleLines() {
  const [measured, setMeasured] = useState<ReadonlyMap<string, number>>(() => new Map());
  const report = useCallback((key: string, lines: number) => {
    setMeasured((current) =>
      current.get(key) === lines ? current : new Map(current).set(key, lines),
    );
  }, []);
  return { measured, report };
}

/**
 * A watched show also listed under Watching, placed first in that section's grid. It keeps
 * its Watched rank, so it is not draggable there.
 */
export function AlsoWatchingCard({
  item,
  view,
  textSize,
  compact,
  contained,
  pairHeight,
  onTitleLines,
}: {
  item: CardItem;
  view: 'list' | 'posters';
  textSize: ListTextSize;
  compact: boolean;
  contained: boolean;
  pairHeight?: number;
  onTitleLines?: (id: string, lines: number) => void;
}) {
  return view === 'posters' ? (
    <LibraryPosterCard
      item={item}
      rank={0}
      ranked={false}
      disabled
      disabledHint="Ranked under Watched, also shown here"
      compact={compact}
    />
  ) : (
    <LibraryRow
      item={item}
      rank={0}
      ranked={false}
      disabled
      textSize={textSize}
      contained={contained}
      pairHeight={pairHeight}
      onTitleLines={onTitleLines}
    />
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
    cardTitleCompact: { fontSize: 10, lineHeight: 13, marginTop: 5, fontWeight: '600' },
    cardTitleShrunk: { fontSize: 9, lineHeight: 13, fontWeight: '600' },
    // Two caption lines are always reserved, so each row of posters stays even.
    captionBox: { minHeight: 6 + 16 * 2 },
    captionBoxCompact: { minHeight: 5 + 13 * 2 },
    rank: { color: colors.muted },
    row: {
      minHeight: 30,
      width: '100%',
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 8,
      gap: 8,
      overflow: 'hidden',
    },
    rowPressed: { backgroundColor: colors.surface },
    rowContained: { flex: 1, width: '100%', paddingVertical: 8, alignItems: 'flex-start' },
    rowRank: {
      color: colors.muted,
      fontSize: 16,
      lineHeight: 22,
      fontWeight: '500',
      fontVariant: ['tabular-nums'],
    },
    rowTitleShell: {
      flex: 1,
      minWidth: 0,
      overflow: 'hidden',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    rowStack: {
      flex: 1,
      minWidth: 0,
      gap: 2,
      alignSelf: 'stretch',
      justifyContent: 'space-between',
    },
    rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    rowTitle: {
      color: colors.text,
      fontSize: 16,
      lineHeight: 22,
      fontWeight: '500',
      flexShrink: 1,
    },
    rating: {
      color: colors.secondary,
      fontSize: 14,
      lineHeight: 22,
      fontVariant: ['tabular-nums'],
      flexShrink: 0,
    },
    ratingStar: { color: colors.muted },
    dragActive: {
      backgroundColor: colors.elevated,
      borderWidth: 1,
      borderColor: colors.text,
      borderRadius: 10,
      opacity: 0.96,
      zIndex: 2,
    },
  },
  [
    'cardTitle',
    'rank',
    'rowRank',
    'rowTitle',
    'rating',
    'cardTitleCompact',
    'cardTitleShrunk',
  ] as const,
);
