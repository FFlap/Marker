import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import Check from 'lucide-react-native/icons/check';
import Clock3 from 'lucide-react-native/icons/clock-3';
import EyeOff from 'lucide-react-native/icons/eye-off';
import { SkeletonShimmer } from '@/components/SkeletonShimmer';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';
import { InlineAction } from './SectionHeader';

export function SeasonHeaderRow({ picker, action }: { picker: ReactNode; action?: ReactNode }) {
  return (
    <View style={styles.headerRow}>
      <View style={styles.picker}>{picker}</View>
      {action}
    </View>
  );
}

export function SeasonProgress({
  picker,
  loading,
  watched,
  total,
  complete,
  ongoing = false,
  nothingAired = false,
  disabled,
  onToggle,
}: {
  picker: ReactNode;
  loading: boolean;
  watched: number;
  total: number;
  complete: boolean;
  /** The season still has listed episodes to air; marking it covers only the aired ones. */
  ongoing?: boolean;
  /** Every listed episode is still to air. */
  nothingAired?: boolean;
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
          label={
            complete
              ? 'Mark season unwatched'
              : nothingAired
                ? 'No episodes aired yet'
                : ongoing
                  ? 'Mark aired episodes watched'
                  : 'Mark season watched'
          }
          icon={complete ? EyeOff : nothingAired ? Clock3 : Check}
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
    headerRow: {
      marginTop: -4,
      marginBottom: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
    },
    picker: { flexShrink: 1, minWidth: 0 },
    track: {
      height: 6,
      marginTop: 4,
      overflow: 'hidden',
      borderRadius: 3,
      backgroundColor: colors.elevated,
    },
    fill: { height: '100%', borderRadius: 3, backgroundColor: colors.text },
    toggleRow: { flexDirection: 'row', marginTop: 14 },
    count: { color: colors.muted, fontSize: 13, fontVariant: ['tabular-nums'] },
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
