import Clock3 from 'lucide-react-native/icons/clock-3';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { ScreenView } from '@/components/ScreenLayout';
import { startupSnapshotStore } from '@/lib/startupSnapshotStorage';
import * as Effect from 'effect/Effect';
import { saveProfile } from '@marker/shared/clientEffects';
import { useOperation } from '@/hooks/use-operation';
import { usePendingTasks } from '@/hooks/use-pending-tasks';
import { ScrollView, Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useClerk } from '@clerk/expo';
import Bell from 'lucide-react-native/icons/bell';
import Eye from 'lucide-react-native/icons/eye';
import Info from 'lucide-react-native/icons/info';
import LayoutGrid from 'lucide-react-native/icons/layout-grid';
import { useStartupQuery as useQuery } from '@/hooks/useStartupQuery';
import { useAccountLoading } from '@/hooks/useAccountLoading';
import { api } from '@marker/shared/api';
import { Button, ListGroup, ListRow, SwitchRow } from '@/components/ui/primitives';
import { NativePressable } from '@/components/ui/NativePressable';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { useToast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { radius, typeRamp } from '@/constants/theme';
import { SecondaryHeader } from '@/components/BackButton';
import { createAppStyles } from '@/lib/typography';
import { useSettings } from '@/hooks/use-settings';
import { useLocalToday } from '@/hooks/use-local-today';
import { SettingIcon } from '@/components/settings/SettingIcon';
import { clearRecentSearches } from '@/lib/recentSearches';

const textSizeLabel = { small: 'Small text', medium: 'Standard text', large: 'Large text' };

export default function Settings() {
  const runOperation = useOperation();
  const { current, pending, update } = useSettings();
  const today = useLocalToday();
  const { profileReady } = useAccountLoading();
  const profile = useQuery(api.profiles.me, profileReady ? {} : 'skip');
  const clerk = useClerk();
  const { signOut } = clerk;
  const toast = useToast();
  const [signingOut, setSigningOut] = usePendingTasks();

  const handleSignOut = async () => {
    setSigningOut((existing) => new Set(existing).add('signout'));
    await runOperation(
      Effect.gen(function* () {
        yield* saveProfile(async () => {
          await startupSnapshotStore.clear();
          clearRecentSearches(clerk.user?.id);
          await signOut();
          await startupSnapshotStore.clear();
        });
      }),
      {
        failure: () => {
          toast.show('Couldn’t sign out');
        },
        settled: () => {
          setSigningOut(new Set());
        },
      },
    );
  };

  const notificationsOn = [
    current.activityRatings,
    current.activityWatching,
    current.activityWatched,
  ].filter(Boolean).length;
  const appearance =
    current.defaultView === 'posters'
      ? `Posters · ${current.gridColumns} per row`
      : `List · ${textSizeLabel[current.listTextSize]}`;

  return (
    <ScreenView style={s.root}>
      <SecondaryHeader title="Settings" maxWidth={680} />
      <ScrollView contentContainerStyle={s.content}>
        {profile && (
          <NativePressable
            accessibilityRole="button"
            accessibilityLabel={`Edit profile, @${profile.username}`}
            onPress={() => router.push('/profile-edit')}
            style={s.profile}
            pressedStyle={s.profilePressed}
          >
            <ProfileAvatar username={profile.username} avatarUrl={profile.avatarUrl} size={52} />
            <View style={s.profileCopy}>
              <Text numberOfLines={1} style={s.profileName}>
                @{profile.username}
              </Text>
              <Text style={s.profileDetail}>Edit profile</Text>
            </View>
            <ChevronRight size={18} color={colors.muted} strokeWidth={1.8} />
          </NativePressable>
        )}

        <ListGroup inset={64}>
          <ListRow
            label="Appearance"
            detail={appearance}
            icon={
              <SettingIcon>
                <LayoutGrid size={18} color={colors.text} strokeWidth={1.8} />
              </SettingIcon>
            }
            onPress={() => router.push('/settings/appearance' as Href)}
          />
          <ListRow
            label="Notifications"
            detail={
              // Says what is on: activity from people you follow.
              notificationsOn === 3
                ? 'Following activity · All on'
                : notificationsOn
                  ? `Following activity · ${notificationsOn} of 3 on`
                  : 'Following activity · Off'
            }
            icon={
              <SettingIcon>
                <Bell size={18} color={colors.text} strokeWidth={1.8} />
              </SettingIcon>
            }
            onPress={() => router.push('/settings/notifications' as Href)}
          />
        </ListGroup>

        {/* The optional behaviours, together. */}
        <ListGroup inset={64}>
          <SwitchRow
            label="Ask before marking watched"
            detail="When you drag a title to Watched"
            value={current.confirmWatchedMove}
            disabled={pending.has('confirmWatchedMove')}
            onChange={(value) => void update('confirmWatchedMove', value)}
            icon={
              <SettingIcon>
                <Eye size={18} color={colors.text} strokeWidth={1.8} />
              </SettingIcon>
            }
          />
          <SwitchRow
            label="Automatically add to Watching"
            detail={
              current.airingInWatching
                ? 'Watched shows with new episodes'
                : 'Use “Also in Watching” in Edit entry'
            }
            value={current.airingInWatching}
            disabled={pending.has('airingInWatching')}
            onChange={(value) => void update('airingInWatching', value, { today })}
            icon={
              <SettingIcon>
                <Clock3 size={18} color={colors.text} strokeWidth={1.8} />
              </SettingIcon>
            }
          />
        </ListGroup>

        <ListGroup inset={64}>
          <ListRow
            label="About"
            detail="Chrome extension and data sources"
            icon={
              <SettingIcon>
                <Info size={18} color={colors.text} strokeWidth={1.8} />
              </SettingIcon>
            }
            onPress={() => router.push('/settings/about' as Href)}
          />
        </ListGroup>

        <Button
          title={signingOut.size ? 'Signing out…' : 'Sign out'}
          variant="danger"
          size="lg"
          disabled={signingOut.size > 0 || pending.size > 0}
          onPress={handleSignOut}
        />
      </ScrollView>
    </ScreenView>
  );
}

const s = createAppStyles(
  {
    root: { flex: 1, backgroundColor: colors.bg },
    content: {
      width: '100%',
      maxWidth: 680,
      alignSelf: 'center',
      paddingHorizontal: 20,
      paddingTop: 88,
      paddingBottom: 56,
      gap: 28,
    },
    profile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 14,
      paddingLeft: 14,
      // The chevron lines up with the list rows' chevrons below.
      paddingRight: 16,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
    },
    profilePressed: { backgroundColor: colors.elevated },
    profileCopy: { flex: 1, minWidth: 0, gap: 3 },
    profileName: { ...typeRamp.rowTitle, fontSize: 17, fontWeight: '700' },
    profileDetail: { ...typeRamp.meta },
  },
  ['profileName', 'profileDetail'] as const,
);
