import { usePendingTasks } from '@/hooks/use-pending-tasks';
import { useSharedValue } from 'react-native-reanimated';
import { ScreenView } from '@/components/ScreenLayout';
import * as Effect from 'effect/Effect';
import { saveProfile } from '@marker/shared/clientEffects';
import { useOperation } from '@/hooks/use-operation';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from 'convex/react';
import { useStartupQuery as useQuery } from '@/hooks/useStartupQuery';
import { StartupSyncStatus } from '@/components/StartupSyncStatus';
import Globe2 from 'lucide-react-native/icons/earth';
import LockKeyhole from 'lucide-react-native/icons/lock-keyhole';
import Pencil from 'lucide-react-native/icons/pencil';
import { api } from '@marker/shared/api';
import { useToast } from '@/components/ui/Toast';
import { NativePressable } from '@/components/ui/NativePressable';
import { Button } from '@/components/ui/primitives';
import { SwipePages } from '@/components/SwipePages';
import { colors } from '@/constants/colors';
import { radius, typeRamp } from '@/constants/theme';
import { ScreenErrorBoundary } from '@/components/ScreenErrorBoundary';
import { SecondaryHeader } from '@/components/BackButton';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { ProfileCollection, ProfileMetrics } from '@/components/ProfileStats';
import { ProfileTabs, type ProfileTab } from '@/components/ProfileTabs';
import { useTabScrollMemory } from '@/hooks/use-tab-scroll-memory';
import { PublicTagsSection } from '@/components/PublicTagsSection';
import { ProfilePageSkeleton } from '@/components/PageSkeletons';
import { createAppStyles } from '@/lib/typography';
import { useLocalToday } from '@/hooks/use-local-today';
import { isAlsoWatching } from '@/lib/libraryFilters';

export default function Profile() {
  return (
    <ScreenErrorBoundary message="Couldn’t calculate your profile.">
      <ProfileContent />
    </ScreenErrorBoundary>
  );
}

function ProfileContent() {
  const runOperation = useOperation();
  const profile = useQuery(api.profiles.me);
  const stats = useQuery(api.stats.profile);
  const publicTags = useQuery(api.tags.myPublic);
  const requests = useQuery(api.profiles.followRequests);
  const items = useQuery(api.library.items.listItems);
  const settings = useQuery(api.settings.getSettings);
  const today = useLocalToday();
  const alsoWatching = (items ?? []).filter((item) =>
    isAlsoWatching(item, settings?.airingInWatching !== false, today),
  ).length;
  const respond = useMutation(api.profiles.respondToFollow);
  const toast = useToast();
  const [requestPending, setRequestPending] = usePendingTasks();
  const [tab, setTab] = useState<ProfileTab>('collection');
  const tabScroll = useTabScrollMemory(tab, { topInset: CONTENT_TOP });
  const pagerPosition = useSharedValue(0);
  if (profile === undefined || stats === undefined) {
    return (
      <ScreenView style={s.root}>
        <SecondaryHeader title="Profile" maxWidth={880} />
        <ProfilePageSkeleton />
      </ScreenView>
    );
  }
  const VisibilityIcon = profile.isPublic ? Globe2 : LockKeyhole;
  const handleRequest = async (username: string, accept: boolean) => {
    setRequestPending((current) => new Set(current).add(username));
    await runOperation.write(
      Effect.gen(function* () {
        yield* saveProfile(() => respond({ username, accept }));
      }),
      {
        failure: () => {
          toast.show('Couldn’t update this request');
        },
        settled: () => {
          setRequestPending((current) => {
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
      <SecondaryHeader title="Profile" maxWidth={880} />
      <ScrollView
        ref={tabScroll.scrollRef}
        onScroll={tabScroll.onScroll}
        onScrollBeginDrag={tabScroll.onScrollBeginDrag}
        onContentSizeChange={tabScroll.onContentSizeChange}
        onLayout={tabScroll.onViewportLayout}
        scrollEventThrottle={32}
        contentContainerStyle={s.content}
      >
        <View style={s.hero}>
          <ProfileAvatar username={profile.username} avatarUrl={profile.avatarUrl} size={80} />
          <View style={s.identity}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={s.handle}>
              @{profile.username}
            </Text>
            <View style={s.visibility}>
              <VisibilityIcon size={13} color={colors.muted} strokeWidth={1.8} />
              <Text style={s.visibilityText}>{profile.isPublic ? 'Public' : 'Private'}</Text>
            </View>
            <View style={s.connectionsRow}>
              <Text style={s.connections}>
                <Text style={s.connectionsStrong}>{profile.followerCount.toLocaleString()}</Text>{' '}
                followers
              </Text>
              <Text style={s.connections}>
                <Text style={s.connectionsStrong}>{profile.followingCount.toLocaleString()}</Text>{' '}
                following
              </Text>
            </View>
          </View>
        </View>
        <Button
          title="Edit profile"
          variant="secondary"
          size="sm"
          icon={<Pencil size={14} color={colors.text} strokeWidth={2} />}
          onPress={() => router.push('/profile-edit')}
          style={s.edit}
        />
        <View onLayout={tabScroll.onContentLayout}>
          <ProfileTabs value={tab} onChange={setTab} position={pagerPosition} />
        </View>
        {!!requests?.length && (
          <View style={s.requests}>
            <Text accessibilityRole="header" style={s.requestSection}>
              Follow requests
            </Text>
            {requests.map((request) => (
              <View key={request.username} style={s.requestRow}>
                <ProfileAvatar
                  username={request.username}
                  avatarUrl={request.avatarUrl}
                  size={42}
                />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(`/u/${request.username}`)}
                  style={s.requestIdentity}
                >
                  <Text style={s.requestName}>@{request.username}</Text>
                  <Text style={s.requestMeta}>
                    {request.followerCount.toLocaleString()} follower
                    {request.followerCount === 1 ? '' : 's'}
                  </Text>
                </Pressable>
                {requestPending.has(request.username) ? (
                  <ActivityIndicator color={colors.muted} />
                ) : (
                  <View style={s.requestActions}>
                    <NativePressable
                      accessibilityRole="button"
                      accessibilityLabel={`Decline @${request.username}`}
                      onPress={() => void handleRequest(request.username, false)}
                      hitSlop={3}
                      style={s.requestButton}
                      pressedStyle={s.pressed}
                    >
                      <Text style={s.requestButtonText}>Decline</Text>
                    </NativePressable>
                    <NativePressable
                      accessibilityRole="button"
                      accessibilityLabel={`Accept @${request.username}`}
                      onPress={() => void handleRequest(request.username, true)}
                      hitSlop={3}
                      style={[s.requestButton, s.requestAccept]}
                      pressedStyle={s.pressed}
                    >
                      <Text style={s.requestAcceptText}>Accept</Text>
                    </NativePressable>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}
        <SwipePages
          onSwipeStart={tabScroll.onSwipeStart}
          gutter={20}
          position={pagerPosition}
          index={tab === 'collection' ? 0 : 1}
          onIndexChange={(index) => setTab(index === 0 ? 'collection' : 'stats')}
        >
          <View style={s.page}>
            <ProfileCollection stats={stats} items={items} />
            {profile.username && (
              <PublicTagsSection tags={publicTags ?? []} username={profile.username} />
            )}
          </View>
          <ProfileMetrics stats={stats} items={items} alsoWatching={alsoWatching} />
        </SwipePages>
      </ScrollView>
      <StartupSyncStatus />
    </ScreenView>
  );
}

// Room for the bar floating over the scroll view.
const CONTENT_TOP = 88;

const s = createAppStyles(
  {
    root: { flex: 1, backgroundColor: colors.bg },
    content: {
      width: '100%',
      maxWidth: 880,
      alignSelf: 'center',
      padding: 20,
      paddingTop: CONTENT_TOP,
      paddingBottom: 72,
    },
    hero: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingTop: 8 },
    identity: { flex: 1, minWidth: 0, gap: 6 },
    handle: { color: colors.text, fontSize: 20, lineHeight: 26, fontWeight: '700' },
    visibility: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    visibilityText: { color: colors.muted, fontSize: 13, fontWeight: '500' },
    connectionsRow: { flexDirection: 'row', gap: 14 },
    connections: { color: colors.muted, fontSize: 13 },
    connectionsStrong: { color: colors.text, fontWeight: '700' },
    edit: { alignSelf: 'flex-start', marginTop: 16, marginBottom: 20 },
    page: { gap: 36 },
    pressed: { opacity: 0.64 },
    requests: {
      padding: 16,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      marginBottom: 24,
    },
    requestSection: { ...typeRamp.sectionTitle, marginBottom: 6 },
    requestRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12 },
    requestIdentity: { flex: 1, minWidth: 0 },
    requestName: { ...typeRamp.rowTitle },
    requestMeta: { ...typeRamp.meta, marginTop: 2 },
    requestActions: { flexDirection: 'row', gap: 8 },
    requestButton: {
      height: 36,
      paddingHorizontal: 14,
      borderRadius: radius.pill,
      backgroundColor: colors.elevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    requestButtonText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    requestAccept: { backgroundColor: colors.text },
    requestAcceptText: { color: colors.bg, fontSize: 13, fontWeight: '600' },
  },
  [
    'handle',
    'visibilityText',
    'connections',
    'connectionsStrong',
    'requestSection',
    'requestName',
    'requestMeta',
    'requestButtonText',
    'requestAcceptText',
  ] as const,
);
