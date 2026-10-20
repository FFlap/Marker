import { Text, View } from 'react-native';
import { Chip, StatTile } from '@/components/ui/primitives';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';
import { useLocalToday } from '@/hooks/use-local-today';
import { ProfileFavorites, type ProfileFavorite } from './ProfileFavorites';
import { WatchHeatmap } from './WatchHeatmap';
import {
  formatActivityDate,
  summarizeWatchActivity,
  type WatchActivityDay,
} from '../../convex/watchActivityStats';

export type ProfileStatsValue = {
  totalWatchMinutes: number;
  episodesWatched: number;
  moviesWatched: number;
  showsWatched: number;
  totalItems: number;
  avgRating: number;
  favorites: ProfileFavorite[];
  topTags: { tag: string; count: number }[];
  watchActivity: WatchActivityDay[];
};

const dayCount = (count: number) => `${count.toLocaleString()} ${count === 1 ? 'day' : 'days'}`;

export function ProfileMetrics({ stats }: { stats: ProfileStatsValue }) {
  const today = useLocalToday();
  const activity = summarizeWatchActivity(stats.watchActivity, today);
  const days = Math.floor(stats.totalWatchMinutes / 1440);
  const hours = Math.floor((stats.totalWatchMinutes % 1440) / 60);
  return (
    <View style={s.metrics}>
      <WatchHeatmap days={stats.watchActivity} today={today} />
      <View style={s.tiles}>
        <StatTile
          label="Daily Streak"
          value={dayCount(activity.currentStreak)}
          detail={
            activity.watchedToday
              ? 'Watched today'
              : activity.currentStreak
                ? 'Watch today to keep it'
                : undefined
          }
        />
        <StatTile label="Highest Streak" value={dayCount(activity.longestStreak)} />
        <StatTile
          label="Avg Daily Episodes"
          value={activity.dailyAverage.toFixed(1)}
          detail={activity.firstDate && `Since ${formatActivityDate(activity.firstDate)}`}
        />
        <StatTile
          label="This Week"
          value={activity.thisWeek.toLocaleString()}
          detail={`Last week: ${activity.lastWeek.toLocaleString()}`}
        />
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
    metrics: { gap: 28 },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4 },
    sections: { gap: 48 },
    sectionBlock: { gap: 16 },
    section: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    empty: { color: colors.muted, fontSize: 13, paddingVertical: 8 },
  },
  ['section', 'empty'] as const,
);
