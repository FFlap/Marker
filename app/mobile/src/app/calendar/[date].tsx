import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAction } from 'convex/react';
import { Film, Tv2 } from 'lucide-react-native';
import { api } from '../../../convex/_generated/api';
import { SecondaryHeader } from '@/components/BackButton';
import { EmptyState } from '@/components/ui/primitives';
import { colors } from '@/constants/colors';
import { type CalendarEvent, deviceRegion } from '@/lib/calendar';
import { createAppStyles } from '@/lib/typography';

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

export default function CalendarDayScreen() {
  const params = useLocalSearchParams<{ date?: string | string[] }>();
  const date = Array.isArray(params.date) ? (params.date[0] ?? '') : (params.date ?? '');
  return <CalendarDay key={date} date={date} />;
}

function CalendarDay({ date }: { date: string }) {
  const upcoming = useAction(api.calendar.upcoming);
  const [events, setEvents] = useState<CalendarEvent[]>();
  const [error, setError] = useState(false);
  const [partialFailure, setPartialFailure] = useState(false);
  const isValid = validDate(date);
  const parsedDate = isValid ? new Date(`${date}T00:00:00`) : undefined;
  const title = parsedDate
    ? parsedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
    : 'Schedule';

  useEffect(() => {
    let ignore = false;
    if (!isValid) {
      return () => {
        ignore = true;
      };
    }
    const load = async () => {
      try {
        const result = await upcoming({ startDate: date, endDate: date, region: deviceRegion() });
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
  }, [date, isValid, upcoming]);

  return (
    <View style={s.root}>
      <SecondaryHeader title={title} fallback="/calendar" maxWidth={720} />
      <ScrollView contentContainerStyle={s.content}>
        {!error && partialFailure && (
          <Text accessibilityLiveRegion="polite" style={s.notice}>
            Some titles could not be loaded.
          </Text>
        )}
        {!isValid || error ? (
          <Text style={s.error}>Couldn’t load this day’s schedule. Try again shortly.</Text>
        ) : events === undefined ? (
          <ActivityIndicator color={colors.muted} style={s.loading} />
        ) : events.length ? (
          <View style={s.list}>
            {events.map((event) => {
              const Icon = event.kind === 'movie' ? Film : Tv2;
              return (
                <View key={event.id} style={s.event}>
                  <View style={s.eventIcon}>
                    <Icon size={18} color={colors.text} strokeWidth={1.8} />
                  </View>
                  <View style={s.eventCopy}>
                    <Text style={s.eventTitle}>{event.title}</Text>
                    {event.episodeName && (
                      <Text numberOfLines={2} style={s.episodeName}>
                        {event.episodeName}
                      </Text>
                    )}
                    <Text style={s.eventMeta}>
                      {event.kind === 'movie'
                        ? 'Movie release'
                        : event.season !== undefined && event.episode !== undefined
                          ? `Season ${event.season} · Episode ${event.episode}`
                          : 'New episode'}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <EmptyState
            title="No releases"
            detail="Nothing in your library is scheduled for this day."
          />
        )}
      </ScrollView>
    </View>
  );
}

const s = createAppStyles(
  {
    root: { flex: 1, backgroundColor: colors.bg },
    content: {
      width: '100%',
      maxWidth: 720,
      minHeight: '100%',
      alignSelf: 'center',
      paddingHorizontal: 20,
      paddingTop: 88,
      paddingBottom: 72,
    },
    loading: { marginTop: 56 },
    error: { color: colors.danger, fontSize: 13, lineHeight: 20, marginTop: 32 },
    notice: { color: colors.muted, fontSize: 12, lineHeight: 18, marginBottom: 16 },
    list: { borderTopWidth: 1, borderColor: colors.border },
    event: {
      minHeight: 88,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      borderBottomWidth: 1,
      borderColor: colors.border,
      paddingVertical: 14,
    },
    eventIcon: {
      width: 40,
      height: 40,
      borderRadius: 8,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    eventCopy: { flex: 1, minWidth: 0 },
    eventTitle: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '700' },
    episodeName: { color: colors.text, fontSize: 12, lineHeight: 17, marginTop: 4 },
    eventMeta: { color: colors.muted, fontSize: 11, marginTop: 5 },
  },
  ['error', 'notice', 'eventTitle', 'episodeName', 'eventMeta'] as const,
);
