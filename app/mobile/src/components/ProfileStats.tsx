import { Text, View } from 'react-native';
import { Chip, StatTile } from '@/components/ui/primitives';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';
import { ProfileFavorites, type ProfileFavorite } from './ProfileFavorites';

export type ProfileStatsValue = {
  totalWatchMinutes: number;
  episodesWatched: number;
  moviesWatched: number;
  showsWatched: number;
  totalItems: number;
  avgRating: number;
  favorites: ProfileFavorite[];
  topTags: { tag: string; count: number }[];
};

export function ProfileMetrics({ stats }: { stats: ProfileStatsValue }) {
  const days = Math.floor(stats.totalWatchMinutes / 1440);
  const hours = Math.floor((stats.totalWatchMinutes % 1440) / 60);
  return (
    <View style={s.tiles}>
      <StatTile
        label="Watch Time"
        value={`${days}d ${hours}h`}
        detail={`${stats.totalWatchMinutes.toLocaleString()} minutes`}
      />
      <StatTile label="Episodes" value={stats.episodesWatched} />
      <StatTile label="Movies Watched" value={stats.moviesWatched} />
      <StatTile label="Shows Watched" value={stats.showsWatched} />
      <StatTile label="Library Items" value={stats.totalItems} />
      <StatTile
        label="Average Rating"
        value={stats.avgRating !== undefined ? stats.avgRating.toFixed(1) : '—'}
      />
    </View>
  );
}

export function ProfileCollection({
  stats,
  interactive = true,
}: {
  stats: ProfileStatsValue;
  interactive?: boolean;
}) {
  return (
    <View style={s.sections}>
      <ProfileFavorites favorites={stats.favorites} interactive={interactive} />
      <View style={s.sectionBlock}>
        <Text style={s.section}>Top Tags</Text>
        <View style={s.tags}>
          {stats.topTags.length ? (
            stats.topTags.map((tag) => <Chip key={tag.tag} label={`${tag.tag}  ${tag.count}`} />)
          ) : (
            <Text style={s.empty}>No tags yet.</Text>
          )}
        </View>
      </View>
    </View>
  );
}

const s = createAppStyles(
  {
    tiles: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4 },
    sections: { gap: 48 },
    sectionBlock: { gap: 16 },
    section: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    empty: { color: colors.muted, fontSize: 13, paddingVertical: 8 },
  },
  ['section', 'empty'] as const,
);
