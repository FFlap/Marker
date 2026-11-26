import { CastSection } from '@/features/title/components/CastSection';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import Plus from 'lucide-react-native/icons/plus';
import { ExpandableOverview } from '@/components/ExpandableOverview';
import { useTaskState } from '@/hooks/use-task-state';
import { castForDisplay } from '@marker/shared/castPresentation';
import { localDateKey } from '@/hooks/use-local-today';
import { ScreenView } from '@/components/ScreenLayout';
import * as Effect from 'effect/Effect';
import { saveLibrary } from '@marker/shared/clientEffects';
import { useOperation } from '@/hooks/use-operation';
import type { Episode } from '@/features/title/libraryItemTypes';
import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '@marker/shared/api';
import { LibraryEntryDrawer, type LibraryEntryDraft } from '@/components/LibraryEntryDrawer';
import { SecondaryHeader } from '@/components/BackButton';
import { useScrolledPast } from '@/hooks/use-scrolled-past';
import { SeasonPicker } from '@/components/SeasonPicker';
import { availableSeasons as getAvailableSeasons } from '@/features/title/seasons';
import { SectionHeader } from '@/features/title/components/SectionHeader';
import {
  EntryActionBar,
  useEntryActionBarLayout,
} from '@/features/title/components/EntryActionBar';
import { SeasonHeaderRow } from '@/features/title/components/SeasonProgress';
import { SkeletonShimmer } from '@/components/SkeletonShimmer';
import { EpisodeSkeletonRows } from '@/components/EpisodeSkeletonRows';
import { Button, EmptyState } from '@/components/ui/primitives';
import { TagList } from '@/components/ui/TagList';
import { PosterImage } from '@/components/ui/PosterImage';
import { useToast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { NativePressable } from '@/components/ui/NativePressable';
import { useTitleView } from '@/hooks/use-title-view';
import { useRefreshControl } from '@/hooks/use-refresh-control';
import { SEASON_EPISODE_RENDER_BATCH, useSeasonView } from '@/hooks/use-season-view';
import { titleDetailScreenStyles as s } from '@/features/title/screens/TitleDetailScreen.styles';
import {
  type MediaType,
  parseTitleRoute,
  parseTitlePreview,
  type TitleRouteParams,
} from '@/features/title/titleRoute';
import { displayEpisodeName, displayGenres } from '@/lib/text';
import { formatActivityDate } from '@marker/shared/watchActivityStats';
import { DetailPageSkeleton } from '@/components/PageSkeletons';

function MetadataPlaceholder({
  label,
  kind,
}: {
  label: string;
  kind: 'chip' | 'stat' | 'episodes';
}) {
  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityRole="progressbar"
      style={[s.placeholder, s[`${kind}Placeholder`]]}
    >
      <SkeletonShimmer />
    </View>
  );
}

function TitleSkeleton() {
  return (
    <View
      style={s.titleSkeleton}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading title"
    >
      <View style={s.titleSkeletonPoster} />
      <View style={s.titleSkeletonCopy}>
        <View style={s.skeletonLineTitle} />
        <View style={s.skeletonLineShort} />
        <View style={s.skeletonLineLong} />
        <View style={s.skeletonLine} />
      </View>
      <SkeletonShimmer />
    </View>
  );
}

export default function TitleDetailScreen() {
  const params = useLocalSearchParams<TitleRouteParams>();
  const { routeKey } = parseTitleRoute(params);
  return <TitleDetailRoute key={routeKey} params={params} />;
}

/** Show catalog metadata and actions for adding or tracking a title. */
function TitleDetailRoute({ params }: { params: TitleRouteParams }) {
  const runOperation = useOperation();
  // Only labels air dates ("Airs" / "Aired"); no need to re-render at midnight.
  const today = localDateKey();
  const { mediaType, tmdbId, validId } = parseTitleRoute(params);
  const parsedPreview = useMemo(() => parseTitlePreview(params.preview), [params.preview]);
  const preview =
    parsedPreview?.id === tmdbId && parsedPreview.mediaType === mediaType
      ? parsedPreview
      : undefined;
  const [selectedSeason, setSeason] = useState(1);
  const addItem = useMutation(api.library.items.addItem);
  const addItemAndMarkWatched = useAction(api.library.seasonWatched.addItemAndMarkWatched);
  const existing = useQuery(
    api.library.items.getOwnedItemByTmdb,
    mediaType && validId ? { mediaType, tmdbId } : 'skip',
  );
  const {
    title: detail,
    season,
    titleRequestState,
    seasonRequestState,
    touchError,
    refresh,
  } = useTitleView(
    mediaType && validId
      ? {
          mediaType,
          tmdbId,
          ...(preview?.title !== undefined && { title: preview.title }),
          season: selectedSeason,
        }
      : undefined,
  );
  const toast = useToast();
  const metadataRefresh = useRefreshControl(() => refresh({ force: true }));
  const heroOwner =
    detail !== undefined ? 'canonical' : preview !== undefined ? 'preview' : undefined;
  const hero = heroOwner === 'canonical' ? detail : heroOwner === 'preview' ? preview : undefined;
  const loading = !detail && titleRequestState?.state !== 'failed' && touchError === undefined;
  const failed = !detail && (titleRequestState?.state === 'failed' || touchError !== undefined);
  const [entryOpen, setEntryOpen] = useState(false);
  const [tagPrefix, setTagPrefix] = useState('');
  const { pending: entrySaving, setPending: setEntrySaving } = useTaskState();
  const canonicalSeason = useSeasonView(
    mediaType === 'tv' && validId ? { tmdbId, season } : undefined,
  );
  const returnedSeasonRow = canonicalSeason.season;
  const seasonRow = returnedSeasonRow?.season === season ? returnedSeasonRow : undefined;
  const episodes = seasonRow ? canonicalSeason.episodes : [];
  const seasonError =
    !seasonRow &&
    (seasonRequestState?.state === 'failed' ||
      seasonRequestState?.state === 'notFound' ||
      touchError !== undefined);
  const canLoadMore =
    canonicalSeason.status === 'CanLoadMore' &&
    seasonRow !== undefined &&
    episodes.length < seasonRow.totalCount;
  const [seasonMenuOpen, setSeasonMenuOpen] = useState(false);
  // The header names the title once the poster and title scroll out of view.
  const { past: heroHidden, onScroll: onListScroll } = useScrolledPast(200);
  const [expanded, setExpanded] = useState<string>();
  const entryBar = useEntryActionBarLayout();

  const suggestions =
    useQuery(
      api.library.items.listTagSuggestions,
      entryOpen ? { prefix: tagPrefix.trim() || undefined } : 'skip',
    ) ?? [];
  const meta = {
    title: hero?.title ?? '',
    posterPath: hero?.posterPath,
    overview: hero?.overview,
    releaseDate:
      hero?.releaseDate ?? (heroOwner === 'canonical' ? detail?.firstAirDate : undefined),
    genres: detail?.genres ?? [],
    cast: detail?.cast ?? [],
    seasons: detail?.seasons ?? [],
  };
  const visibleCast = castForDisplay(meta.cast ?? [], meta.genres);
  const overview = meta.overview?.trim();
  const availableSeasons = getAvailableSeasons(meta.seasons);
  const averageRuntime = detail?.episodeRunTime?.length
    ? detail.episodeRunTime.reduce((sum, value) => sum + value, 0) / detail.episodeRunTime.length
    : undefined;
  const initialEntry: LibraryEntryDraft = {
    status: 'watchlist',
    rating: undefined,
    timesWatched: 0,
    tags: [],
  };

  const saveEntry = async (draft: LibraryEntryDraft) => {
    if (!mediaType || !validId || entrySaving || !meta.title.trim()) return;
    setEntrySaving(true);
    await runOperation.write(
      Effect.gen(function* () {
        const addArgs = {
          tmdbId,
          mediaType: mediaType as MediaType,
          title: meta.title,
          posterPath: meta.posterPath,
          overview: meta.overview,
          releaseDate: meta.releaseDate,
          runtime: averageRuntime,
          genres: meta.genres,
          status: draft.status,
          rating: draft.rating,
          timesWatched: draft.timesWatched,
          tags: draft.tags,
        };
        const itemId =
          mediaType === 'tv' && draft.status === 'watched'
            ? yield* saveLibrary(() =>
                addItemAndMarkWatched({
                  ...addArgs,
                  activityDate: localDateKey(),
                }),
              )
            : yield* saveLibrary(() => addItem(addArgs));
        return itemId;
      }),
      {
        success: (itemId) => {
          setEntryOpen(false);
          toast.show(`${meta.title} added`);
          router.replace(`/item/${itemId}`);
        },

        failure: () => {
          toast.show('Couldn’t add this title');
        },
        settled: () => {
          setEntrySaving(false);
        },
      },
    );
  };

  const renderEpisode = ({ item: episode }: { item: Episode }) => {
    const episodeKey = `${episode.season}:${episode.episode}`;
    const hasDetails = !!episode.overview || !!episode.airDate;
    const isExpanded = hasDetails && expanded === episodeKey;
    const summary = (
      <>
        <View style={s.epCopy}>
          <Text numberOfLines={1} style={s.epMeta}>
            <Text style={s.epNo}>E{episode.episode}</Text>
            {!!episode.runtime && ` · ${episode.runtime} min`}
          </Text>
          <Text numberOfLines={2} style={s.epName}>
            {displayEpisodeName(episode.name)}
          </Text>
        </View>
        {/* Tapping shows the synopsis and air date below the row. */}
        {hasDetails && (
          <ChevronDown
            size={16}
            color={colors.muted}
            strokeWidth={2}
            style={isExpanded ? { transform: [{ rotate: '180deg' }] } : undefined}
          />
        )}
      </>
    );
    return (
      <View style={s.episode}>
        <View style={s.epRow}>
          <View style={s.episodeArtwork}>
            {episode.imageUrl ? (
              <Image
                source={episode.imageUrl}
                accessibilityLabel={`Episode ${episode.episode} artwork`}
                contentFit="cover"
                transition={150}
                recyclingKey={episodeKey}
                style={s.episodeImage}
              />
            ) : (
              <View style={s.episodeImageFallback}>
                {/* No still for this episode: a quiet number, not a loading shimmer. */}
                <Text style={s.episodeImageNumber}>
                  {episode.episode.toString().padStart(2, '0')}
                </Text>
              </View>
            )}
          </View>
          {hasDetails ? (
            <NativePressable
              accessibilityRole="button"
              accessibilityLabel={`View episode ${episode.episode}`}
              accessibilityState={{ expanded: isExpanded }}
              style={s.epExpand}
              pressedStyle={s.epExpandPressed}
              onPress={() => setExpanded(isExpanded ? undefined : episodeKey)}
            >
              {summary}
            </NativePressable>
          ) : (
            <View style={s.epExpand}>{summary}</View>
          )}
        </View>
        {isExpanded && (
          <View style={s.epDetails}>
            {!!episode.overview && <Text style={s.epFullOverview}>{episode.overview}</Text>}
            {!!episode.airDate && (
              <Text style={s.episodeDate}>
                {/^\d{4}-\d{2}-\d{2}$/.test(episode.airDate) && episode.airDate > today
                  ? 'Airs'
                  : 'Aired'}{' '}
                {/^\d{4}-\d{2}-\d{2}$/.test(episode.airDate)
                  ? formatActivityDate(episode.airDate)
                  : episode.airDate}
              </Text>
            )}
          </View>
        )}
      </View>
    );
  };

  if (existing) return <Redirect href={`/item/${existing._id}`} />;

  if (!mediaType || !validId)
    return (
      <ScreenView style={s.root}>
        <SecondaryHeader
          title="Details"
          maxWidth={760}
          backLabel="Back to explore"
          fallback="/explore"
        />
        <View style={s.state}>
          <EmptyState title="Title not found" detail="This title link is invalid." />
        </View>
      </ScreenView>
    );

  if (failed && !hero)
    return (
      <ScreenView style={s.root}>
        <SecondaryHeader
          title="Details"
          maxWidth={760}
          backLabel="Back to explore"
          fallback="/explore"
        />
        <View style={s.state}>
          <View style={s.inlineError}>
            <Text style={s.errorText}>Title details couldn’t be loaded.</Text>
            <Button title="Retry" variant="ghost" onPress={() => refresh({ force: true })} />
          </View>
        </View>
      </ScreenView>
    );

  if (heroOwner === undefined)
    return (
      <ScreenView testID="title-detail-initial-placeholder" style={s.root}>
        <SecondaryHeader title="Details" maxWidth={760} />
        <DetailPageSkeleton />
      </ScreenView>
    );

  return (
    <ScreenView style={s.root}>
      <SecondaryHeader
        title={heroHidden ? meta.title : ''}
        maxWidth={760}
        backLabel="Back to explore"
        fallback="/explore"
      />
      <FlatList
        testID="episode-list"
        onScroll={onListScroll}
        scrollEventThrottle={16}
        data={mediaType === 'tv' ? episodes : []}
        keyExtractor={(episode) => `${episode.season}:${episode.episode}`}
        initialNumToRender={SEASON_EPISODE_RENDER_BATCH}
        maxToRenderPerBatch={SEASON_EPISODE_RENDER_BATCH}
        contentContainerStyle={[s.content, { paddingBottom: entryBar.contentPaddingBottom }]}
        refreshControl={
          <RefreshControl
            refreshing={metadataRefresh.refreshing}
            onRefresh={metadataRefresh.onRefresh}
            tintColor={colors.accent}
          />
        }
        ListHeaderComponent={
          <>
            <View style={s.hero}>
              <PosterImage
                testID="title-detail-poster"
                path={meta.posterPath}
                title={meta.title}
                style={s.poster}
              />
              <View style={s.heroCopy}>
                <Text testID="title-detail-name" style={s.title}>
                  {meta.title}
                </Text>
                <Text testID="title-detail-year" style={s.meta}>
                  {meta.releaseDate?.slice(0, 4)}
                </Text>
                <View style={s.genres}>
                  {detail ? (
                    <TagList tags={displayGenres(meta.genres)} />
                  ) : (
                    <MetadataPlaceholder label="Loading genres" kind="chip" />
                  )}
                </View>
              </View>
            </View>
            {overview ? (
              <ExpandableOverview
                key={`${mediaType}:${tmdbId}:${overview}`}
                text={overview}
                testID="title-detail-overview"
                style={s.overview}
              />
            ) : null}

            {loading && heroOwner !== 'preview' && <TitleSkeleton />}
            {failed && (
              <View style={s.inlineError}>
                <Text style={s.errorText}>Title details couldn’t be loaded.</Text>
                <Button title="Retry" variant="ghost" onPress={() => refresh({ force: true })} />
              </View>
            )}
            {(titleRequestState?.state === 'failed' || touchError !== undefined) && detail && (
              <Text style={s.metadataLoadingText}>Couldn’t update. Pull to retry.</Text>
            )}

            <CastSection
              members={visibleCast}
              loading={
                (!detail || titleRequestState?.state === 'inFlight') &&
                titleRequestState?.state !== 'failed' &&
                touchError === undefined
              }
            />

            {mediaType === 'tv' && (
              <>
                <SectionHeader title="Episodes" />
                {!detail ? (
                  <View style={s.episodePlaceholders}>
                    <MetadataPlaceholder label="Loading seasons" kind="stat" />
                    <MetadataPlaceholder label="Loading episodes" kind="episodes" />
                  </View>
                ) : availableSeasons.length ? (
                  <>
                    <View style={s.seasonAction}>
                      <SeasonHeaderRow
                        picker={
                          <SeasonPicker
                            open={seasonMenuOpen}
                            value={season}
                            options={availableSeasons}
                            onOpenChange={setSeasonMenuOpen}
                            onChange={setSeason}
                          />
                        }
                      />
                    </View>
                    {!seasonRow && !seasonError && <EpisodeSkeletonRows />}
                    {seasonError && (
                      <View style={s.inlineError}>
                        <Text style={s.errorText}>Episodes couldn’t be loaded.</Text>
                        <Button
                          title="Retry"
                          variant="ghost"
                          onPress={() => refresh({ force: true })}
                        />
                      </View>
                    )}
                    {seasonRequestState?.state === 'failed' && seasonRow && (
                      <Text style={s.metadataLoadingText}>Couldn’t update. Pull to retry.</Text>
                    )}
                  </>
                ) : (
                  <Text style={s.metadataLoadingText}>Episode guide unavailable</Text>
                )}
              </>
            )}
          </>
        }
        renderItem={renderEpisode}
        ListFooterComponent={
          <>
            {canLoadMore && (
              <Button
                title="Load more episodes"
                variant="ghost"
                onPress={() => canonicalSeason.loadMore(1)}
              />
            )}
          </>
        }
      />

      <EntryActionBar
        label="Add entry"
        icon={<Plus size={18} color={colors.bg} strokeWidth={2.2} />}
        onLayout={entryBar.onLayout}
        disabled={existing === undefined || loading || !meta.title.trim()}
        onPress={() => setEntryOpen(true)}
      />

      <LibraryEntryDrawer
        open={entryOpen}
        onOpenChange={(open) => {
          setEntryOpen(open);
          if (!open) setTagPrefix('');
        }}
        mode="add"
        initial={initialEntry}
        suggestions={suggestions}
        onTagPrefixChange={setTagPrefix}
        saving={entrySaving}
        onSubmit={saveEntry}
        watchedHint={
          mediaType === 'tv'
            ? 'Marking this show as Watched will mark all released episodes as watched.'
            : undefined
        }
      />
    </ScreenView>
  );
}
