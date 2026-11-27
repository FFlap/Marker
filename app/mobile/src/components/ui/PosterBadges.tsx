import { Text, View } from 'react-native';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';

/**
 * The rank drawn on the poster itself, so the caption below keeps its full width for the
 * title at every grid density.
 */
export function PosterBadges({ rank, compact = false }: { rank?: number; compact?: boolean }) {
  if (rank === undefined) return null;
  return (
    <View style={[s.rank, compact && s.rankCompact]}>
      <Text style={[s.rankText, compact && s.rankTextCompact]}>{rank}</Text>
    </View>
  );
}

const s = createAppStyles(
  {
    rank: {
      position: 'absolute',
      left: 5,
      bottom: 5,
      minWidth: 22,
      height: 22,
      paddingHorizontal: 6,
      borderRadius: radius.pill,
      backgroundColor: 'rgba(10, 10, 11, 0.82)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    rankText: {
      color: colors.text,
      fontSize: 11,
      lineHeight: 14,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    rankCompact: { left: 4, bottom: 4, minWidth: 18, height: 18, paddingHorizontal: 5 },
    rankTextCompact: { fontSize: 10, lineHeight: 12 },
  },
  ['rankText', 'rankTextCompact'] as const,
);
