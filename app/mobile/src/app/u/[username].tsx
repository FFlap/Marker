import { useTaskState } from '@/hooks/use-task-state';
import { useSharedValue } from 'react-native-reanimated';
import { ScreenView } from '@/components/ScreenLayout';
import * as Effect from 'effect/Effect';
import { saveProfile } from '@marker/shared/clientEffects';
import { useOperation } from '@/hooks/use-operation';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from 'convex/react';
import LockKeyhole from 'lucide-react-native/icons/lock-keyhole';
import { api } from '@marker/shared/api';
import { Button, EmptyState } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/Toast';
import { SecondaryHeader } from '@/components/BackButton';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { ProfileCollection, ProfileMetrics } from '@/components/ProfileStats';
import { ProfileTabs, type ProfileTab } from '@/components/ProfileTabs';
import { SwipePages } from '@/components/SwipePages';
import { PublicTagsSection } from '@/components/PublicTagsSection';
import { ProfilePageSkeleton } from '@/components/PageSkeletons';
import { colors } from '@/constants/colors';
import { typeRamp } from '@/constants/theme';
import { useTabScrollMemory } from '@/hooks/use-tab-scroll-memory';
import { createAppStyles } from '@/lib/typography';

export default function PublicProfile() {
  const runOperation = useOperation();
  const { username = '' } = useLocalSearchParams<{ username: string }>();
  const result = useQuery(api.profiles.publicProfile, { username });
  const follow = useMutation(api.profiles.follow);
  const unfollow = useMutation(api.profiles.unfollow);
  const toast = useToast();
  const { pending, setPending } = useTaskState();
  const [tab, setTab] = useState<ProfileTab>('collection');
  const tabScroll = useTabScrollMemory(tab, { topInset: CONTENT_TOP });
  const pagerPosition = useSharedValue(0);
  if (result === undefined)
    return (
      <ScreenView style={s.root}>
        <SecondaryHeader title="Profile" maxWidth={880} />
        <ProfilePageSkeleton />
      </ScreenView>
    );
  if (result === null)
    return (
      <ScreenView style={s.root}>
        <SecondaryHeader title="Profile" maxWidth={880} />
        <View style={s.state}>
          <EmptyState title="Profile not found" />
        </View>
      </ScreenView>
    );
  const relationship = result.relationship;
  const followLabel =
    relationship === 'accepted'
      ? 'Following'
      : relationship === 'pending'
        ? 'Requested'
        : result.profile.isPublic
          ? 'Follow'
          : 'Request to follow';
  const updateFollow = async () => {
    if (!relationship || relationship === 'self') return;
    setPending(true);
    await runOperation.write(
      Effect.gen(function* () {
        if (relationship === 'none')
          yield* saveProfile(() => follow({ username: result.profile.username }));
        else yield* saveProfile(() => unfollow({ username: result.profile.username }));
      }),
      {
        failure: () => {
          toast.show('Couldn’t update this follow');
        },
        settled: () => {
          setPending(false);
        },
      },
    );
  };
  const requestHint =
    relationship === 'pending'
      ? 'Your follow request is waiting for approval.'
      : 'Follow this person to request access to their activity.';
  return (
    <ScreenView style={s.root}>
      <SecondaryHeader title={`@${result.profile.username}`} maxWidth={880} />
      <ScrollView
        ref={tabScroll.scrollRef}
        onScroll={tabScroll.onScroll}
        onScrollBeginDrag={tabScroll.onScrollBeginDrag}
        onContentSizeChange={tabScroll.onContentSizeChange}
        scrollEventThrottle={32}
        contentContainerStyle={s.content}
      >
        <View style={s.hero}>
          <ProfileAvatar
            username={result.profile.username}
            avatarUrl={result.profile.avatarUrl}
            size={80}
          />
          <View style={s.identity}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={s.handle}>
              @{result.profile.username}
            </Text>
            {/* Counts read like your own profile: the number bold, the word muted. */}
            <View style={s.connectionsRow}>
              <Text style={s.connections}>
                <Text style={s.connectionsStrong}>
                  {result.profile.followerCount.toLocaleString()}
                </Text>{' '}
                followers
              </Text>
              <Text style={s.connections}>
                <Text style={s.connectionsStrong}>
                  {result.profile.followingCount.toLocaleString()}
                </Text>{' '}
                following
              </Text>
            </View>
          </View>
        </View>
        {relationship && relationship !== 'self' && (
          // Below the identity, like Edit profile on your own profile, so long names and
          // "Request to follow" both have room.
          <Button
            title={pending ? '…' : followLabel}
            accessibilityLabel={`${followLabel} @${result.profile.username}`}
            variant={relationship === 'none' ? 'primary' : 'secondary'}
            size="sm"
            disabled={pending}
            onPress={() => void updateFollow()}
            style={s.follow}
          />
        )}
        <View onLayout={tabScroll.onContentLayout}>
          <ProfileTabs value={tab} onChange={setTab} position={pagerPosition} />
        </View>
        {/* Both profile states swipe between their tabs, private ones included. */}
        <SwipePages
          onSwipeStart={tabScroll.onSwipeStart}
          gutter={20}
          position={pagerPosition}
          index={tab === 'collection' ? 0 : 1}
          onIndexChange={(index) => setTab(index === 0 ? 'collection' : 'stats')}
        >
          {'stats' in result ? (
            <View style={s.page}>
              <ProfileCollection stats={result.stats} interactive={false} />
              <PublicTagsSection tags={result.publicTags} username={result.profile.username} />
            </View>
          ) : result.publicTags.length ? (
            <View>
              <Text style={s.privateNotice}>Other profile activity is private.</Text>
              <PublicTagsSection tags={result.publicTags} username={result.profile.username} />
            </View>
          ) : (
            <View style={s.privateState}>
              <LockKeyhole size={22} color={colors.muted} strokeWidth={1.6} />
              <Text style={s.privateTitle}>This profile is private</Text>
              <Text style={s.privateDetail}>{requestHint}</Text>
            </View>
          )}
          {'stats' in result ? (
            <ProfileMetrics stats={result.stats} />
          ) : (
            <View style={s.privateState}>
              <LockKeyhole size={22} color={colors.muted} strokeWidth={1.6} />
              <Text style={s.privateTitle}>Stats are private</Text>
              <Text style={s.privateDetail}>{requestHint}</Text>
            </View>
          )}
        </SwipePages>
      </ScrollView>
    </ScreenView>
  );
}

// Room for the header floating over the scroll view.
const CONTENT_TOP = 96;

const s = createAppStyles(
  {
    page: { gap: 36 },
    root: { flex: 1, backgroundColor: colors.bg },
    content: {
      width: '100%',
      maxWidth: 880,
      alignSelf: 'center',
      padding: 20,
      paddingTop: CONTENT_TOP,
      paddingBottom: 72,
    },
    state: { flex: 1, paddingTop: 96 },
    hero: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 20,
      paddingBottom: 24,
    },
    identity: { flex: 1, minWidth: 0 },
    handle: { color: colors.text, fontSize: 20, lineHeight: 26, fontWeight: '700' },
    connectionsRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, marginTop: 6 },
    // The same spacing as Edit profile under your own profile's header.
    follow: { alignSelf: 'flex-start', marginTop: -8, marginBottom: 20 },
    connections: { color: colors.muted, fontSize: 13 },
    connectionsStrong: { color: colors.text, fontWeight: '700' },
    privateState: {
      minHeight: 260,
      alignItems: 'center',
      justifyContent: 'center',
      borderTopWidth: 1,
      borderColor: colors.border,
    },
    privateTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 14 },
    privateDetail: { ...typeRamp.meta, marginTop: 7 },
    privateNotice: { ...typeRamp.meta, marginBottom: 8 },
  },
  [
    'handle',
    'connections',
    'connectionsStrong',
    'privateTitle',
    'privateDetail',
    'privateNotice',
  ] as const,
);
