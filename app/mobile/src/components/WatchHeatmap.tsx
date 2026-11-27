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

// Rows run Sunday to Saturday.
const WEEKDAY_MARKS = ['', 'M', '', 'W', '', 'F', ''];

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
    : // The heading already says the span ("Last 21 weeks").
      episodesLabel(heatmap.total);
  return (
    <View style={s.root}>
      <Text accessibilityRole="header" style={s.section}>
        Last {weekCount} weeks
      </Text>
      <View style={s.body}>
        {/* Mon / Wed / Fri, so a single bright cell can be read as a day of the week. */}
        <View
          style={s.weekdays}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {WEEKDAY_MARKS.map((mark, index) => (
            <Text
              key={index}
              style={[
                s.weekday,
                { height: cell, lineHeight: cell, marginBottom: index < 6 ? GAP : 0 },
              ]}
            >
              {mark}
            </Text>
          ))}
        </View>
        <View
          style={s.chart}
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
            <View
              key={color}
              style={[
                s.legendCell,
                { backgroundColor: color },
                // "Less" is the empty-cell colour; an outline shows it's part of the scale.
                color === LEVEL_COLORS[0] && s.legendCellEmpty,
              ]}
            />
          ))}
          <Text style={s.legendText}>More</Text>
        </View>
      </View>
    </View>
  );
}

const s = createAppStyles(
  {
    root: { gap: 12 },
    section: { color: colors.text, fontSize: 15, fontWeight: '700' },
    months: { position: 'relative', marginBottom: 4 },
    body: { flexDirection: 'row', gap: 6 },
    // Starts below the month labels (14 tall, 4 below), level with the first row.
    weekdays: { width: 12, marginTop: 18 },
    weekday: { color: colors.muted, fontSize: 9, fontWeight: '600', textAlign: 'center' },
    chart: { flex: 1 },
    month: { position: 'absolute', top: 0, color: colors.muted, fontSize: 10, fontWeight: '600' },
    grid: { flexDirection: 'row', gap: GAP },
    column: { gap: GAP, pointerEvents: 'none' },
    selected: { borderWidth: 1, borderColor: colors.muted },
    footer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    caption: { flexGrow: 1, flexShrink: 1, flexBasis: 180, color: colors.muted, fontSize: 12 },
    legend: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    legendText: { color: colors.muted, fontSize: 9, marginHorizontal: 2 },
    legendCell: { width: 9, height: 9, borderRadius: 2 },
    legendCellEmpty: { borderWidth: 1, borderColor: colors.border },
  },
  ['section', 'month', 'caption', 'legendText', 'weekday'] as const,
);
