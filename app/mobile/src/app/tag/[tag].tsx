import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { SecondaryHeader } from '@/components/BackButton';
import { PinchDensity } from '@/components/PinchDensity';
import { PosterGridSkeleton } from '@/components/PageSkeletons';
import { NativePressable } from '@/components/ui/NativePressable';
import { EmptyState, Input } from '@/components/ui/primitives';
import { PosterImage } from '@/components/ui/PosterImage';
import { colors } from '@/constants/colors';
import { createStyles } from '@/lib/typography';
import {
  DEFAULT_DISPLAY_PREFERENCES,
  gridItemWidth,
  type GridColumns,
} from '@/lib/displayPreferences';

type PublicTitle = {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath?: string;
  overview?: string;
  releaseDate?: string;
  contributorCount: number;
};

export default function GlobalTagScreen() {
  const params = useLocalSearchParams<{ tag?: string | string[] }>();
  const tag = Array.isArray(params.tag) ? params.tag[0] : (params.tag ?? '');
  const collection = useQuery(api.tags.publicDetails, tag ? { tag } : 'skip');
  const library = useQuery(api.library.listItems);
  const settings = useQuery(api.settings.getSettings);
  const setSettings = useMutation(api.settings.setSettings);
  const [search, setSearch] = useState('');
  const [gridOverride, setGridOverride] = useState<{
    base: GridColumns | undefined;
    value: GridColumns;
  }>();
  const gridColumns =
    gridOverride && settings?.gridColumns === gridOverride.base
      ? gridOverride.value
      : (settings?.gridColumns ?? DEFAULT_DISPLAY_PREFERENCES.gridColumns);
  const titles = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return (collection?.titles ?? []).filter(
      (title: PublicTitle) => !query || title.title.toLocaleLowerCase().includes(query),
    );
  }, [collection, search]);

  const openTitle = (title: PublicTitle) => {
    const existing = library?.find(
      (item) => item.tmdbId === title.tmdbId && item.mediaType === title.mediaType,
    );
    if (existing) {
      router.push(`/item/${existing._id}`);
      return;
    }
    router.push({
      pathname: '/title/[mediaType]/[tmdbId]',
      params: {
        mediaType: title.mediaType,
        tmdbId: String(title.tmdbId),
        preview: JSON.stringify({
          id: title.tmdbId,
          mediaType: title.mediaType,
          title: title.title,
          posterPath: title.posterPath,
          overview: title.overview,
          releaseDate: title.releaseDate,
        }),
      },
    });
  };
  const updateGridColumns = (next: GridColumns) => {
    setGridOverride({ base: settings?.gridColumns, value: next });
    void setSettings({ gridColumns: next }).catch(() => setGridOverride(undefined));
  };

  return (
    <View style={s.root}>
      <SecondaryHeader
        title={collection?.tag ?? tag}
        backLabel="Back to Explore"
        fallback="/explore"
        maxWidth={880}
      />
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Input
          accessibilityLabel={`Search public ${tag} titles`}
          value={search}
          onChangeText={setSearch}
          placeholder={`Search ${tag}`}
          returnKeyType="search"
          compact
          style={s.search}
        />
        {!tag ? (
          <EmptyState title="Public tag not found" detail="The tag address is incomplete." />
        ) : collection === undefined ? (
          <PosterGridSkeleton accessibilityLabel="Loading public tag" />
        ) : collection === null ? (
          <EmptyState title="Public tag not found" detail="This tag may have been made private." />
        ) : (
          <PinchDensity columns={gridColumns} onChange={updateGridColumns}>
            <Text style={s.summary}>
              {titles.length} {titles.length === 1 ? 'title' : 'titles'} from{' '}
              {collection.contributorCount}{' '}
              {collection.contributorCount === 1 ? 'person' : 'people'}
            </Text>
            <TitleSection
              title="Movies"
              titles={titles.filter((title: PublicTitle) => title.mediaType === 'movie')}
              onPress={openTitle}
              columns={gridColumns}
            />
            <TitleSection
              title="TV Shows"
              titles={titles.filter((title: PublicTitle) => title.mediaType === 'tv')}
              onPress={openTitle}
              columns={gridColumns}
            />
          </PinchDensity>
        )}
      </ScrollView>
    </View>
  );
}

function TitleSection({
  title,
  titles,
  onPress,
  columns,
}: {
  title: string;
  titles: PublicTitle[];
  onPress: (title: PublicTitle) => void;
  columns: GridColumns;
}) {
  if (!titles.length) return null;
  return (
    <View style={s.section}>
      <View style={s.sectionHead}>
        <Text style={s.sectionTitle}>{title}</Text>
        <Text style={s.count}>{titles.length.toString().padStart(2, '0')}</Text>
      </View>
      <View style={s.grid}>
        {titles.map((item) => (
          <NativePressable
            key={`${item.mediaType}-${item.tmdbId}`}
            accessibilityRole="button"
            accessibilityLabel={`View ${item.title}`}
            onPress={() => onPress(item)}
            style={[s.card, { width: gridItemWidth(columns) }]}
            pressedStyle={s.pressed}
          >
            <PosterImage path={item.posterPath} title={item.title} style={s.poster} />
            <Text numberOfLines={2} style={s.cardTitle}>
              {item.title}
            </Text>
            <Text style={s.cardMeta}>
              {item.contributorCount} {item.contributorCount === 1 ? 'collection' : 'collections'}
            </Text>
          </NativePressable>
        ))}
      </View>
    </View>
  );
}

const s = createStyles({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    width: '100%',
    maxWidth: 880,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 88,
    paddingBottom: 80,
  },
  search: {
    height: 36,
    borderWidth: 0,
    backgroundColor: colors.surface,
    fontSize: 14,
  },
  summary: { color: colors.muted, fontSize: 11, marginTop: 14 },
  section: { marginTop: 28 },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 11,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  count: { color: colors.muted, fontSize: 11, fontVariant: ['tabular-nums'] },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: '3.5%',
    rowGap: 18,
    paddingTop: 16,
  },
  card: { minWidth: 0 },
  poster: { width: '100%', aspectRatio: 2 / 3, borderRadius: 12 },
  cardTitle: { color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '600', marginTop: 6 },
  cardMeta: { color: colors.muted, fontSize: 9, marginTop: 3 },
  pressed: { opacity: 0.72 },
});
