import { ScreenView } from '@/components/ScreenLayout';
import { useCallback, useMemo, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { SecondaryHeader } from '@/components/BackButton';
import { colors } from '@/constants/colors';
import { type CalendarEvent } from '@marker/shared/calendar';
import { useCalendar } from '@/hooks/useCalendar';
import { createAppStyles } from '@/lib/typography';
const keyFor = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const addDays = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

export default function CalendarScreen() {
  const [month, setMonth] = useState(() => startOfMonth(new Date(Date.now())));
  const [cellHeight, setCellHeight] = useState(0);
  const [today, setToday] = useState(() => keyFor(new Date(Date.now())));
  useFocusEffect(
    useCallback(() => {
      const update = () => setToday(keyFor(new Date(Date.now())));
      update();
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') update();
      });
      return () => subscription.remove();
    }, []),
  );
  const minimumMonth = today.slice(0, 7);
  const visibleMonth =
    keyFor(month).slice(0, 7) < minimumMonth ? new Date(`${minimumMonth}-01T00:00:00`) : month;
  const start = startOfMonth(visibleMonth);
  const canGoBack = keyFor(start).slice(0, 7) > minimumMonth;
  const { result, loading, error, retry } = useCalendar(keyFor(start), true);
  const events = result?.events;
  const partialFailure = (result?.failedTitles.count ?? 0) > 0;
  const moveMonth = useCallback((offset: number) => {
    setMonth((current) => {
      const minimum = startOfMonth(new Date(Date.now()));
      const base = current < minimum ? minimum : current;
      const next = new Date(base.getFullYear(), base.getMonth() + offset, 1);
      return next < minimum ? minimum : next;
    });
  }, []);
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
      const dayEvents = map.get(event.date);
      if (dayEvents) dayEvents.push(event);
      else map.set(event.date, [event]);
    }
    return map;
  }, [events]);
  const rowCapacity = Math.max(2, Math.floor((cellHeight - 31) / 17));
  return (
    <ScreenView style={s.root}>
      <SecondaryHeader title="Calendar" fallback="/(tabs)" maxWidth={720} />
      <View style={s.content}>
        <View style={s.monthHead}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            accessibilityState={{ disabled: !canGoBack }}
            disabled={!canGoBack}
            onPress={() => moveMonth(-1)}
            hitSlop={8}
            style={s.arrow}
          >
            <ChevronLeft size={18} color={canGoBack ? colors.text : colors.muted} />
          </Pressable>
          <Text accessibilityLiveRegion="polite" style={s.month}>
            {visibleMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
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
              const inMonth = day.getMonth() === visibleMonth.getMonth();
              const past = date.slice(0, 7) < minimumMonth;
              const dayEvents = byDate.get(date) ?? [];
              const hasOverflow = dayEvents.length > rowCapacity;
              const visibleCount = hasOverflow ? Math.max(0, rowCapacity - 1) : dayEvents.length;
              const overflowCount = dayEvents.length - visibleCount;
              return (
                <Pressable
                  key={date}
                  accessibilityRole="button"
                  accessibilityLabel={`${day.toLocaleDateString()}, ${dayEvents.length} release${dayEvents.length === 1 ? '' : 's'}`}
                  accessibilityState={{ selected: active, disabled: past }}
                  disabled={past}
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
        <View style={s.status}>
          {loading && (
            <Text accessibilityLiveRegion="polite" style={s.notice}>
              {result?.needsRefresh && result.events.length > 0
                ? 'Updating release dates…'
                : 'Loading releases for your library…'}
            </Text>
          )}
          {!loading && (error || partialFailure) && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading releases"
              onPress={retry}
              style={s.retry}
            >
              <Text style={error ? s.error : s.notice}>
                {error ? 'Couldn’t refresh release dates.' : 'Some titles could not be loaded.'} Tap
                to retry.
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </ScreenView>
  );
}

const s = createAppStyles(
  {
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
    status: { minHeight: 48, justifyContent: 'center' },
    retry: { minHeight: 44, justifyContent: 'center' },
    error: { color: colors.danger, fontSize: 12, lineHeight: 18 },
    notice: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  },
  [
    'month',
    'weekday',
    'dayText',
    'dayOutside',
    'dayTextSelected',
    'dayEventTitle',
    'more',
    'error',
    'notice',
  ] as const,
);
