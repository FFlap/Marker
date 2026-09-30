import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { Check, RotateCcw } from 'lucide-react-native';
import { SkeletonShimmer } from '@/components/SkeletonShimmer';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';
import { InlineAction } from './SectionHeader';

/** Season picker with its action on one line, directly under the Episodes heading. */
export function SeasonHeaderRow({ picker, action }: { picker: ReactNode; action: ReactNode }) {
  return (
    <View style={styles.headerRow}>
      <View style={styles.picker}>{picker}</View>
      {action}
    </View>
  );
}

/** Season picker with its watched count, a progress bar, and the whole-season toggle below. */
export function SeasonProgress({
  picker,
  loading,
  watched,
  total,
  complete,
  disabled,
  onToggle,
}: {
  picker: ReactNode;
  loading: boolean;
  watched: number;
  total: number;
  /** Whether every episode in the season is watched; decides what the toggle does. */
  complete: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const shown = loading ? 0 : Math.min(watched, total);
  const percent = total > 0 ? (shown / total) * 100 : 0;

  return (
    <View style={styles.root}>
      <SeasonHeaderRow
        picker={picker}
        action={
          loading ? (
            <View style={styles.countSkeleton}>
              <SkeletonShimmer />
            </View>
          ) : (
            <Text style={styles.count}>
              {total > 0 ? (
                <>
                  <Text style={styles.countStrong}>{watched}</Text> / {total} watched
                </>
              ) : (
                'No episodes'
              )}
            </Text>
          )
        }
      />
      {total > 0 && (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel="Season progress"
          accessibilityValue={{ min: 0, max: total, now: shown }}
          style={styles.track}
        >
          <View style={[styles.fill, { width: `${percent}%` }]} />
        </View>
      )}
      <View style={styles.toggleRow}>
        <InlineAction
          label={complete ? 'Mark unwatched' : 'Mark watched'}
          icon={complete ? RotateCcw : Check}
          disabled={disabled}
          onPress={onToggle}
        />
      </View>
    </View>
  );
}

const styles = createAppStyles(
  {
    root: { paddingBottom: 6 },
    // The 44pt picker target adds space above the heading text; pull it up so the
    // gap under the section rule matches the other sections.
    headerRow: {
      marginTop: -10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
    },
    picker: { flexShrink: 1, minWidth: 0 },
    track: {
      height: 4,
      marginTop: 2,
      overflow: 'hidden',
      borderRadius: 2,
      backgroundColor: colors.border,
    },
    fill: { height: '100%', borderRadius: 2, backgroundColor: colors.text },
    // Sits under the bar on the left, with its 44pt target reaching into the gap.
    toggleRow: { flexDirection: 'row', marginTop: 14 },
    count: { color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
    countStrong: { color: colors.text, fontWeight: '600' },
    countSkeleton: {
      position: 'relative',
      overflow: 'hidden',
      width: 96,
      height: 12,
      borderRadius: 6,
      backgroundColor: colors.surface,
    },
  },
  ['count', 'countStrong'] as const,
);
