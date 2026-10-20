import { useMemo, useState } from 'react';
import { Pressable, Text, View, type GestureResponderEvent } from 'react-native';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';
import {
  buildActivityHeatmap,
  formatActivityDate,
  type WatchActivityDay,
} from '@marker/shared/watchActivityStats';

const TARGET_CELL = 12;
const GAP = 3;
const MAX_WEEKS = 53;
const LEVEL_COLORS = [
  colors.elevated,
  'rgba(244, 244, 245, 0.24)',
  'rgba(244, 244, 245, 0.46)',
  'rgba(244, 244, 245, 0.72)',
  colors.text,
] as const;

const episodesLabel = (count: number) =>
  `${count.toLocaleString()} episode${count === 1 ? '' : 's'}`;

export function WatchHeatmap({ days, today }: { days: WatchActivityDay[]; today: string }) {
  const [width, setWidth] = useState(0);
  const [selectedDate, setSelectedDate] = useState<string>();
  const weekCount = Math.max(
    1,
    Math.min(MAX_WEEKS, Math.floor((width + GAP) / (TARGET_CELL + GAP))),
  );
  const cell = width ? (width - GAP * (weekCount - 1)) / weekCount : TARGET_CELL;
  const heatmap = useMemo(
    () => buildActivityHeatmap(days, today, weekCount),
    [days, today, weekCount],
  );
  const cells = heatmap.weeks.flat().filter((day) => day !== null);
  const selected = cells.find((day) => day.date === selectedDate);
  const accessibleIndex = selected ? cells.indexOf(selected) : cells.length - 1;
  const accessibleDay = cells[accessibleIndex]!;
  const select = (event: GestureResponderEvent) => {
    const { locationX, locationY } = event.nativeEvent;
    const week = Math.floor(locationX / (cell + GAP));
    const weekday = Math.floor(locationY / (cell + GAP));
    const next = heatmap.weeks[week]?.[weekday] ?? undefined;
    setSelectedDate((current) => (next && current !== next.date ? next.date : undefined));
  };
  const caption = selected
    ? `${episodesLabel(selected.episodes)} · ${formatActivityDate(selected.date)}`
    : `${episodesLabel(heatmap.total)} in the last ${weekCount} ${weekCount === 1 ? 'week' : 'weeks'}`;
  return (
    <View style={s.root}>
      <Text style={s.section}>Watch Activity</Text>
      <View
        testID="watch-activity-heatmap"
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      >
        {width > 0 && (
          <>
            <View style={[s.months, { height: 14 }]}>
              {heatmap.months.map(({ week, label }) => (
                <Text
                  key={week}
                  style={[
                    s.month,
                    week === weekCount - 1 ? { right: 0 } : { left: week * (cell + GAP) },
                  ]}
                >
                  {label}
                </Text>
              ))}
            </View>
            <Pressable
              accessibilityRole="adjustable"
              accessibilityLabel="Daily watch activity"
              accessibilityHint="Adjust to read the previous or next day."
              accessibilityValue={{
                min: 1,
                max: cells.length,
                now: accessibleIndex + 1,
                text: `${episodesLabel(accessibleDay.episodes)} on ${formatActivityDate(accessibleDay.date)}`,
              }}
              accessibilityActions={[
                { name: 'increment', label: 'Next day' },
                { name: 'decrement', label: 'Previous day' },
              ]}
              onAccessibilityAction={({ nativeEvent: { actionName } }) => {
                if (actionName !== 'increment' && actionName !== 'decrement') return;
                const next = accessibleIndex + (actionName === 'increment' ? 1 : -1);
                setSelectedDate(cells[Math.max(0, Math.min(cells.length - 1, next))]!.date);
              }}
              onPress={select}
              style={s.grid}
            >
              {heatmap.weeks.map((column, week) => (
                <View key={week} style={s.column}>
                  {column.map((day, weekday) => (
                    <View
                      key={weekday}
                      style={[
                        { width: cell, height: cell, borderRadius: Math.min(3, cell / 4) },
                        day
                          ? { backgroundColor: LEVEL_COLORS[day.level] }
                          : { backgroundColor: 'transparent' },
                        day && day.date === selected?.date && s.selected,
                      ]}
                    />
                  ))}
                </View>
              ))}
            </Pressable>
          </>
        )}
      </View>
      <View style={s.footer}>
        <Text style={s.caption}>{caption}</Text>
        <View
          style={s.legend}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={s.legendText}>Less</Text>
          {LEVEL_COLORS.map((color) => (
            <View key={color} style={[s.legendCell, { backgroundColor: color }]} />
          ))}
          <Text style={s.legendText}>More</Text>
        </View>
      </View>
    </View>
  );
}

const s = createAppStyles(
  {
    root: { gap: 12, paddingBottom: 24, borderBottomWidth: 1, borderColor: colors.border },
    section: { color: colors.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
    months: { position: 'relative', marginBottom: 4 },
    month: { position: 'absolute', top: 0, color: colors.muted, fontSize: 9, fontWeight: '600' },
    grid: { flexDirection: 'row', gap: GAP },
    // Touches land on the grid itself so locations are grid-relative.
    column: { gap: GAP, pointerEvents: 'none' },
    selected: { borderWidth: 1, borderColor: colors.muted },
    footer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    caption: { flexGrow: 1, flexShrink: 1, flexBasis: 180, color: colors.muted, fontSize: 11 },
    legend: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    legendText: { color: colors.muted, fontSize: 9, marginHorizontal: 2 },
    legendCell: { width: 9, height: 9, borderRadius: 2 },
  },
  ['section', 'month', 'caption', 'legendText'] as const,
);
