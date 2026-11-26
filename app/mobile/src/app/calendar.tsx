import { ScreenView } from '@/components/ScreenLayout';
import { useCallback, useMemo, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { SecondaryHeader } from '@/components/BackButton';
import { colors } from '@/constants/colors';
import { IconButton } from '@/components/ui/primitives';
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
  // Only the weeks this month touches, so short months don't end in a row of next month.
  const daysInMonth = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((start.getDay() + daysInMonth) / 7);
  const days = Array.from({ length: weeks * 7 }, (_, index) => addDays(gridStart, index));
  const monthKey = keyFor(visibleMonth).slice(0, 7);
  const quietMonth =
    !loading &&
    !error &&
    !partialFailure &&
    events !== undefined &&
    !events.some((event) => event.date.startsWith(monthKey));
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
          {canGoBack ? (
            // The same icon buttons as everywhere else.
            <IconButton
              icon={ChevronLeft}
              accessibilityLabel="Previous month"
              onPress={() => moveMonth(-1)}
            />
          ) : (
            <View style={s.arrow} />
          )}
          <View style={s.monthCopy}>
            <Text accessibilityLiveRegion="polite" style={s.month}>
              {visibleMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </Text>
            {/* Under the month, where the settled "no releases" note goes, so a month still
                loading never reads as an empty one. */}
            {loading ? (
              <Text accessibilityLiveRegion="polite" style={s.monthNote}>
                {result?.needsRefresh && result.events.length > 0
                  ? 'Updating release dates…'
                  : 'Loading releases…'}
              </Text>
            ) : (
              quietMonth && <Text style={s.monthNote}>No releases from your library</Text>
            )}
          </View>
          <IconButton
            icon={ChevronRight}
            accessibilityLabel="Next month"
            onPress={() => moveMonth(1)}
          />
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
                  // A count only once releases are known, not "0 releases" while loading.
                  accessibilityLabel={
                    events === undefined
                      ? day.toLocaleDateString()
                      : `${day.toLocaleDateString()}, ${dayEvents.length} release${dayEvents.length === 1 ? '' : 's'}`
                  }
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
                  style={[s.day, { height: `${100 / weeks}%` }, index % 7 !== 6 && s.dayColumn]}
                >
                  <Text
                    style={[
                      s.dayText,
                      // Neighbouring-month days still open; only unavailable (past) days fade.
                      !inMonth && (past ? s.dayUnavailable : s.dayOutside),
                      active && s.dayTextSelected,
                    ]}
                  >
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
      paddingHorizontal: 20,
      paddingTop: 72,
      paddingBottom: 12,
    },
    monthHead: {
      minHeight: 52,
      // Pull the arrow buttons out so their icons sit on the page margin.
      marginHorizontal: -13,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    monthCopy: { flex: 1, alignItems: 'center', gap: 2 },
    month: { color: colors.text, fontSize: 17, fontWeight: '700' },
    monthNote: { color: colors.muted, fontSize: 12, lineHeight: 16 },
    // Holds the place of the hidden "Previous month" button.
    arrow: { width: 40, height: 40 },
    week: { height: 28, flexDirection: 'row', alignItems: 'center' },
    weekday: {
      width: '14.2857%',
      color: colors.muted,
      fontSize: 11,
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
      alignSelf: 'center',
      width: 24,
      height: 24,
      color: colors.text,
      fontSize: 12,
      lineHeight: 24,
      fontWeight: '600',
      textAlign: 'center',
      fontVariant: ['tabular-nums'],
      borderRadius: 12,
      overflow: 'hidden',
    },
    dayOutside: { color: colors.muted },
    dayUnavailable: { color: colors.faint },
    dayTextSelected: { color: colors.bg, backgroundColor: colors.text },
    dayEvents: { gap: 2, minWidth: 0, marginTop: 3 },
    dayEvent: {
      minWidth: 0,
      height: 16,
      borderRadius: 6,
      backgroundColor: colors.elevated,
      paddingHorizontal: 4,
      justifyContent: 'center',
    },
    dayEventTitle: { color: colors.text, fontSize: 9, lineHeight: 12, fontWeight: '600' },
    more: { color: colors.muted, fontSize: 9, lineHeight: 12, paddingHorizontal: 4 },
    status: { minHeight: 48, justifyContent: 'center' },
    retry: { minHeight: 44, justifyContent: 'center' },
    error: { color: colors.danger, fontSize: 12, lineHeight: 18 },
    notice: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  },
  [
    'month',
    'monthNote',
    'weekday',
    'dayText',
    'dayOutside',
    'dayUnavailable',
    'dayTextSelected',
    'dayEventTitle',
    'more',
    'error',
    'notice',
  ] as const,
);
