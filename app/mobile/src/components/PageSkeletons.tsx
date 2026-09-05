import type { StyleProp, ViewStyle } from 'react-native';
import { StyleSheet, View } from 'react-native';
import { colors } from '@/constants/colors';
import { SkeletonShimmer } from './SkeletonShimmer';

function Block({ style }: { style: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.block, style]}>
      <SkeletonShimmer />
    </View>
  );
}

function PosterCards({ count = 4 }: { count?: number }) {
  return (
    <View style={styles.posterGrid}>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.posterCard}>
          <Block style={styles.poster} />
          <Block style={[styles.posterTitle, index % 3 === 1 && styles.posterTitleShort]} />
          <Block style={styles.posterMeta} />
        </View>
      ))}
    </View>
  );
}

export function ProfilePageSkeleton() {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading profile"
      style={styles.profile}
    >
      <View style={styles.profileHero}>
        <Block style={styles.avatar} />
        <View style={styles.profileIdentity}>
          <Block style={styles.profileName} />
          <Block style={styles.profileSubline} />
          <Block style={styles.profileConnections} />
        </View>
        <Block style={styles.profileAction} />
      </View>
      <View style={styles.tabs}>
        <Block style={styles.tab} />
        <Block style={styles.tab} />
      </View>
      <View style={styles.sectionHeading}>
        <View style={styles.sectionCopy}>
          <Block style={styles.eyebrow} />
          <Block style={styles.heading} />
          <Block style={styles.help} />
        </View>
        <Block style={styles.smallAction} />
      </View>
      <PosterCards />
      <View style={styles.tagSection}>
        <Block style={styles.eyebrow} />
        <View style={styles.chips}>
          <Block style={styles.chipWide} />
          <Block style={styles.chip} />
          <Block style={styles.chipWide} />
        </View>
      </View>
    </View>
  );
}

export function PosterGridSkeleton({
  accessibilityLabel = 'Loading titles',
  count = 6,
}: {
  accessibilityLabel?: string;
  count?: number;
}) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel}>
      <View style={styles.gridSummary}>
        <Block style={styles.summaryLine} />
      </View>
      <View style={styles.gridHeading}>
        <Block style={styles.gridHeadingLabel} />
        <Block style={styles.gridCount} />
      </View>
      <PosterCards count={count} />
    </View>
  );
}

export function LibraryPageSkeleton({ list = false }: { list?: boolean }) {
  return (
    <View
      testID="library-loading"
      accessibilityRole="progressbar"
      accessibilityLabel="Loading library"
      style={styles.library}
    >
      {[0, 1].map((section) => (
        <View key={section} style={styles.librarySection}>
          <View style={styles.gridHeading}>
            <Block style={styles.gridHeadingLabel} />
            <Block style={styles.gridCount} />
          </View>
          {list ? <LibraryPickerSkeleton count={3} embedded /> : <PosterCards count={4} />}
        </View>
      ))}
    </View>
  );
}

export function EpisodePageSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading episodes"
      style={styles.episodeList}
    >
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.episode}>
          <Block style={styles.episodeArtwork} />
          <View style={styles.episodeCopy}>
            <Block style={styles.episodeShow} />
            <Block style={[styles.episodeTitle, index % 2 === 1 && styles.episodeTitleShort]} />
            <View style={styles.episodeMetaRow}>
              <Block style={styles.episodeMeta} />
              <Block style={styles.episodeRuntime} />
            </View>
          </View>
          <Block style={styles.episodeAction} />
        </View>
      ))}
    </View>
  );
}

export function LibraryPickerSkeleton({
  count = 6,
  embedded = false,
}: {
  count?: number;
  embedded?: boolean;
}) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading library titles"
      style={!embedded && styles.picker}
    >
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.pickerRow}>
          <Block style={styles.pickerPoster} />
          <View style={styles.pickerCopy}>
            <Block style={[styles.pickerTitle, index % 3 === 2 && styles.pickerTitleShort]} />
            <Block style={styles.pickerMeta} />
          </View>
          <Block style={styles.pickerCheck} />
        </View>
      ))}
    </View>
  );
}

export function DetailPageSkeleton() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading title" style={styles.detail}>
      <View style={styles.detailHero}>
        <Block style={styles.detailPoster} />
        <View style={styles.detailCopy}>
          <Block style={styles.detailTitle} />
          <Block style={styles.detailMeta} />
          <Block style={styles.detailLine} />
          <Block style={styles.detailLineShort} />
          <Block style={styles.detailButton} />
        </View>
      </View>
      <View style={styles.detailDivider} />
      <Block style={styles.detailSectionTitle} />
      <LibraryPickerSkeleton count={3} embedded />
    </View>
  );
}

export function SearchResultsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Searching"
      style={styles.searchResults}
    >
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.searchRow}>
          <Block style={styles.searchPoster} />
          <View style={styles.searchCopy}>
            <Block style={[styles.searchTitle, index % 2 === 1 && styles.searchTitleShort]} />
            <Block style={styles.searchMeta} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function ProfileFormSkeleton() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading profile" style={styles.form}>
      <View style={styles.formHero}>
        <Block style={styles.formAvatar} />
        <View style={styles.formCopy}>
          <Block style={styles.formTitle} />
          <Block style={styles.formHelp} />
          <Block style={styles.formHelpShort} />
        </View>
      </View>
      <Block style={styles.formLabel} />
      <Block style={styles.formInput} />
      <Block style={styles.formLabel} />
      <Block style={styles.formChoice} />
      <Block style={styles.formButton} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  profile: {
    width: '100%',
    maxWidth: 880,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 88,
    paddingBottom: 72,
  },
  profileHero: {
    minHeight: 152,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  avatar: { width: 104, height: 104, borderRadius: 52 },
  profileIdentity: { flex: 1, gap: 10 },
  profileName: { width: '48%', maxWidth: 220, height: 27, borderRadius: 7 },
  profileSubline: { width: 112, height: 10, borderRadius: 5 },
  profileConnections: { width: 174, height: 9, borderRadius: 5 },
  profileAction: { width: 72, height: 42, borderRadius: 21 },
  tabs: {
    height: 47,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 28,
    borderBottomWidth: 1,
    borderColor: colors.border,
    marginBottom: 38,
  },
  tab: { width: 78, height: 11, borderRadius: 6, marginBottom: 13 },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 20,
  },
  sectionCopy: { flex: 1, gap: 8 },
  eyebrow: { width: 110, height: 8, borderRadius: 4 },
  heading: { width: 210, height: 22, borderRadius: 6 },
  help: { width: '58%', height: 9, borderRadius: 5 },
  smallAction: { width: 66, height: 38, borderRadius: 19 },
  posterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: '3.5%',
    rowGap: 18,
  },
  posterCard: { width: '22.375%', minWidth: 0 },
  poster: { width: '100%', aspectRatio: 2 / 3, borderRadius: 12 },
  posterTitle: { width: '88%', height: 10, borderRadius: 5, marginTop: 8 },
  posterTitleShort: { width: '64%' },
  posterMeta: { width: '36%', height: 7, borderRadius: 4, marginTop: 6 },
  tagSection: { gap: 16, marginTop: 48 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { width: 76, height: 32, borderRadius: 16 },
  chipWide: { width: 108, height: 32, borderRadius: 16 },
  gridSummary: { paddingTop: 14, paddingBottom: 8 },
  summaryLine: { width: 178, height: 9, borderRadius: 5 },
  gridHeading: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  gridHeadingLabel: { width: 82, height: 10, borderRadius: 5 },
  gridCount: { width: 20, height: 9, borderRadius: 5 },
  library: { paddingTop: 8 },
  librarySection: { marginBottom: 34 },
  episodeList: { gap: 12, paddingTop: 20 },
  episode: {
    minHeight: 112,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  episodeArtwork: { width: 132, aspectRatio: 16 / 9, borderRadius: 10 },
  episodeCopy: { flex: 1, gap: 10 },
  episodeShow: { width: 92, height: 8, borderRadius: 4 },
  episodeTitle: { width: '72%', height: 14, borderRadius: 7 },
  episodeTitleShort: { width: '54%' },
  episodeMetaRow: { flexDirection: 'row', gap: 8 },
  episodeMeta: { width: 72, height: 8, borderRadius: 4 },
  episodeRuntime: { width: 44, height: 8, borderRadius: 4 },
  episodeAction: { width: 40, height: 40, borderRadius: 20 },
  picker: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 138,
    paddingBottom: 122,
  },
  pickerRow: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  pickerPoster: { width: 40, height: 60, borderRadius: 6 },
  pickerCopy: { flex: 1, gap: 10 },
  pickerTitle: { width: '56%', height: 13, borderRadius: 7 },
  pickerTitleShort: { width: '38%' },
  pickerMeta: { width: 48, height: 7, borderRadius: 4 },
  pickerCheck: { width: 26, height: 26, borderRadius: 13 },
  detail: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 88,
    paddingBottom: 72,
  },
  detailHero: { flexDirection: 'row', gap: 22, alignItems: 'flex-start' },
  detailPoster: { width: 156, aspectRatio: 2 / 3, borderRadius: 14 },
  detailCopy: { flex: 1, gap: 12, paddingTop: 8 },
  detailTitle: { width: '76%', height: 25, borderRadius: 7 },
  detailMeta: { width: 118, height: 9, borderRadius: 5 },
  detailLine: { width: '96%', height: 9, borderRadius: 5, marginTop: 8 },
  detailLineShort: { width: '72%', height: 9, borderRadius: 5 },
  detailButton: { width: 126, height: 40, borderRadius: 20, marginTop: 8 },
  detailDivider: { height: 1, backgroundColor: colors.border, marginVertical: 32 },
  detailSectionTitle: { width: 104, height: 12, borderRadius: 6, marginBottom: 10 },
  searchResults: { gap: 4, paddingTop: 8 },
  searchRow: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingVertical: 9,
  },
  searchPoster: { width: 38, height: 56, borderRadius: 6 },
  searchCopy: { flex: 1, gap: 9 },
  searchTitle: { width: '48%', height: 12, borderRadius: 6 },
  searchTitleShort: { width: '34%' },
  searchMeta: { width: 82, height: 8, borderRadius: 4 },
  form: { width: '100%', gap: 12 },
  formHero: { flexDirection: 'row', alignItems: 'center', gap: 18, marginBottom: 20 },
  formAvatar: { width: 88, height: 88, borderRadius: 44 },
  formCopy: { flex: 1, gap: 9 },
  formTitle: { width: 108, height: 15, borderRadius: 7 },
  formHelp: { width: '88%', height: 9, borderRadius: 5 },
  formHelpShort: { width: '62%', height: 9, borderRadius: 5 },
  formLabel: { width: 84, height: 9, borderRadius: 5, marginTop: 8 },
  formInput: { width: '100%', height: 44, borderRadius: 10 },
  formChoice: { width: '100%', height: 66, borderRadius: 12 },
  formButton: { width: 142, height: 44, borderRadius: 22, marginTop: 10 },
});
