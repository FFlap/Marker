import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import TrendingDown from 'lucide-react-native/icons/trending-down';
import TrendingUp from 'lucide-react-native/icons/trending-up';
import { Chip, SectionHeading, Segmented, StatTile } from '@/components/ui/primitives';
import { colors } from '@/constants/colors';
import { radius, typeRamp } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';
import { useLocalToday } from '@/hooks/use-local-today';
import {
  analyzeActivity,
  analyzeLibrary,
  STATS_PERIODS,
  type ActivityBucket,
  type StatsPeriod,
} from '@/lib/profileAnalytics';
import { ProfileFavorites, type ProfileFavorite } from './ProfileFavorites';
import { WatchHeatmap } from './WatchHeatmap';
import {
  formatActivityDate,
  summarizeWatchActivity,
  type WatchActivityDay,
} from '@marker/shared/watchActivityStats';
import type { LibraryItem } from '@/types';

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

const CHART_HEIGHT = 128;
const periodWord: Record<StatsPeriod, string> = {
  week: 'last 7 days',
  month: 'last 30 days',
  year: 'last 12 months',
};
const previousWord: Record<Exclude<StatsPeriod, 'year'>, string> = {
  week: 'previous 7 days',
  month: 'previous 30 days',
};
/** Year compares the same number of days just before, which can start mid-month: name it. */
const previousLabel = (period: StatsPeriod, range: { start: string; end: string }): string =>
  period === 'year'
    ? `${formatActivityDate(range.start)} – ${formatActivityDate(range.end)}`
    : previousWord[period];

const plural = (count: number, word: string) =>
  `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;

/** "45m", "5h 12m" or "4d 5h". */
export function formatWatchTime(minutes: number) {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = Math.round(minutes % 60);
  if (days) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  return `${rest}m`;
}

/** "Today", "Nov 3" this year, or the full date. */
function shortDate(date: string, today: string) {
  if (date === today) return 'Today';
  const full = formatActivityDate(date);
  return date.slice(0, 4) === today.slice(0, 4) ? full.replace(/, \d{4}$/, '') : full;
}

const oneDecimal = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

function Bar({
  value,
  max,
  highlighted,
  peak,
  peakDate,
  peakAlign = 'center',
}: {
  value: number;
  max: number;
  highlighted: boolean;
  peak: boolean;
  /** Shown beside the peak value where the axis doesn't name the day ("22 · Nov 23"). */
  peakDate?: string;
  /** Near the chart's edges the label is anchored inward so it isn't cut off. */
  peakAlign?: 'left' | 'center' | 'right';
}) {
  const height = max && value ? Math.max(4, (value / max) * CHART_HEIGHT) : 0;
  // Drawn at its final size: a chart must never show anything but its data.
  return (
    <View style={s.barSlot}>
      {peak && (
        <Text
          numberOfLines={1}
          style={[
            s.peakLabel,
            peakAlign === 'left' && s.peakLabelLeft,
            peakAlign === 'right' && s.peakLabelRight,
          ]}
        >
          {peakDate ? `${value.toLocaleString()} · ${peakDate}` : value.toLocaleString()}
        </Text>
      )}
      {/* Empty days keep a stub, so every day (today included) has a visible slot. */}
      {value ? (
        <View style={[s.bar, highlighted ? s.barStrong : s.barSoft, { height }]} />
      ) : (
        <View style={s.barEmpty} />
      )}
    </View>
  );
}

function ActivityChart({
  buckets,
  periodKey,
  summary,
}: {
  buckets: ActivityBucket[];
  periodKey: string;
  summary: string;
}) {
  const max = Math.max(0, ...buckets.map((bucket) => bucket.episodes));
  let peakIndex = -1;
  buckets.forEach((bucket, index) => {
    if (max && bucket.episodes === max) peakIndex = index;
  });
  // Tap a bar (or swipe up/down with TalkBack) to read its day and count; otherwise the
  // peak is labelled.
  const [selection, setSelection] = useState<{ period: string; index: number }>();
  const selected = selection?.period === periodKey ? selection.index : undefined;
  const labelled = selected ?? peakIndex;
  const [barsWidth, setBarsWidth] = useState(0);
  const select = (index: number | undefined) =>
    setSelection(index === undefined ? undefined : { period: periodKey, index });
  const reading = buckets[selected ?? buckets.length - 1];
  const dense = buckets.length > 14;
  const marks = dense
    ? [0, Math.round((buckets.length - 1) / 3), Math.round(((buckets.length - 1) * 2) / 3)]
    : [];
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={summary}
      accessibilityValue={
        reading ? { text: `${plural(reading.episodes, 'episode')}, ${reading.long}` } : undefined
      }
      accessibilityActions={[
        { name: 'increment', label: 'Next' },
        { name: 'decrement', label: 'Previous' },
      ]}
      onAccessibilityAction={({ nativeEvent: { actionName } }) => {
        const from = selected ?? buckets.length - 1;
        const step = actionName === 'increment' ? 1 : actionName === 'decrement' ? -1 : 0;
        if (step) select(Math.max(0, Math.min(buckets.length - 1, from + step)));
      }}
    >
      <Pressable
        // Taps land on the chart itself (never a bar), so locationX is across the whole width.
        pointerEvents="box-only"
        onLayout={(event) => setBarsWidth(event.nativeEvent.layout.width)}
        onPress={(event) => {
          if (!barsWidth) return;
          const index = Math.min(
            buckets.length - 1,
            Math.max(0, Math.floor((event.nativeEvent.locationX / barsWidth) * buckets.length)),
          );
          select(index === selected ? undefined : index);
        }}
        style={[s.bars, buckets.length > 14 && s.barsDense]}
      >
        {buckets.map((bucket, index) => (
          <Bar
            key={bucket.key}
            value={bucket.episodes}
            max={max}
            peak={index === labelled}
            // A picked bar always names its day; the peak does wherever the axis doesn't
            // name its own bar (Month, and Year's unlabelled months).
            peakDate={
              index === selected || dense || bucket.label !== bucket.long ? bucket.long : undefined
            }
            peakAlign={
              index < Math.max(1, buckets.length * 0.2)
                ? 'left'
                : index >= Math.min(buckets.length - 2, buckets.length * 0.7)
                  ? 'right'
                  : 'center'
            }
            highlighted={index === labelled}
          />
        ))}
      </Pressable>
      <View style={s.baseline} />
      {dense ? (
        // Each label sits on a tick under its own bar, so a bar is never read as its neighbor.
        <View style={s.axisSparse}>
          {[...marks, buckets.length - 1].map((index) => {
            const center = `${((index + 0.5) / buckets.length) * 100}%` as const;
            const last = index === buckets.length - 1;
            return (
              <View key={index} pointerEvents="none" style={StyleSheet.absoluteFill}>
                <View style={[s.axisTick, { left: center }]} />
                <Text
                  numberOfLines={1}
                  style={[
                    s.axisLabel,
                    s.axisTickLabel,
                    index === 0
                      ? s.axisTickFirst
                      : last
                        ? [s.axisTickLast, s.axisLabelStrong]
                        : { left: center, marginLeft: -AXIS_LABEL_WIDTH / 2 },
                  ]}
                >
                  {last ? 'Today' : buckets[index]!.long}
                </Text>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={s.axis}>
          {buckets.map((bucket, index) => (
            <Text
              key={bucket.key}
              numberOfLines={1}
              style={[s.axisLabel, s.axisSlot, index === buckets.length - 1 && s.axisLabelStrong]}
            >
              {bucket.label}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

function Card({
  title,
  detail,
  children,
}: {
  title?: string;
  detail?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={s.card}>
      {title ? (
        <View style={s.cardHead}>
          <Text accessibilityRole="header" style={s.cardTitle}>
            {title}
          </Text>
          {detail ? <Text style={s.cardDetail}>{detail}</Text> : null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

function HorizontalBars({
  rows,
  // One label column for every bar card, so stacked charts start their bars on one line.
  labelWidth = BAR_LABEL_WIDTH,
  total,
}: {
  rows: { label: string; value: number; display?: string }[];
  labelWidth?: number;
  /** Bars measure against this (such as the title count) instead of the largest row. */
  total?: number;
}) {
  const peak = Math.max(0, ...rows.map((row) => row.value));
  const max = total ?? peak;
  return (
    <View style={s.hbars}>
      {rows.map((row) => (
        <HorizontalBar
          key={row.label}
          label={row.label}
          value={row.value}
          display={row.display ?? row.value.toLocaleString()}
          max={max}
          strong={peak > 0 && row.value === peak}
          labelWidth={labelWidth}
        />
      ))}
    </View>
  );
}

function HorizontalBar({
  label,
  value,
  display,
  max,
  strong,
  labelWidth,
}: {
  label: string;
  value: number;
  display: string;
  max: number;
  /** The largest row is drawn in white. */
  strong: boolean;
  labelWidth: number;
}) {
  const fraction = max ? value / max : 0;
  const width = `${Math.max(value ? 3 : 0, fraction * 100)}%` as const;
  return (
    <View accessible accessibilityLabel={`${label}, ${display}`} style={s.hbarRow}>
      <Text numberOfLines={2} style={[s.hbarLabel, { width: labelWidth }]}>
        {label}
      </Text>
      <View style={s.hbarTrack}>
        <View style={[s.hbarFill, strong && s.hbarFillStrong, { width }]} />
      </View>
      <Text style={s.hbarValue}>{display}</Text>
    </View>
  );
}

type SegmentPart = {
  label: string;
  count: number;
  color: string;
};

function Segments({ parts }: { parts: SegmentPart[] }) {
  const total = parts.reduce((sum, part) => sum + part.count, 0);
  return (
    <View style={s.segmentsBlock}>
      <View style={s.segmentsBar}>
        {parts
          .filter((part) => part.count > 0)
          .map((part) => (
            <View
              key={part.label}
              style={[s.segment, { flex: part.count, backgroundColor: part.color }]}
            />
          ))}
        {total === 0 && <View style={[s.segment, { flex: 1, backgroundColor: colors.elevated }]} />}
      </View>
      <View style={s.legend}>
        {parts.map((part) => (
          <View
            key={part.label}
            accessible
            accessibilityLabel={`${part.label}, ${part.count}`}
            style={s.legendItem}
          >
            <View style={[s.legendSwatch, { backgroundColor: part.color }]} />
            <Text style={s.legendLabel}>{part.label}</Text>
            <Text style={s.legendValue}>{part.count.toLocaleString()}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const SHADES = [colors.text, '#A9A9B1', '#6C6C74', '#3F3F46'];
const RATING_ROWS = [
  { label: '5★', index: 4 },
  { label: '4–4½★', index: 3 },
  { label: '3–3½★', index: 2 },
  { label: '2–2½★', index: 1 },
  { label: '½–1½★', index: 0 },
];
const WEEKDAY_NAMES: Record<string, string> = {
  Sun: 'Sundays',
  Mon: 'Mondays',
  Tue: 'Tuesdays',
  Wed: 'Wednesdays',
  Thu: 'Thursdays',
  Fri: 'Fridays',
  Sat: 'Saturdays',
};

export function ProfileMetrics({
  stats,
  items,
  alsoWatching = 0,
}: {
  stats: ProfileStatsValue;
  /** The owner's library, for composition charts. Omitted on other people's profiles. */
  items?: LibraryItem[];
  /** Watched shows currently also listed under Watching. */
  alsoWatching?: number;
}) {
  const today = useLocalToday();
  const [period, setPeriod] = useState<StatsPeriod>('month');
  const streaks = summarizeWatchActivity(stats.watchActivity, today);
  const activity = useMemo(
    () => analyzeActivity(stats.watchActivity, today, period),
    [period, stats.watchActivity, today],
  );
  const library = useMemo(() => (items ? analyzeLibrary(items) : undefined), [items]);
  const change = activity.total - activity.previousTotal;
  const busiest = activity.weekdays.reduce(
    (best, day) => (day.episodes > best.episodes ? day : best),
    activity.weekdays[0]!,
  );

  return (
    <View style={s.metrics}>
      <Segmented
        options={STATS_PERIODS}
        value={period}
        onChange={(value) => setPeriod(value as StatsPeriod)}
      />

      <Card>
        <Text style={s.kicker}>Episodes watched · {periodWord[period]}</Text>
        <View style={s.heroRow}>
          <Text accessibilityRole="header" style={s.heroValue}>
            {activity.total.toLocaleString()}
          </Text>
          {(activity.total > 0 || activity.previousTotal > 0) && (
            <View style={s.delta}>
              {change > 0 ? (
                <TrendingUp size={15} color={colors.text} strokeWidth={2} />
              ) : change < 0 ? (
                <TrendingDown size={15} color={colors.muted} strokeWidth={2} />
              ) : null}
              <Text style={[s.deltaText, change <= 0 && s.deltaTextDown]}>
                {change === 0
                  ? `Same as ${previousLabel(period, activity.previousRange)}`
                  : `${change > 0 ? '+' : ''}${change.toLocaleString()} vs ${previousLabel(period, activity.previousRange)}`}
              </Text>
            </View>
          )}
        </View>
        <ActivityChart
          buckets={activity.buckets}
          periodKey={period}
          summary={`${plural(activity.total, 'episode')} in the ${periodWord[period]}${
            activity.bestDay
              ? `, most on ${formatActivityDate(activity.bestDay.date)} with ${activity.bestDay.episodes}`
              : ''
          }`}
        />
      </Card>

      <View style={s.tiles}>
        <StatTile
          label="Active days"
          value={activity.activeDays.toLocaleString()}
          detail={`of ${plural(activity.periodDays, 'day')}`}
        />
        <StatTile
          label="Daily average"
          value={oneDecimal(Number(activity.perDay.toFixed(1)))}
          detail="episodes a day"
        />
        {/* With a single active day this repeats Best day, so it waits for a second. */}
        {activity.activeDays > 1 && (
          <StatTile
            label="Per active day"
            value={oneDecimal(Number(activity.perActiveDay.toFixed(1)))}
            detail="on days you watched"
          />
        )}
        {/* With one active day the chart's peak label already names it; the grid stays 2 or 4. */}
        {activity.activeDays > 1 && activity.bestDay && (
          <StatTile
            label="Best day"
            value={activity.bestDay.episodes.toLocaleString()}
            detail={`${activity.bestDay.episodes === 1 ? 'episode' : 'episodes'} · ${shortDate(activity.bestDay.date, today)}`}
          />
        )}
      </View>

      {/* A weekday pattern needs at least two days of activity; one would only repeat Best day. */}
      {activity.activeDays > 1 && (
        <Card title="Busiest days" detail={`Most on ${WEEKDAY_NAMES[busiest.label]}`}>
          <HorizontalBars
            rows={activity.weekdays.map((day) => ({ label: day.label, value: day.episodes }))}
          />
        </Card>
      )}

      {/* As many weeks as fit the width, titled on its own: not the picked period, and not all time. */}
      <Card>
        <WatchHeatmap days={stats.watchActivity} today={today} />
      </Card>
      <SectionHeading title="All time" style={s.groupHeading} />
      <View style={s.tiles}>
        <StatTile label="Watch time" value={formatWatchTime(stats.totalWatchMinutes)} />
        <StatTile label="Unique episodes" value={stats.episodesWatched.toLocaleString()} />
        <StatTile
          label="Current streak"
          // The unit sits with the number, so tiles only grow for a real detail.
          value={plural(streaks.currentStreak, 'day')}
          detail={
            streaks.watchedToday
              ? 'Watched today'
              : streaks.currentStreak
                ? 'Not yet today'
                : undefined
          }
        />
        <StatTile label="Longest streak" value={plural(streaks.longestStreak, 'day')} />
        <StatTile label="Shows watched" value={stats.showsWatched.toLocaleString()} />
        <StatTile label="Movies watched" value={stats.moviesWatched.toLocaleString()} />
      </View>

      {library && (
        <>
          <SectionHeading title="Library" count={stats.totalItems} style={s.groupHeading} />
          {/* Very large libraries load only part of the list on the phone; say so. */}
          {items && items.length < stats.totalItems && (
            <Text style={s.partial}>
              Breakdowns cover {items.length.toLocaleString()} of{' '}
              {stats.totalItems.toLocaleString()} titles.
            </Text>
          )}
          <Card title="By status">
            {/* One bar per section against the title count: like the library, a show can be
                in both Watched and Watching, so these are not parts of one whole. */}
            <HorizontalBars
              // The same titles the counts come from (all of them unless the note above says).
              total={items?.length ?? stats.totalItems}
              rows={[
                { label: 'Watched', value: library.status.watched },
                { label: 'Watching', value: library.status.watching + alsoWatching },
                { label: 'Watchlist', value: library.status.watchlist },
                { label: 'Dropped', value: library.status.dropped },
              ]}
            />
            {alsoWatching > 0 && (
              <Text style={s.cardNote}>
                {alsoWatching === 1
                  ? '1 show is in both Watched and Watching.'
                  : `${alsoWatching} shows are in both Watched and Watching.`}
              </Text>
            )}
          </Card>
          <Card title="By type">
            <Segments
              parts={[
                { label: 'Anime', count: library.kinds.anime, color: SHADES[0]! },
                { label: 'TV shows', count: library.kinds.tv, color: SHADES[1]! },
                { label: 'Movies', count: library.kinds.movie, color: SHADES[2]! },
              ]}
            />
          </Card>
          <Card
            title="Ratings"
            detail={stats.avgRating ? `Average ★ ${stats.avgRating.toFixed(1)}` : undefined}
          >
            <HorizontalBars
              rows={RATING_ROWS.map((row) => ({
                label: row.label,
                value: library.ratings[row.index]!,
              }))}
            />
          </Card>
          {library.genres.length > 0 && (
            <Card title="Top genres">
              <HorizontalBars
                rows={library.genres.map((genre) => ({ label: genre.genre, value: genre.count }))}
              />
            </Card>
          )}
        </>
      )}
    </View>
  );
}

export function ProfileCollection({
  stats,
  interactive = true,
  items,
}: {
  stats: ProfileStatsValue;
  interactive?: boolean;
  /** The owner's library: Top tags then count titles, like the Tags page, and open them. */
  items?: LibraryItem[];
}) {
  const ownTags = useMemo(() => (items ? titleTagCounts(items) : undefined), [items]);
  const tags = ownTags ?? stats.topTags.map((tag) => ({ tag: tag.tag, count: undefined }));
  return (
    <View style={s.sections}>
      <ProfileFavorites favorites={stats.favorites} interactive={interactive} />
      {tags.length > 0 && (
        <View style={s.sectionBlock}>
          <SectionHeading title="Top tags" />
          <View style={s.tags}>
            {tags.map((tag) => (
              <Chip
                key={tag.tag}
                label={tag.count !== undefined ? `${tag.tag} · ${tag.count}` : tag.tag}
                accessibilityLabel={
                  tag.count !== undefined
                    ? `${tag.tag}, ${tag.count} ${tag.count === 1 ? 'title' : 'titles'}`
                    : tag.tag
                }
                onPress={
                  ownTags
                    ? () => router.push({ pathname: '/tags/[tag]', params: { tag: tag.tag } })
                    : undefined
                }
              />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

/** Tags by how many titles carry them, the same count the Tags page shows. */
function titleTagCounts(items: readonly LibraryItem[]) {
  const counts = new Map<string, { tag: string; count: number }>();
  for (const item of items)
    for (const tag of new Set((item.tags ?? []).map((entry) => entry.trim()).filter(Boolean))) {
      const key = tag.toLocaleLowerCase();
      const current = counts.get(key);
      counts.set(key, { tag: current?.tag ?? tag, count: (current?.count ?? 0) + 1 });
    }
  return [...counts.values()]
    .sort((left, right) => right.count - left.count || left.tag.localeCompare(right.tag))
    .slice(0, 8);
}

const AXIS_LABEL_WIDTH = 56;
const BAR_LABEL_WIDTH = 84;

const s = createAppStyles(
  {
    metrics: { gap: 14 },
    card: { borderRadius: radius.lg, backgroundColor: colors.surface, padding: 16, gap: 14 },
    cardHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    cardTitle: { ...typeRamp.sectionTitle, fontSize: 15 },
    cardDetail: { ...typeRamp.meta },
    kicker: { ...typeRamp.label, color: colors.muted },
    partial: { ...typeRamp.meta, marginTop: -6 },
    heroRow: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 },
    heroValue: {
      color: colors.text,
      fontSize: 40,
      lineHeight: 46,
      fontWeight: '700',
      letterSpacing: -1.2,
      fontVariant: ['tabular-nums'],
    },
    // A long comparison ("vs Dec 1, 2024 – Nov 26, 2025") wraps inside the card.
    delta: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1, maxWidth: '100%' },
    deltaText: { color: colors.text, fontSize: 13, fontWeight: '600', flexShrink: 1 },
    deltaTextDown: { color: colors.muted },
    bars: {
      height: CHART_HEIGHT + 18,
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 6,
    },
    barsDense: { gap: 3 },
    barSlot: {
      flex: 1,
      height: CHART_HEIGHT + 18,
      justifyContent: 'flex-end',
      alignItems: 'center',
    },
    bar: { width: '100%', borderTopLeftRadius: 4, borderTopRightRadius: 4 },
    barEmpty: { width: '100%', height: 2, borderRadius: 1, backgroundColor: colors.borderStrong },
    barStrong: { backgroundColor: colors.text },
    barSoft: { backgroundColor: '#5E5E66' },
    baseline: { height: 1, backgroundColor: colors.borderStrong },
    peakLabel: {
      position: 'absolute',
      top: 0,
      // Fits "22 · Mon Nov 23".
      width: 116,
      textAlign: 'center',
      color: colors.text,
      fontSize: 11,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    peakLabelLeft: { left: 0, textAlign: 'left' },
    peakLabelRight: { right: 0, textAlign: 'right' },
    groupHeading: { marginTop: 14 },
    axis: { flexDirection: 'row', gap: 6, marginTop: 8 },
    axisSparse: { height: 22, marginTop: 2 },
    axisTick: {
      position: 'absolute',
      top: 0,
      width: 1.5,
      height: 5,
      marginLeft: -0.75,
      backgroundColor: colors.faint,
    },
    axisTickLabel: { position: 'absolute', top: 7, width: AXIS_LABEL_WIDTH, textAlign: 'center' },
    axisTickFirst: { left: 0, textAlign: 'left' },
    axisTickLast: { right: 0, textAlign: 'right' },
    axisSlot: { flex: 1, textAlign: 'center' },
    axisLabel: { color: colors.muted, fontSize: 10 },
    axisLabelStrong: { color: colors.text, fontWeight: '700' },
    tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    hbars: { gap: 10 },
    cardNote: { ...typeRamp.meta, marginTop: 12 },
    hbarRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    hbarLabel: { color: colors.secondary, fontSize: 12, lineHeight: 15, fontWeight: '500' },
    hbarTrack: {
      flex: 1,
      height: 10,
      borderRadius: radius.pill,
      backgroundColor: colors.elevated,
      overflow: 'hidden',
    },
    hbarFill: { height: '100%', borderRadius: radius.pill, backgroundColor: '#7A7A83' },
    hbarFillStrong: { backgroundColor: colors.text },
    hbarValue: {
      minWidth: 28,
      textAlign: 'right',
      color: colors.text,
      fontSize: 12,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    segmentsBlock: { gap: 12 },
    segmentsBar: {
      height: 12,
      flexDirection: 'row',
      gap: 3,
      borderRadius: radius.pill,
      overflow: 'hidden',
    },
    segment: { height: '100%' },
    legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 8 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendSwatch: { width: 8, height: 8, borderRadius: 4 },
    legendLabel: { color: colors.secondary, fontSize: 12 },
    legendValue: { color: colors.text, fontSize: 12, fontWeight: '700' },
    sections: { gap: 20 },
    sectionBlock: { gap: 14 },
    tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  },
  [
    'cardTitle',
    'cardDetail',
    'kicker',
    'heroValue',
    'deltaText',
    'deltaTextDown',
    'axisLabel',
    'axisLabelStrong',
    'peakLabel',
    'hbarLabel',
    'hbarValue',
    'legendLabel',
    'legendValue',
    'partial',
    'cardNote',
  ] as const,
);
