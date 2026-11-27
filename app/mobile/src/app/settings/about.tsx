import Constants from 'expo-constants';
import { Linking, ScrollView, Text, View } from 'react-native';
import ExternalLink from 'lucide-react-native/icons/external-link';
import { SecondaryHeader } from '@/components/BackButton';
import { ScreenView } from '@/components/ScreenLayout';
import { ListGroup, ListRow } from '@/components/ui/primitives';
import { colors } from '@/constants/colors';
import { radius, typeRamp } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';

function SourceMark({ label }: { label: string }) {
  return (
    <View style={s.mark}>
      <Text style={s.markText}>{label}</Text>
    </View>
  );
}

export default function DataSources() {
  return (
    <ScreenView style={s.root}>
      <SecondaryHeader
        title="About"
        backLabel="Back to settings"
        fallback="/(tabs)/settings"
        maxWidth={680}
      />
      <ScrollView contentContainerStyle={s.content}>
        {/* A note, not a row: it has no action, so it isn't drawn like the links below. */}
        <View style={s.noteSection}>
          <Text accessibilityRole="header" style={s.noteTitle}>
            Chrome extension
          </Text>
          <Text style={s.noteText}>
            Install the Marker extension in Chrome and sign in with this account to sync your watch
            history automatically.
          </Text>
        </View>
        {/* Dividers start at the text column: padding 16 + mark 44 + gap 14. */}
        <ListGroup title="Data sources" inset={74}>
          <ListRow
            label="TMDB"
            detail="Titles, posters, cast and artwork. This product uses the TMDB API but is not endorsed or certified by TMDB."
            icon={<SourceMark label="TMDB" />}
            accessibilityLabel="TMDB, opens themoviedb.org"
            trailing={<ExternalLink size={16} color={colors.muted} strokeWidth={1.8} />}
            onPress={() => void Linking.openURL('https://www.themoviedb.org')}
          />
          <ListRow
            label="TheTVDB"
            detail="Season and episode details for many series. Metadata provided by TheTVDB."
            icon={<SourceMark label="TVDB" />}
            accessibilityLabel="TheTVDB, opens thetvdb.com"
            trailing={<ExternalLink size={16} color={colors.muted} strokeWidth={1.8} />}
            onPress={() => void Linking.openURL('https://thetvdb.com')}
          />
        </ListGroup>
        {!!Constants.expoConfig?.version && (
          <Text style={s.version}>Marker {Constants.expoConfig.version}</Text>
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
      maxWidth: 680,
      alignSelf: 'center',
      paddingHorizontal: 20,
      paddingTop: 88,
      paddingBottom: 56,
      gap: 24,
    },
    mark: {
      width: 44,
      height: 34,
      borderRadius: radius.sm,
      backgroundColor: colors.elevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    markText: { ...typeRamp.caption, color: colors.text, fontWeight: '700', letterSpacing: 0.3 },
    noteSection: { gap: 10 },
    noteTitle: { ...typeRamp.sectionTitle, fontSize: 15 },
    noteText: { ...typeRamp.body },
    version: { ...typeRamp.meta, textAlign: 'center' },
  },
  ['markText', 'noteTitle', 'noteText', 'version'] as const,
);
