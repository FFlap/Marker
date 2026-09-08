import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../../../convex/_generated/api';
import { SecondaryHeader } from '@/components/BackButton';
import { LibraryFiltersDrawer } from '@/components/LibraryFiltersDrawer';
import { PinchDensity } from '@/components/PinchDensity';
import { PosterGridSkeleton } from '@/components/PageSkeletons';
import { NativePressable } from '@/components/ui/NativePressable';
import { Button, EmptyState, Input } from '@/components/ui/primitives';
import { PosterImage } from '@/components/ui/PosterImage';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';
import {
  DEFAULT_DISPLAY_PREFERENCES,
  gridItemWidth,
  type GridColumns,
} from '@/lib/displayPreferences';
import type { Status } from '@/types';
import {
  LIBRARY_STATUSES,
  matchesMediaType,
  type MediaTypeFilter,
  type StatusFilter,
} from '@/lib/libraryFilters';

type PublicTitle = {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  posterPath?: string;
  overview?: string;
  releaseDate?: string;
  rank: number;
  status: Status;
  rating?: number;
  genres?: string[];
  isAnime: boolean;
};
type PublicCollection = {
  username: string;
  tag: string;
  isOwner: boolean;
  isPublic: boolean;
  titles: PublicTitle[];
  nextCursor?: string;
};

export default function UserTagScreen() {
  const params = useLocalSearchParams<{
    username?: string | string[];
    tag?: string | string[];
  }>();
  const username = Array.isArray(params.username) ? params.username[0] : (params.username ?? '');
  const tag = Array.isArray(params.tag) ? params.tag[0] : (params.tag ?? '');
  const routeKey = `${username.toLocaleLowerCase()}:${tag.toLocaleLowerCase()}`;
  return <UserTagRoute key={routeKey} username={username} tag={tag} />;
}

function UserTagRoute({ username, tag }: { username: string; tag: string }) {
  const [pageCursor, setPageCursor] = useState<string>();
  const [previousPages, setPreviousPages] = useState<PublicCollection[]>([]);
  const collectionPage = useQuery(
    api.tags.publicByUser,
    username && tag ? { username, tag, cursor: pageCursor } : 'skip',
  ) as PublicCollection | null | undefined;
  const collection = useMemo(() => {
    if (collectionPage === null) return null;
    const available = collectionPage ? [...previousPages, collectionPage] : previousPages;
    if (!available.length) return undefined;
    const titles = new Map<string, PublicTitle>();
    for (const page of available)
      for (const title of page.titles) titles.set(`${title.mediaType}:${title.tmdbId}`, title);
    return { ...available[0], titles: [...titles.values()] };
  }, [collectionPage, previousPages]);
  const nextCursor = collectionPage?.nextCursor;
  const loadMore = () => {
    if (!collectionPage || !nextCursor) return;
    setPreviousPages((current) => [...current, collectionPage]);
    setPageCursor(nextCursor);
  };
  const library = useQuery(api.library.items.listItems);
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
  const [type, setType] = useState<MediaTypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [minimumRating, setMinimumRating] = useState(0);
  const watchedRankByTitle = useMemo(
    () =>
      new Map(
        [...(collection?.titles ?? [])]
          .filter((title: PublicTitle) => title.status === 'watched')
          .sort((left: PublicTitle, right: PublicTitle) => left.rank - right.rank)
          .map((title: PublicTitle, index: number) => [
            `${title.mediaType}:${title.tmdbId}`,
            index + 1,
          ]),
      ),
    [collection],
  );
  const titles = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return [...(collection?.titles ?? [])]
      .filter(
        (title: PublicTitle) =>
          (!query || title.title.toLocaleLowerCase().includes(query)) &&
          matchesMediaType(title, type) &&
          (statusFilter === 'all' || title.status === statusFilter) &&
          (!minimumRating || (title.rating ?? -1) >= minimumRating),
      )
      .sort((left: PublicTitle, right: PublicTitle) => left.rank - right.rank);
  }, [collection, minimumRating, search, statusFilter, type]);
  const visibleStatuses =
    statusFilter === 'all'
      ? LIBRARY_STATUSES
      : LIBRARY_STATUSES.filter(([status]) => status === statusFilter);
  const filtersActive =
    !!search.trim() || type !== 'all' || statusFilter !== 'all' || minimumRating > 0;

  const clearFilters = () => {
    setSearch('');
    setType('all');
    setStatusFilter('all');
    setMinimumRating(0);
  };
  const updateGridColumns = (next: GridColumns) => {
    setGridOverride({ base: settings?.gridColumns, value: next });
    void setSettings({ gridColumns: next }).catch(() => setGridOverride(undefined));
  };

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

  return (
    <View style={s.root}>
      <SecondaryHeader
        title={collection?.tag ?? tag}
        backLabel={`Back to @${username}`}
        fallback={`/u/${username}`}
        maxWidth={880}
      />
      <View style={s.toolbar}>
        <Input
          accessibilityLabel={`Search ${username}'s ${tag} tag`}
          value={search}
          onChangeText={setSearch}
          placeholder={`Search ${tag}`}
          returnKeyType="search"
          compact
          style={s.search}
        />
        <LibraryFiltersDrawer
          active={filtersActive}
          mediaType={type}
          status={statusFilter}
          minimumRating={minimumRating}
          onMediaTypeChange={setType}
          onStatusChange={setStatusFilter}
          onMinimumRatingChange={setMinimumRating}
          onClear={clearFilters}
        />
      </View>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {collection === undefined ? (
          <PosterGridSkeleton accessibilityLabel="Loading tag" />
        ) : collection === null ? (
          <EmptyState
            title="Tag not available"
            detail="This collection is private or no longer exists."
          />
        ) : (
          <PinchDensity columns={gridColumns} onChange={updateGridColumns}>
            {visibleStatuses.map(([status, label]) => {
              const sectionTitles = titles.filter((title) => title.status === status);
              return (
                <View key={status} style={s.section}>
                  <View style={s.sectionHead}>
                    <Text style={s.sectionTitle}>{label}</Text>
                    <Text style={s.count}>{sectionTitles.length.toString().padStart(2, '0')}</Text>
                  </View>
                  {!sectionTitles.length ? (
                    <EmptyState
                      title={filtersActive ? 'No matches' : 'Nothing here yet'}
                      detail={
                        filtersActive ? 'Try a broader filter.' : 'No titles in this section.'
                      }
                    />
                  ) : (
                    <View style={s.grid}>
                      {sectionTitles.map((title: PublicTitle) => (
                        <NativePressable
                          key={`${title.mediaType}-${title.tmdbId}`}
                          accessibilityRole="button"
                          accessibilityLabel={`${status === 'watched' ? `${watchedRankByTitle.get(`${title.mediaType}:${title.tmdbId}`)}. ` : ''}${title.title}`}
                          onPress={() => openTitle(title)}
                          style={[s.card, { width: gridItemWidth(gridColumns) }]}
                          pressedStyle={s.pressed}
                        >
                          <PosterImage
                            path={title.posterPath}
                            title={title.title}
                            style={s.poster}
                          />
                          <Text numberOfLines={2} style={s.cardTitle}>
                            {status === 'watched' && (
                              <Text style={s.rank}>
                                {watchedRankByTitle.get(`${title.mediaType}:${title.tmdbId}`)}.{' '}
                              </Text>
                            )}
                            {title.title}
                          </Text>
                        </NativePressable>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
            {nextCursor && <Button title="Load more titles" variant="outline" onPress={loadMore} />}
          </PinchDensity>
        )}
      </ScrollView>
    </View>
  );
}

const s = createAppStyles(
  {
    root: { flex: 1, backgroundColor: colors.bg },
    toolbar: {
      position: 'absolute',
      top: 72,
      left: 0,
      right: 0,
      zIndex: 9,
      width: '100%',
      maxWidth: 880,
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 8,
      backgroundColor: colors.bg,
    },
    content: {
      width: '100%',
      maxWidth: 880,
      alignSelf: 'center',
      paddingHorizontal: 20,
      paddingTop: 116,
      paddingBottom: 80,
    },
    search: {
      flex: 1,
      height: 36,
      minWidth: 0,
      borderWidth: 0,
      backgroundColor: colors.surface,
      fontSize: 14,
    },
    section: { marginTop: 24 },
    sectionHead: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingBottom: 11,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    sectionTitle: { color: colors.muted, fontSize: 12, letterSpacing: 0.2, fontWeight: '600' },
    count: { color: colors.muted, fontSize: 11, fontVariant: ['tabular-nums'] },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: '3.5%',
      rowGap: 12,
      paddingTop: 16,
      paddingBottom: 4,
    },
    card: { minWidth: 0 },
    poster: { width: '100%', aspectRatio: 2 / 3, borderRadius: 12 },
    cardTitle: {
      color: colors.text,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '600',
      marginTop: 6,
    },
    rank: { color: colors.muted },
    pressed: { opacity: 0.72 },
  },
  ['search', 'sectionTitle', 'count', 'cardTitle', 'rank'] as const,
);
