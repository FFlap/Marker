import { ScrollView, Text } from 'react-native';
import Eye from 'lucide-react-native/icons/eye';
import Clock3 from 'lucide-react-native/icons/clock-3';
import Star from 'lucide-react-native/icons/star';
import { SecondaryHeader } from '@/components/BackButton';
import { ScreenView } from '@/components/ScreenLayout';
import { SettingIcon } from '@/components/settings/SettingIcon';
import { ListGroup, SwitchRow } from '@/components/ui/primitives';
import { colors } from '@/constants/colors';
import { typeRamp } from '@/constants/theme';
import { useSettings } from '@/hooks/use-settings';
import { createAppStyles } from '@/lib/typography';

export default function NotificationSettings() {
  const { current, pending, update } = useSettings();
  return (
    <ScreenView style={s.root}>
      <SecondaryHeader
        // Not "Notifications": that is the feed itself.
        title="Notification settings"
        backLabel="Back to settings"
        fallback="/(tabs)/settings"
        maxWidth={680}
      />
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.intro}>Choose what shows up from people you follow.</Text>
        <ListGroup inset={64}>
          <SwitchRow
            label="Ratings"
            value={current.activityRatings}
            disabled={pending.has('activityRatings')}
            onChange={(value) => void update('activityRatings', value)}
            icon={
              <SettingIcon>
                <Star size={17} color={colors.text} strokeWidth={1.8} />
              </SettingIcon>
            }
          />
          <SwitchRow
            label="Started watching"
            value={current.activityWatching}
            disabled={pending.has('activityWatching')}
            onChange={(value) => void update('activityWatching', value)}
            icon={
              <SettingIcon>
                <Clock3 size={17} color={colors.text} strokeWidth={1.8} />
              </SettingIcon>
            }
          />
          <SwitchRow
            label="Finished titles and episodes"
            value={current.activityWatched}
            disabled={pending.has('activityWatched')}
            onChange={(value) => void update('activityWatched', value)}
            icon={
              <SettingIcon>
                <Eye size={17} color={colors.text} strokeWidth={1.8} />
              </SettingIcon>
            }
          />
        </ListGroup>
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
      gap: 16,
    },
    intro: { ...typeRamp.body },
  },
  ['intro'] as const,
);
