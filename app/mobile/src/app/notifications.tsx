import { usePendingTasks } from '@/hooks/use-pending-tasks';
import { ScreenView } from '@/components/ScreenLayout';
import * as Effect from 'effect/Effect';
import { saveProfile } from '@marker/shared/clientEffects';
import { useOperation } from '@/hooks/use-operation';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import Check from 'lucide-react-native/icons/check';
import Clock3 from 'lucide-react-native/icons/clock-3';
import Eye from 'lucide-react-native/icons/eye';
import Star from 'lucide-react-native/icons/star';
import X from 'lucide-react-native/icons/x';
import { Image } from 'expo-image';
import { api } from '@marker/shared/api';
import { SecondaryHeader } from '@/components/BackButton';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { EmptyState, IconButton, SectionHeading } from '@/components/ui/primitives';
import Settings from 'lucide-react-native/icons/settings';
import { router, type Href } from 'expo-router';
import { NativePressable } from '@/components/ui/NativePressable';
import { useToast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';

type Activity = FunctionReturnType<typeof api.notifications.feed>[number];

const poster = (path?: string) => (path ? `https://image.tmdb.org/t/p/w185${path}` : undefined);
function relativeTime(value: number) {
  const seconds = Math.max(1, Math.floor((Date.now() - value) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}
function detail(entry: Activity) {
  if (entry.kind === 'rating')
    return entry.rating === undefined
      ? `removed their rating for ${entry.title}`
      : `rated ${entry.title} ${entry.rating.toFixed(1)}/5`;
  if (entry.kind === 'status')
    return entry.status === 'watching'
      ? `started watching ${entry.title}`
      : `moved ${entry.title} to ${entry.status ?? 'another list'}`;
  if (entry.kind === 'finished') return `finished ${entry.title}`;
  return `watched ${entry.title} · S${entry.season} E${entry.episode}`;
}

export default function NotificationsScreen() {
  const runOperation = useOperation();
  const requests = useQuery(api.profiles.followRequests);
  const activity = useQuery(api.notifications.feed) as Activity[] | undefined;
  const respond = useMutation(api.profiles.respondToFollow);
  const toast = useToast();
  const [pending, setPending] = usePendingTasks();
  const handle = async (username: string, accept: boolean) => {
    setPending((current) => new Set(current).add(username));
    await runOperation.write(
      Effect.gen(function* () {
        yield* saveProfile(() => respond({ username, accept }));
      }),
      {
        failure: () => {
          toast.show('Couldn’t update this request');
        },
        settled: () => {
          setPending((current) => {
            const next = new Set(current);
            next.delete(username);
            return next;
          });
        },
      },
    );
  };
  return (
    <ScreenView style={s.root}>
      <SecondaryHeader
        title="Notifications"
        fallback="/(tabs)"
        maxWidth={760}
        right={
          <IconButton
            icon={Settings}
            accessibilityLabel="Notification settings"
            onPress={() => router.push('/settings/notifications' as Href)}
          />
        }
      />
      <ScrollView contentContainerStyle={s.content}>
        {!!requests?.length && (
          <View style={s.section}>
            <SectionHeading title="Follow requests" count={requests.length} />
            {requests.map((request) => (
              <View key={request.username} style={s.request}>
                <ProfileAvatar
                  username={request.username}
                  avatarUrl={request.avatarUrl}
                  size={42}
                />
                <View style={s.identity}>
                  <Text style={s.name}>@{request.username}</Text>
                  <Text style={s.meta}>{request.followerCount} followers</Text>
                </View>
                {pending.has(request.username) ? (
                  <ActivityIndicator color={colors.muted} />
                ) : (
                  <View style={s.actions}>
                    <NativePressable
                      accessibilityRole="button"
                      accessibilityLabel={`Decline @${request.username}`}
                      onPress={() => void handle(request.username, false)}
                      hitSlop={3}
                      style={s.smallButton}
                      pressedStyle={s.pressed}
                    >
                      <X size={16} color={colors.text} />
                    </NativePressable>
                    <NativePressable
                      accessibilityRole="button"
                      accessibilityLabel={`Accept @${request.username}`}
                      onPress={() => void handle(request.username, true)}
                      hitSlop={3}
                      style={[s.smallButton, s.accept]}
                      pressedStyle={s.pressed}
                    >
                      <Check size={16} color={colors.bg} />
                    </NativePressable>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}
        {/* With no requests above, the screen title already says what this list is. */}
        {!!requests?.length && <SectionHeading title="Activity" />}
        {activity === undefined ? (
          <ActivityIndicator
            accessibilityLabel="Loading activity"
            color={colors.muted}
            style={s.loader}
          />
        ) : activity.length ? (
          <View>
            {activity.map((entry) => {
              const Icon = entry.kind === 'rating' ? Star : entry.kind === 'status' ? Eye : Clock3;
              return (
                <View key={entry.id} style={s.activity}>
                  <ProfileAvatar
                    username={entry.actorUsername}
                    avatarUrl={entry.avatarUrl}
                    size={40}
                  />
                  <View style={s.activityCopy}>
                    <Text style={s.activityText}>
                      <Text style={s.name}>@{entry.actorUsername}</Text> {detail(entry)}
                    </Text>
                    <Text style={s.meta}>{relativeTime(entry.occurredAt)}</Text>
                  </View>
                  {entry.posterPath ? (
                    <Image
                      source={poster(entry.posterPath)}
                      accessibilityLabel={`${entry.title} poster`}
                      contentFit="cover"
                      style={s.poster}
                    />
                  ) : (
                    <View style={s.activityIcon}>
                      <Icon size={16} color={colors.muted} />
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        ) : (
          <EmptyState
            title="Nothing new yet"
            detail="Activity from people you follow will appear here."
          />
        )}
      </ScrollView>
    </ScreenView>
  );
}

const s = createAppStyles(
  {
    root: { flex: 1, backgroundColor: colors.bg },
    content: {
      width: '100%',
      maxWidth: 760,
      alignSelf: 'center',
      paddingHorizontal: 20,
      paddingTop: 88,
      paddingBottom: 80,
    },
    section: { marginBottom: 28, gap: 4 },
    request: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12 },
    identity: { flex: 1, minWidth: 0 },
    name: { color: colors.text, fontSize: 15, fontWeight: '600' },
    meta: { color: colors.muted, fontSize: 12, marginTop: 3 },
    actions: { flexDirection: 'row', gap: 8 },
    smallButton: {
      width: 36,
      height: 36,
      borderRadius: radius.pill,
      backgroundColor: colors.elevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    accept: { backgroundColor: colors.text },
    pressed: { opacity: 0.62 },
    loader: { marginTop: 60 },
    activity: {
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
    },
    activityCopy: { flex: 1, minWidth: 0 },
    activityText: { color: colors.secondary, fontSize: 14, lineHeight: 20 },
    poster: { width: 36, height: 54, borderRadius: radius.xs, backgroundColor: colors.surface },
    activityIcon: {
      width: 36,
      height: 36,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
  },
  ['name', 'meta', 'activityText'] as const,
);
