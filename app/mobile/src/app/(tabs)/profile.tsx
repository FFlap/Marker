import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery } from 'convex/react';
import { Globe2, LockKeyhole, Pencil } from 'lucide-react-native';
import { api } from '../../../convex/_generated/api';
import { useToast } from '@/components/ui/Toast';
import { NativePressable } from '@/components/ui/NativePressable';
import { colors } from '@/constants/colors';
import { ScreenErrorBoundary } from '@/components/ScreenErrorBoundary';
import { SecondaryHeader } from '@/components/BackButton';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { ProfileCollection, ProfileMetrics } from '@/components/ProfileStats';
import { ProfileTabs, type ProfileTab } from '@/components/ProfileTabs';
import { PublicTagsSection } from '@/components/PublicTagsSection';
import { ProfilePageSkeleton } from '@/components/PageSkeletons';
import { createAppStyles } from '@/lib/typography';

export default function Profile() {
  return (
    <ScreenErrorBoundary message="Couldn’t calculate your profile.">
      <ProfileContent />
    </ScreenErrorBoundary>
  );
}

function ProfileContent() {
  const profile = useQuery(api.profiles.me);
  const stats = useQuery(api.stats.profile);
  const publicTags = useQuery(api.tags.myPublic);
  const requests = useQuery(api.profiles.followRequests);
  const respond = useMutation(api.profiles.respondToFollow);
  const toast = useToast();
  const [requestPending, setRequestPending] = useState<ReadonlySet<string>>(() => new Set());
  const [tab, setTab] = useState<ProfileTab>('collection');
  if (profile === undefined || stats === undefined) {
    return (
      <View style={s.root}>
        <SecondaryHeader title="Profile" maxWidth={880} />
        <ProfilePageSkeleton />
      </View>
    );
  }
  const VisibilityIcon = profile.isPublic ? Globe2 : LockKeyhole;
  const handleRequest = async (username: string, accept: boolean) => {
    setRequestPending((current) => new Set(current).add(username));
    try {
      await respond({ username, accept });
    } catch {
      toast.show('Couldn’t update this request');
    }
    setRequestPending((current) => {
      const next = new Set(current);
      next.delete(username);
      return next;
    });
  };
  return (
    <View style={s.root}>
      <SecondaryHeader title="Profile" maxWidth={880} />
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.hero}>
          <ProfileAvatar username={profile.username} avatarUrl={profile.avatarUrl} size={104} />
          <View style={s.identity}>
            <Text style={s.handle}>@{profile.username}</Text>
            <View style={s.visibility}>
              <VisibilityIcon size={13} color={colors.muted} strokeWidth={1.8} />
              <Text style={s.visibilityText}>
                {profile.isPublic ? 'Public profile' : 'Private profile'}
              </Text>
            </View>
            <Text style={s.connections}>
              {profile.followerCount.toLocaleString()} followers ·{' '}
              {profile.followingCount.toLocaleString()} following
            </Text>
          </View>
          <NativePressable
            accessibilityRole="button"
            accessibilityLabel="Edit profile"
            onPress={() => router.push('/profile-edit')}
            style={s.edit}
            pressedStyle={s.pressed}
          >
            <Pencil size={15} color={colors.text} strokeWidth={1.8} />
            <Text style={s.editText}>Edit</Text>
          </NativePressable>
        </View>
        <ProfileTabs value={tab} onChange={setTab} />
        {!!requests?.length && (
          <View style={s.requests}>
            <Text style={s.requestSection}>Follow requests</Text>
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
        {tab === 'collection' ? (
          <>
            <ProfileCollection stats={stats} />
            {profile.username && (
              <PublicTagsSection tags={publicTags ?? []} username={profile.username} />
            )}
          </>
        ) : (
          <ProfileMetrics stats={stats} />
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
      paddingTop: 88,
      paddingBottom: 72,
    },
    hero: { minHeight: 152, flexDirection: 'row', alignItems: 'center', gap: 20 },
    identity: { flex: 1, minWidth: 0 },
    handle: {
      color: colors.text,
      fontSize: 27,
      lineHeight: 32,
      fontWeight: '700',
      letterSpacing: -0.7,
    },
    visibility: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
    visibilityText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
    connections: { color: colors.muted, fontSize: 11, marginTop: 7 },
    edit: {
      minHeight: 44,
      paddingHorizontal: 15,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 7,
    },
    editText: { color: colors.text, fontSize: 12, fontWeight: '700' },
    pressed: { opacity: 0.64 },
    requests: {
      borderBottomWidth: 1,
      borderColor: colors.border,
      paddingBottom: 30,
      marginBottom: 34,
    },
    requestSection: {
      color: colors.muted,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.5,
      marginBottom: 10,
    },
    requestRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 11 },
    requestIdentity: { flex: 1, minWidth: 0 },
    requestName: { color: colors.text, fontSize: 13, fontWeight: '700' },
    requestMeta: { color: colors.muted, fontSize: 10, marginTop: 4 },
    requestActions: { flexDirection: 'row', gap: 7 },
    requestButton: {
      minHeight: 38,
      paddingHorizontal: 11,
      borderRadius: 19,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    requestButtonText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
    requestAccept: { backgroundColor: colors.text, borderColor: colors.text },
    requestAcceptText: { color: colors.bg, fontSize: 10, fontWeight: '700' },
  },
  [
    'handle',
    'visibilityText',
    'connections',
    'editText',
    'requestSection',
    'requestName',
    'requestMeta',
    'requestButtonText',
    'requestAcceptText',
  ] as const,
);
