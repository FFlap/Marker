import { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { Check, Clock3, Eye, Star, X } from 'lucide-react-native';
import { Image } from 'expo-image';
import { api } from '../../convex/_generated/api';
import { SecondaryHeader } from '@/components/BackButton';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { EmptyState } from '@/components/ui/primitives';
import { NativePressable } from '@/components/ui/NativePressable';
import { useToast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { createStyles } from '@/lib/typography';

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
      : `rated ${entry.title} ${entry.rating.toFixed(1)}/10`;
  if (entry.kind === 'status')
    return entry.status === 'watching'
      ? `started watching ${entry.title}`
      : `moved ${entry.title} to ${entry.status ?? 'another list'}`;
  if (entry.kind === 'finished') return `finished ${entry.title}`;
  return `watched ${entry.title} · S${entry.season} E${entry.episode}`;
}

export default function NotificationsScreen() {
  const requests = useQuery(api.profiles.followRequests);
  const activity = useQuery(api.notifications.feed) as Activity[] | undefined;
  const respond = useMutation(api.profiles.respondToFollow);
  const toast = useToast();
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const handle = async (username: string, accept: boolean) => {
    setPending((current) => new Set(current).add(username));
    try {
      await respond({ username, accept });
    } catch {
      toast.show('Couldn’t update this request');
    }
    setPending((current) => {
      const next = new Set(current);
      next.delete(username);
      return next;
    });
  };
  return (
    <View style={s.root}>
      <SecondaryHeader title="Notifications" fallback="/(tabs)" maxWidth={760} />
      <ScrollView contentContainerStyle={s.content}>
        {!!requests?.length && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>FOLLOW REQUESTS</Text>
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
                      <X size={16} color={colors.muted} />
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
        <View style={s.feedHead}>
          <Text style={s.sectionTitle}>FOLLOWING ACTIVITY</Text>
          <Text style={s.feedHint}>Manage in Settings</Text>
        </View>
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
    </View>
  );
}

const s = createStyles({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 88,
    paddingBottom: 80,
  },
  section: {
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingBottom: 24,
    marginBottom: 28,
  },
  sectionTitle: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  request: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 11 },
  identity: { flex: 1, minWidth: 0 },
  name: { color: colors.text, fontSize: 13, fontWeight: '700' },
  meta: { color: colors.muted, fontSize: 10, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 7 },
  smallButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accept: { backgroundColor: colors.text, borderColor: colors.text },
  pressed: { opacity: 0.62 },
  feedHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  feedHint: { color: colors.muted, fontSize: 9 },
  loader: { marginTop: 60 },
  activity: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
  },
  activityCopy: { flex: 1, minWidth: 0 },
  activityText: { color: colors.text, fontSize: 12, lineHeight: 18 },
  poster: { width: 34, height: 50, borderRadius: 5, backgroundColor: colors.surface },
  activityIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
