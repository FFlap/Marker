import { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from 'convex/react';
import { LockKeyhole } from 'lucide-react-native';
import { api } from '../../../convex/_generated/api';
import { EmptyState } from '@/components/ui/primitives';
import { NativePressable } from '@/components/ui/NativePressable';
import { useToast } from '@/components/ui/Toast';
import { SecondaryHeader } from '@/components/BackButton';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { ProfileCollection, ProfileMetrics } from '@/components/ProfileStats';
import { ProfileTabs, type ProfileTab } from '@/components/ProfileTabs';
import { PublicTagsSection } from '@/components/PublicTagsSection';
import { ProfilePageSkeleton } from '@/components/PageSkeletons';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';

export default function PublicProfile() {
  const { username = '' } = useLocalSearchParams<{ username: string }>();
  const result = useQuery(api.profiles.publicProfile, { username });
  const follow = useMutation(api.profiles.follow);
  const unfollow = useMutation(api.profiles.unfollow);
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [tab, setTab] = useState<ProfileTab>('collection');
  if (result === undefined)
    return (
      <View style={s.root}>
        <SecondaryHeader title="Profile" maxWidth={880} />
        <ProfilePageSkeleton />
      </View>
    );
  if (result === null)
    return (
      <View style={s.root}>
        <SecondaryHeader title="Profile" maxWidth={880} />
        <View style={s.state}>
          <EmptyState title="Profile not found" />
        </View>
      </View>
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
    try {
      if (relationship === 'none') await follow({ username: result.profile.username });
      else await unfollow({ username: result.profile.username });
    } catch {
      toast.show('Couldn’t update this follow');
    }
    setPending(false);
  };
  return (
    <View style={s.root}>
      <SecondaryHeader title={`@${result.profile.username}`} maxWidth={880} />
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.hero}>
          <ProfileAvatar
            username={result.profile.username}
            avatarUrl={result.profile.avatarUrl}
            size={104}
          />
          <View style={s.identity}>
            <Text style={s.handle}>@{result.profile.username}</Text>
            <Text style={s.connections}>
              {result.profile.followerCount.toLocaleString()} followers ·{' '}
              {result.profile.followingCount.toLocaleString()} following
            </Text>
          </View>
          {relationship && relationship !== 'self' && (
            <NativePressable
              accessibilityRole="button"
              accessibilityLabel={`${followLabel} @${result.profile.username}`}
              disabled={pending}
              onPress={() => void updateFollow()}
              hitSlop={3}
              style={[s.followButton, relationship === 'none' && s.followButtonPrimary]}
              pressedStyle={s.pressed}
            >
              {pending ? (
                <ActivityIndicator size="small" color={colors.muted} />
              ) : (
                <Text style={[s.followText, relationship === 'none' && s.followTextPrimary]}>
                  {followLabel}
                </Text>
              )}
            </NativePressable>
          )}
        </View>
        <ProfileTabs value={tab} onChange={setTab} />
        {'stats' in result ? (
          tab === 'collection' ? (
            <>
              <ProfileCollection stats={result.stats} interactive={false} />
              <PublicTagsSection tags={result.publicTags} username={result.profile.username} />
            </>
          ) : (
            <ProfileMetrics stats={result.stats} />
          )
        ) : tab === 'collection' ? (
          result.publicTags.length ? (
            <>
              <Text style={s.privateNotice}>Other profile activity is private.</Text>
              <PublicTagsSection tags={result.publicTags} username={result.profile.username} />
            </>
          ) : (
            <View style={s.privateState}>
              <LockKeyhole size={22} color={colors.muted} strokeWidth={1.6} />
              <Text style={s.privateTitle}>This profile is private</Text>
              <Text style={s.privateDetail}>
                {relationship === 'pending'
                  ? 'Your follow request is waiting for approval.'
                  : 'Follow this person to request access to their activity.'}
              </Text>
            </View>
          )
        ) : (
          <View style={s.privateState}>
            <LockKeyhole size={22} color={colors.muted} strokeWidth={1.6} />
            <Text style={s.privateTitle}>Stats are private</Text>
            <Text style={s.privateDetail}>
              Follow this person to request access to their activity.
            </Text>
          </View>
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
      maxWidth: 880,
      alignSelf: 'center',
      padding: 20,
      paddingTop: 96,
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
    handle: { color: colors.text, fontSize: 27, fontWeight: '700', letterSpacing: -0.7 },
    connections: { color: colors.muted, fontSize: 11, marginTop: 8 },
    followButton: {
      minHeight: 42,
      paddingHorizontal: 15,
      borderRadius: 21,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    followButtonPrimary: { backgroundColor: colors.text, borderColor: colors.text },
    followText: { color: colors.text, fontSize: 11, fontWeight: '700' },
    followTextPrimary: { color: colors.bg },
    pressed: { opacity: 0.64 },
    privateState: {
      minHeight: 260,
      alignItems: 'center',
      justifyContent: 'center',
      borderTopWidth: 1,
      borderColor: colors.border,
    },
    privateTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 14 },
    privateDetail: { color: colors.muted, fontSize: 12, marginTop: 7 },
    privateNotice: { color: colors.muted, fontSize: 11, marginBottom: 8 },
  },
  [
    'handle',
    'connections',
    'followText',
    'followTextPrimary',
    'privateTitle',
    'privateDetail',
    'privateNotice',
  ] as const,
);
