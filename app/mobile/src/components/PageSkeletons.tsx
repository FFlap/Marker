import type { StyleProp, ViewStyle } from 'react-native';
import { PixelRatio, StyleSheet, useWindowDimensions, View } from 'react-native';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/theme';
import {
  DEFAULT_DISPLAY_PREFERENCES,
  gridMetrics,
  listTypography,
  type ListTextSize,
} from '@/lib/displayPreferences';
import { SkeletonShimmer, SkeletonShimmerGroup } from './SkeletonShimmer';

/**
 * Placeholders mirror the finished screens: the same paddings, row heights, radii and
 * section rhythm, so content replaces them without a jump.
 */

function Block({ style }: { style: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.block, style]}>
      <SkeletonShimmer />
    </View>
  );
}

function SectionHeadingBlock({ width = 92 }: { width?: number }) {
  return (
    <View style={styles.heading}>
      <Block style={[styles.headingTitle, { width }]} />
      <Block style={styles.headingCount} />
    </View>
  );
}

function PosterCards({ count, columns, width }: { count: number; columns: number; width: number }) {
  const { gap, itemWidth } = gridMetrics(width, columns, PixelRatio.get());
  return (
    <View style={[styles.posterGrid, { columnGap: gap }]}>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={{ width: itemWidth, gap: 6 }}>
          <Block style={styles.poster} />
          {/* Two caption lines are reserved, like the real cards. */}
          <View style={styles.posterCaption}>
            <Block style={[styles.posterTitle, { width: '88%' }]} />
            {index % 2 === 0 && <Block style={[styles.posterTitle, styles.posterTitleShort]} />}
          </View>
        </View>
      ))}
    </View>
  );
}

function ListRows({
  count,
  textSize,
  columns,
  ranked,
}: {
  count: number;
  textSize: ListTextSize;
  columns: number;
  ranked: boolean;
}) {
  const typography = listTypography(textSize);
  const lineHeight = Math.round(typography.fontSize * 0.75);
  return (
    <View style={columns === 2 && styles.listTwo}>
      {Array.from({ length: count }, (_, index) => (
        <View
          key={index}
          style={[
            styles.listRow,
            { minHeight: typography.minHeight },
            columns === 2 && styles.listRowHalf,
          ]}
        >
          {ranked && <Block style={[styles.listRank, { height: lineHeight }]} />}
          {columns === 2 ? (
            // Two columns: the rating sits under the title, like the real rows.
            <View style={styles.listStack}>
              <Block
                style={[
                  styles.listTitle,
                  { height: lineHeight, width: `${[82, 64, 90, 72][index % 4]}%` },
                ]}
              />
              {index % 3 !== 2 && <Block style={[styles.listRating, { height: lineHeight }]} />}
            </View>
          ) : (
            <>
              <Block
                style={[
                  styles.listTitle,
                  { height: lineHeight, width: `${[62, 48, 70, 55][index % 4]}%` },
                ]}
              />
              <Block style={[styles.listRating, styles.listRatingEnd, { height: lineHeight }]} />
            </>
          )}
        </View>
      ))}
    </View>
  );
}

export function LibraryPageSkeleton({
  list = false,
  columns = DEFAULT_DISPLAY_PREFERENCES.gridColumns,
  listColumns = DEFAULT_DISPLAY_PREFERENCES.listColumns,
  textSize = DEFAULT_DISPLAY_PREFERENCES.listTextSize,
}: {
  list?: boolean;
  columns?: number;
  listColumns?: number;
  textSize?: ListTextSize;
}) {
  const { width } = useWindowDimensions();
  const contentWidth = Math.min(width, 880) - 40;
  return (
    <SkeletonShimmerGroup>
      <View
        testID="library-loading"
        accessibilityRole="progressbar"
        accessibilityLabel="Loading library"
        style={styles.library}
      >
        {[0, 1, 2].map((section) => (
          <View key={section} style={styles.librarySection}>
            <SectionHeadingBlock width={[92, 104, 96][section]} />
            {list ? (
              <ListRows
                count={section === 0 ? 5 : 3}
                textSize={textSize}
                columns={listColumns}
                ranked={section === 0}
              />
            ) : (
              <PosterCards
                count={section === 0 ? columns * 2 : columns}
                columns={columns}
                width={contentWidth}
              />
            )}
          </View>
        ))}
      </View>
    </SkeletonShimmerGroup>
  );
}

export function PosterGridSkeleton({
  accessibilityLabel = 'Loading titles',
  count = 6,
}: {
  accessibilityLabel?: string;
  count?: number;
}) {
  const { width } = useWindowDimensions();
  return (
    <SkeletonShimmerGroup>
      <View accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel}>
        <SectionHeadingBlock />
        <PosterCards count={count} columns={3} width={Math.min(width, 880) - 40} />
      </View>
    </SkeletonShimmerGroup>
  );
}

export function ProfilePageSkeleton() {
  const { width } = useWindowDimensions();
  return (
    <SkeletonShimmerGroup>
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
        </View>
        <Block style={styles.profileAction} />
        <View style={styles.tabs}>
          <Block style={styles.tab} />
          <Block style={styles.tab} />
        </View>
        {[0, 1].map((section) => (
          <View key={section} style={styles.librarySection}>
            <SectionHeadingBlock width={[84, 64][section]} />
            <View style={styles.rail}>
              {[0, 1, 2].map((index) => (
                <Block key={index} style={[styles.favorite, { width: (width - 64) / 3 }]} />
              ))}
            </View>
          </View>
        ))}
      </View>
    </SkeletonShimmerGroup>
  );
}

/** Up next as it loads: the heading, then rows of still, show line, title and check. */
export function EpisodePageSkeleton({
  count = 4,
  heading = true,
}: {
  count?: number;
  heading?: boolean;
}) {
  return (
    <SkeletonShimmerGroup>
      <View accessibilityRole="progressbar" accessibilityLabel="Loading episodes">
        {heading && <SectionHeadingBlock width={84} />}
        {Array.from({ length: count }, (_, index) => (
          <View key={index} style={styles.episode}>
            <Block style={styles.episodeArtwork} />
            <View style={styles.episodeCopy}>
              <Block style={styles.episodeShow} />
              <Block style={[styles.episodeTitle, index % 2 === 1 && styles.episodeTitleShort]} />
            </View>
            <Block style={styles.episodeAction} />
          </View>
        ))}
      </View>
    </SkeletonShimmerGroup>
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
    <SkeletonShimmerGroup>
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
    </SkeletonShimmerGroup>
  );
}

export function DetailPageSkeleton() {
  return (
    <SkeletonShimmerGroup>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel="Loading title"
        style={styles.detail}
      >
        <View style={styles.detailHero}>
          <Block style={styles.detailPoster} />
          <View style={styles.detailCopy}>
            <Block style={styles.detailTitle} />
            <Block style={styles.detailMeta} />
            <View style={styles.detailChips}>
              <Block style={styles.detailChip} />
              <Block style={[styles.detailChip, { width: 96 }]} />
              <Block style={[styles.detailChip, { width: 64 }]} />
            </View>
          </View>
        </View>
        <View style={styles.detailLines}>
          <Block style={styles.detailLine} />
          <Block style={styles.detailLine} />
          <Block style={styles.detailLineShort} />
        </View>
        <Block style={styles.detailSectionTitle} />
        <Block style={styles.detailCard} />
        <Block style={styles.detailSectionTitle} />
        <View style={styles.rail}>
          {[0, 1, 2, 3].map((index) => (
            <Block key={index} style={styles.detailCast} />
          ))}
        </View>
      </View>
    </SkeletonShimmerGroup>
  );
}

export function SearchResultsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <SkeletonShimmerGroup>
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
            <Block style={styles.searchAction} />
          </View>
        ))}
      </View>
    </SkeletonShimmerGroup>
  );
}

export function ProfileFormSkeleton() {
  return (
    <SkeletonShimmerGroup>
      <View
        accessibilityRole="progressbar"
        accessibilityLabel="Loading profile"
        style={styles.form}
      >
        <View style={styles.formHero}>
          <Block style={styles.formAvatar} />
          <View style={styles.formCopy}>
            <Block style={styles.formTitle} />
            <Block style={styles.formHelp} />
          </View>
        </View>
        <Block style={styles.formLabel} />
        <Block style={styles.formInput} />
        <Block style={styles.formLabel} />
        <Block style={styles.formChoice} />
        <Block style={styles.formButton} />
      </View>
    </SkeletonShimmerGroup>
  );
}

const styles = StyleSheet.create({
  block: { position: 'relative', overflow: 'hidden', backgroundColor: colors.surface },
  heading: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  headingTitle: { height: 18, borderRadius: 6 },
  headingCount: { width: 16, height: 14, borderRadius: 5 },
  library: { paddingTop: 0 },
  librarySection: { marginTop: 28 },
  posterGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 14, paddingTop: 4 },
  poster: { width: '100%', aspectRatio: 2 / 3, borderRadius: radius.sm },
  posterTitle: { height: 11, borderRadius: 5 },
  posterCaption: { minHeight: 32, gap: 6 },
  listStack: { flex: 1, gap: 8, paddingVertical: 8 },
  posterTitleShort: { width: '52%' },
  listTwo: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 12 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  listRowHalf: { width: '47%', alignItems: 'flex-start', paddingVertical: 8 },
  listRank: { width: 20, borderRadius: 5, marginRight: 8 },
  listTitle: { borderRadius: 6, flexShrink: 1 },
  // Under the title in two columns; at the row's end in one.
  listRating: { width: 26, borderRadius: 5 },
  listRatingEnd: { marginLeft: 'auto' },
  profile: {
    width: '100%',
    maxWidth: 880,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 88,
    paddingBottom: 72,
  },
  profileHero: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingTop: 8 },
  avatar: { width: 80, height: 80, borderRadius: 40 },
  profileIdentity: { flex: 1, gap: 10 },
  profileName: { width: '64%', height: 24, borderRadius: 7 },
  profileSubline: { width: 72, height: 12, borderRadius: 6 },
  profileConnections: { width: 168, height: 12, borderRadius: 6 },
  profileAction: { width: 124, height: 36, borderRadius: radius.pill, marginTop: 16 },
  tabs: { flexDirection: 'row', gap: 24, marginTop: 20, paddingVertical: 16 },
  tab: { flex: 1, height: 16, borderRadius: 6 },
  rail: { flexDirection: 'row', gap: 12 },
  favorite: { aspectRatio: 2 / 3, borderRadius: radius.sm },
  // Matches Up next rows: 76 tall plus the row's vertical padding, 96×54 still, 32 check.
  episode: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 12 },
  episodeArtwork: { width: 96, height: 54, borderRadius: radius.xs },
  episodeCopy: { flex: 1, gap: 9 },
  episodeShow: { width: '42%', height: 11, borderRadius: 5 },
  episodeTitle: { width: '84%', height: 14, borderRadius: 6 },
  episodeTitleShort: { width: '62%' },
  episodeAction: { width: 32, height: 32, borderRadius: 16 },
  picker: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 156,
  },
  pickerRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 14 },
  pickerPoster: { width: 38, height: 57, borderRadius: radius.xs },
  pickerCopy: { flex: 1, gap: 8 },
  pickerTitle: { width: '58%', height: 14, borderRadius: 6 },
  pickerTitleShort: { width: '40%' },
  pickerMeta: { width: '30%', height: 10, borderRadius: 5 },
  pickerCheck: { width: 26, height: 26, borderRadius: 13 },
  detail: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 96,
  },
  detailHero: { flexDirection: 'row', gap: 18 },
  detailPoster: { width: 122, height: 183, borderRadius: radius.sm },
  detailCopy: { flex: 1, gap: 12, paddingTop: 4 },
  detailTitle: { width: '82%', height: 26, borderRadius: 7 },
  detailMeta: { width: 48, height: 12, borderRadius: 6 },
  detailChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  detailChip: { width: 78, height: 26, borderRadius: radius.pill },
  detailLines: { gap: 10, marginTop: 24 },
  detailLine: { width: '100%', height: 13, borderRadius: 6 },
  detailLineShort: { width: '64%', height: 13, borderRadius: 6 },
  detailSectionTitle: { width: 96, height: 18, borderRadius: 6, marginTop: 32, marginBottom: 14 },
  detailCard: { width: '100%', height: 116, borderRadius: radius.lg },
  detailCast: { width: 72, height: 96, borderRadius: radius.sm },
  searchResults: { paddingTop: 8 },
  searchRow: { minHeight: 96, flexDirection: 'row', alignItems: 'center', gap: 14 },
  searchPoster: { width: 52, height: 78, borderRadius: radius.xs },
  searchCopy: { flex: 1, gap: 8 },
  searchTitle: { width: '72%', height: 15, borderRadius: 6 },
  searchTitleShort: { width: '48%' },
  searchMeta: { width: 40, height: 11, borderRadius: 5 },
  // The results end with a small chevron, not a round button.
  searchAction: { width: 8, height: 14, borderRadius: 3 },
  form: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 96,
    gap: 14,
  },
  formHero: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 },
  formAvatar: { width: 88, height: 88, borderRadius: 44 },
  formCopy: { flex: 1, gap: 10 },
  formTitle: { width: '60%', height: 20, borderRadius: 7 },
  formHelp: { width: '80%', height: 12, borderRadius: 6 },
  formLabel: { width: 80, height: 12, borderRadius: 6, marginTop: 8 },
  formInput: { width: '100%', height: 52, borderRadius: radius.md },
  formChoice: { width: '100%', height: 48, borderRadius: radius.pill },
  formButton: { width: '100%', height: 52, borderRadius: radius.pill, marginTop: 16 },
});
