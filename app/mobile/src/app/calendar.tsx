import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAction } from 'convex/react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { api } from '../../convex/_generated/api';
import { SecondaryHeader } from '@/components/BackButton';
import { colors } from '@/constants/colors';
import { createStyles } from '@/lib/typography';

type CalendarEvent = {
  id: string;
  date: string;
  kind: 'movie' | 'episode';
  title: string;
  season?: number;
  episode?: number;
  episodeName?: string;
};
const keyFor = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const endOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0);
const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const deviceRegion = () => {
  const part = Intl.DateTimeFormat().resolvedOptions().locale.split('-').at(-1)?.toUpperCase();
  return part && /^[A-Z]{2}$/.test(part) ? part : 'US';
};

export default function CalendarScreen() {
  const upcoming = useAction(api.calendar.upcoming);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>();
  const [error, setError] = useState(false);
  const [partialFailure, setPartialFailure] = useState(false);
  const [cellHeight, setCellHeight] = useState(0);
  const today = keyFor(new Date());
  const start = startOfMonth(month);
  const end = endOfMonth(month);
  const startDate = keyFor(start);
  const endDate = keyFor(end);
  useEffect(() => {
    let ignore = false;
    const load = async () => {
      try {
        const result = await upcoming({ startDate, endDate, region: deviceRegion() });
        if (!ignore) {
          setEvents(result.events as CalendarEvent[]);
          setPartialFailure(result.failedTitles.count > 0);
        }
      } catch {
        if (!ignore) {
          setEvents([]);
          setError(true);
        }
      }
    };
    void load();
    return () => {
      ignore = true;
    };
  }, [endDate, startDate, upcoming]);
  const changeMonth = useCallback((next: Date) => {
    setEvents(undefined);
    setError(false);
    setPartialFailure(false);
    setMonth(startOfMonth(next));
  }, []);
  const moveMonth = useCallback(
    (offset: number) => {
      changeMonth(new Date(month.getFullYear(), month.getMonth() + offset, 1));
    },
    [changeMonth, month],
  );
  const monthSwipe = useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .activeOffsetX([-24, 24])
        .failOffsetY([-20, 20])
        .onEnd((event) => {
          const projected = event.translationX + event.velocityX * 0.08;
          if (Math.abs(projected) >= 64) runOnJS(moveMonth)(projected < 0 ? 1 : -1);
        }),
    [moveMonth],
  );
  const gridStart = addDays(start, -start.getDay());
  const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  const byDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events ?? []) {
      map.set(event.date, [...(map.get(event.date) ?? []), event]);
    }
    return map;
  }, [events]);
  const rowCapacity = Math.max(2, Math.floor((cellHeight - 31) / 17));
  return (
    <View style={s.root}>
      <SecondaryHeader title="Calendar" fallback="/(tabs)" maxWidth={720} />
      <View style={s.content}>
        <View style={s.monthHead}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            onPress={() => moveMonth(-1)}
            hitSlop={8}
            style={s.arrow}
          >
            <ChevronLeft size={18} color={colors.text} />
          </Pressable>
          <Text accessibilityLiveRegion="polite" style={s.month}>
            {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next month"
            onPress={() => moveMonth(1)}
            hitSlop={8}
            style={s.arrow}
          >
            <ChevronRight size={18} color={colors.text} />
          </Pressable>
        </View>
        <View style={s.week}>
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
            <Text key={`${day}:${index}`} style={s.weekday}>
              {day}
            </Text>
          ))}
        </View>
        <GestureDetector gesture={monthSwipe}>
          <View
            accessibilityLabel="Calendar month. Swipe left or right to change months."
            style={s.grid}
            testID="calendar-month-grid"
          >
            {days.map((day, index) => {
              const date = keyFor(day);
              const active = date === today;
              const inMonth = day.getMonth() === month.getMonth();
              const dayEvents = byDate.get(date) ?? [];
              const hasOverflow = dayEvents.length > rowCapacity;
              const visibleCount = hasOverflow ? Math.max(0, rowCapacity - 1) : dayEvents.length;
              const overflowCount = dayEvents.length - visibleCount;
              return (
                <Pressable
                  key={date}
                  accessibilityRole="button"
                  accessibilityLabel={`${day.toLocaleDateString()}, ${dayEvents.length} release${dayEvents.length === 1 ? '' : 's'}`}
                  accessibilityState={{ selected: active }}
                  onPress={() => router.push({ pathname: '/calendar/[date]', params: { date } })}
                  onLayout={
                    index === 0
                      ? (event) => {
                          const nextHeight = event.nativeEvent.layout.height;
                          if (Math.abs(nextHeight - cellHeight) > 0.5) setCellHeight(nextHeight);
                        }
                      : undefined
                  }
                  style={[s.day, index % 7 !== 6 && s.dayColumn]}
                >
                  <Text style={[s.dayText, !inMonth && s.dayOutside, active && s.dayTextSelected]}>
                    {day.getDate()}
                  </Text>
                  {inMonth && dayEvents.length > 0 && (
                    <View style={s.dayEvents}>
                      {dayEvents.slice(0, visibleCount).map((event) => (
                        <View key={event.id} style={s.dayEvent}>
                          <Text numberOfLines={1} style={s.dayEventTitle}>
                            {event.title}
                          </Text>
                        </View>
                      ))}
                      {hasOverflow && (
                        <Text numberOfLines={1} style={s.more}>
                          +{overflowCount} more
                        </Text>
                      )}
                    </View>
                  )}
                </Pressable>
              );
            })}
          </View>
        </GestureDetector>
        {error && <Text style={s.error}>Couldn’t refresh release dates. Try again shortly.</Text>}
        {!error && partialFailure && (
          <Text accessibilityLiveRegion="polite" style={s.notice}>
            Some titles could not be loaded.
          </Text>
        )}
      </View>
    </View>
  );
}

const s = createStyles({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingTop: 72,
    paddingBottom: 12,
  },
  monthHead: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  month: { color: colors.text, fontSize: 17, fontWeight: '700' },
  arrow: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  week: { height: 28, flexDirection: 'row', alignItems: 'center' },
  weekday: {
    width: '14.2857%',
    color: colors.muted,
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'center',
  },
  grid: {
    flex: 1,
    minHeight: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  day: {
    width: '14.2857%',
    height: '16.6667%',
    borderTopWidth: 1,
    borderColor: colors.border,
    minWidth: 0,
    minHeight: 0,
    paddingHorizontal: 4,
    paddingVertical: 5,
    overflow: 'hidden',
  },
  dayColumn: { borderRightWidth: 1 },
  dayText: {
    alignSelf: 'flex-end',
    width: 20,
    height: 20,
    color: colors.text,
    fontSize: 10,
    lineHeight: 20,
    fontWeight: '600',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  dayOutside: { color: colors.muted },
  dayTextSelected: { color: colors.bg, backgroundColor: colors.text, borderRadius: 10 },
  dayEvents: { gap: 2, minWidth: 0, marginTop: 3 },
  dayEvent: {
    minWidth: 0,
    height: 15,
    borderRadius: 3,
    backgroundColor: colors.elevated,
    paddingHorizontal: 3,
    justifyContent: 'center',
  },
  dayEventTitle: { color: colors.text, fontSize: 8, lineHeight: 11, fontWeight: '600' },
  more: { color: colors.muted, fontSize: 8, lineHeight: 11, paddingHorizontal: 3 },
  error: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 14,
    color: colors.danger,
    backgroundColor: colors.bg,
    fontSize: 12,
    lineHeight: 18,
    paddingVertical: 6,
  },
  notice: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 14,
    color: colors.muted,
    backgroundColor: colors.bg,
    fontSize: 12,
    lineHeight: 18,
    paddingVertical: 6,
  },
});
