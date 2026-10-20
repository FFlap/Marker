import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Film, Tv2 } from 'lucide-react-native';
import { SecondaryHeader } from '@/components/BackButton';
import { EmptyState } from '@/components/ui/primitives';
import { colors } from '@/constants/colors';
import { useCalendar } from '@/hooks/useCalendar';
import { createAppStyles } from '@/lib/typography';

export default function CalendarDayScreen() {
  const params = useLocalSearchParams<{ date?: string | string[] }>();
  const date = Array.isArray(params.date) ? (params.date[0] ?? '') : (params.date ?? '');
  return <CalendarDay key={date} date={date} />;
}

function CalendarDay({ date }: { date: string }) {
  const { result, loading, error, valid: isValid, past, retry } = useCalendar(date);
  const events = result?.events.filter((event) => event.date === date);
  const partialFailure = (result?.failedTitles.count ?? 0) > 0;
  const parsedDate = isValid ? new Date(`${date}T00:00:00`) : undefined;
  const title = parsedDate
    ? parsedDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
    : 'Schedule';

  return (
    <View style={s.root}>
      <SecondaryHeader title={title} fallback="/calendar" maxWidth={720} />
      <ScrollView contentContainerStyle={s.content}>
        {(error || partialFailure) && isValid && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry loading releases"
            onPress={retry}
            disabled={loading}
          >
            <Text accessibilityLiveRegion="polite" style={s.notice}>
              {error ? 'Couldn’t load this day’s schedule.' : 'Some titles could not be loaded.'}{' '}
              {loading ? 'Retrying…' : 'Tap to retry.'}
            </Text>
          </Pressable>
        )}
        {!isValid ? (
          <Text style={s.error}>This calendar date is invalid.</Text>
        ) : past ? (
          <Text style={s.notice}>The calendar shows releases from this month onward.</Text>
        ) : !events?.length && loading ? (
          <ActivityIndicator
            accessibilityLabel="Loading releases"
            color={colors.muted}
            style={s.loading}
          />
        ) : events?.length ? (
          <View style={s.list}>
            {loading && (
              <Text style={s.notice}>
                {result?.needsRefresh ? 'Updating release dates…' : 'Loading more releases…'}
              </Text>
            )}
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
        ) : error || partialFailure ? null : (
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
