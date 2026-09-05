import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { StyleSheet, View } from 'react-native';
import { colors } from '@/constants/colors';
import { SkeletonShimmer } from '@/components/SkeletonShimmer';

function SkeletonField({ style, children }: { style: StyleProp<ViewStyle>; children?: ReactNode }) {
  return (
    <View style={[styles.field, style]}>
      {children}
      <SkeletonShimmer />
    </View>
  );
}

export function EpisodeSkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <View style={styles.rows} accessibilityRole="progressbar" accessibilityLabel="Loading">
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.row}>
          <SkeletonField style={styles.thumbnail} />
          <View style={styles.copy}>
            <SkeletonField style={styles.episodeNumber} />
            <SkeletonField style={[styles.title, index % 2 === 0 && styles.titleShort]} />
            <SkeletonField
              style={[styles.description, index % 2 !== 0 && styles.descriptionShort]}
            />
          </View>
          <SkeletonField style={styles.action} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  rows: { gap: 10, marginTop: 18 },
  row: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingVertical: 8,
  },
  field: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  thumbnail: { width: 112, height: 64, borderRadius: 10 },
  copy: { flex: 1, gap: 9 },
  episodeNumber: { width: '22%', height: 8, borderRadius: 4 },
  title: { width: '78%', height: 12, borderRadius: 6 },
  titleShort: { width: '64%' },
  description: { width: '94%', height: 8, borderRadius: 4 },
  descriptionShort: { width: '82%' },
  action: { width: 28, height: 28, borderRadius: 14 },
});
