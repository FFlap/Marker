import { useMemo, useState } from 'react';
import { FlatList, Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import { LibraryEntryDrawer, type LibraryEntryDraft } from '@/components/LibraryEntryDrawer';
import { SecondaryHeader } from '@/components/BackButton';
import { SeasonPicker } from '@/components/SeasonPicker';
import { SkeletonShimmer } from '@/components/SkeletonShimmer';
import { EpisodeSkeletonRows } from '@/components/EpisodeSkeletonRows';
import { Button, Chip, EmptyState } from '@/components/ui/primitives';
import { PosterImage } from '@/components/ui/PosterImage';
import { useToast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { createStyles } from '@/lib/typography';
import type { SearchResult } from '@/types';
import { useMetadataRecoveryTimers, useTitleView } from '@/hooks/use-title-view';
import {
  SEASON_EPISODE_RENDER_BATCH,
  useRouteSeason,
  useSeasonView,
} from '@/hooks/use-season-view';

type MediaType = 'movie' | 'tv';
type Episode = {
  season: number;
  episode: number;
  name: string;
  overview?: string;
  runtime?: number;
  imageUrl?: string;
  airDate?: string;
};
type SeasonRow = {
  season: number;
  metadataProvider: 'tmdb' | 'tvdb';
  orderEpoch: number;
  totalCount: number;
};
type TitleDetail = {
  tmdbId?: number;
  title: string;
  mediaType: MediaType;
  posterPath?: string;
  overview?: string;
  releaseDate?: string;
  firstAirDate?: string;
  voteAverage?: number;
  runtime?: number;
  episodeRunTime?: number[];
  genres: string[];
  cast: { name: string; character: string; profilePath?: string }[];
  seasons?: { season: number; name: string; episodeCount: number }[];
  metadataProvider?: 'tmdb' | 'tvdb';
  tvdbId?: number;
  seasonOrder?: string;
};

const parsePreview = (value?: string): SearchResult | undefined => {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<SearchResult>;
    if (
      typeof parsed.id !== 'number' ||
      typeof parsed.title !== 'string' ||
      !parsed.title.trim() ||
      (parsed.mediaType !== 'movie' && parsed.mediaType !== 'tv')
    )
      return undefined;
    return parsed as SearchResult;
  } catch {
    return undefined;
  }
};

function MetadataPlaceholder({
  label,
  kind,
}: {
  label: string;
  kind: 'chip' | 'stat' | 'cast' | 'episodes';
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

type TitleRouteParams = {
  mediaType: string;
  tmdbId: string;
  preview?: string;
};

export default function TitleDetailScreen() {
  const params = useLocalSearchParams<TitleRouteParams>();
  const mediaType =
    params.mediaType === 'movie' || params.mediaType === 'tv' ? params.mediaType : undefined;
  const tmdbId = Number(params.tmdbId);
  const validId = params.tmdbId.trim() !== '' && Number.isInteger(tmdbId) && tmdbId >= 1;
  const routeKey = `${mediaType ?? 'invalid'}:${validId ? tmdbId : 'invalid'}`;
  return <TitleDetailRoute key={routeKey} params={params} />;
}

function TitleDetailRoute({ params }: { params: TitleRouteParams }) {
  const mediaType =
    params.mediaType === 'movie' || params.mediaType === 'tv' ? params.mediaType : undefined;
  const tmdbId = Number(params.tmdbId);
  const validId = params.tmdbId.trim() !== '' && Number.isInteger(tmdbId) && tmdbId >= 1;
  const parsedPreview = useMemo(() => parsePreview(params.preview), [params.preview]);
  const preview =
    parsedPreview?.id === tmdbId && parsedPreview.mediaType === mediaType
      ? parsedPreview
      : undefined;
  const routeKey = `${mediaType ?? 'invalid'}:${validId ? tmdbId : 'invalid'}`;
  const [selectedSeason, setSeason] = useRouteSeason(routeKey);
  const addItem = useMutation(api.library.addItem);
  const addItemAndMarkWatched = useAction(api.library.addItemAndMarkWatched);
  const existing = useQuery(
    api.library.getOwnedItemByTmdb,
    mediaType && validId ? { mediaType, tmdbId } : 'skip',
  );
  const {
    view: titleView,
    touchError,
    touchTitle,
  } = useTitleView(
    mediaType && validId
      ? {
          mediaType,
          tmdbId,
          ...(preview?.title !== undefined && { title: preview.title }),
          ...(mediaType === 'tv' && { season: selectedSeason }),
        }
      : undefined,
    undefined,
    undefined,
    false,
  );
  const toast = useToast();
  const returnedDetail = titleView?.title as TitleDetail | null | undefined;
  const detail =
    returnedDetail?.tmdbId === tmdbId && returnedDetail.mediaType === mediaType
      ? returnedDetail
      : undefined;
  const firstSeason = detail?.seasons?.find((entry) => entry.season > 0)?.season ?? 1;
  const season =
    detail?.seasons?.some((entry) => entry.season === selectedSeason) === false
      ? firstSeason
      : selectedSeason;
  const availableHeroOwner =
    detail !== undefined
      ? 'canonical'
      : preview !== undefined && titleView !== undefined
        ? 'preview'
        : undefined;
  const [storedHeroSelection, setHeroSelection] = useState<{
    key: string;
    owner: 'canonical' | 'preview' | undefined;
  }>({ key: routeKey, owner: availableHeroOwner });
  let heroSelection = storedHeroSelection;
  if (storedHeroSelection.key !== routeKey) {
    heroSelection = { key: routeKey, owner: availableHeroOwner };
    setHeroSelection(heroSelection);
  } else if (storedHeroSelection.owner === undefined && availableHeroOwner !== undefined) {
    heroSelection = { ...storedHeroSelection, owner: availableHeroOwner };
    setHeroSelection(heroSelection);
  }
  const heroOwner = heroSelection.owner;
  const hero = heroOwner === 'canonical' ? detail : heroOwner === 'preview' ? preview : undefined;
  const loading =
    !detail && titleView?.requestState?.state !== 'failed' && touchError === undefined;
  const failed =
    !detail && (titleView?.requestState?.state === 'failed' || touchError !== undefined);
  const [entryOpen, setEntryOpen] = useState(false);
  const [tagPrefix, setTagPrefix] = useState('');
  const [entrySaving, setEntrySaving] = useState(false);
  const canonicalSeason = useSeasonView(
    mediaType === 'tv' && validId ? { tmdbId, season } : undefined,
  );
  const seasonRequestState = useQuery(
    api.resolvedMetadata.getSeasonRequestState,
    mediaType === 'tv' && validId ? { tmdbId, season } : 'skip',
  );
  const returnedSeasonRow = canonicalSeason.season as SeasonRow | undefined;
  const seasonRow = returnedSeasonRow?.season === season ? returnedSeasonRow : undefined;
  const episodes = seasonRow ? canonicalSeason.episodes : [];
  const loadedSeason = seasonRow?.season;
  const seasonLoading =
    !seasonRow &&
    canonicalSeason.status === 'LoadingFirstPage' &&
    seasonRequestState?.state !== 'failed' &&
    seasonRequestState?.state !== 'notFound';
  const seasonError =
    !seasonRow &&
    (seasonRequestState?.state === 'failed' || seasonRequestState?.state === 'notFound');
  const canLoadMore =
    canonicalSeason.status === 'CanLoadMore' &&
    seasonRow !== undefined &&
    episodes.length < seasonRow.totalCount;
  const [seasonMenuOpen, setSeasonMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState<string>();
  useMetadataRecoveryTimers({
    titleKey: mediaType && validId ? `${mediaType}:${tmdbId}` : undefined,
    titleState: titleView?.requestState,
    seasonKey: mediaType === 'tv' && validId ? `season:${tmdbId}:${season}` : undefined,
    seasonState: seasonRequestState,
    retouchTitle: () => touchTitle(),
    retouchSeason: () => touchTitle({ season }),
  });

  const suggestions =
    useQuery(
      api.library.listTagSuggestions,
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
  const overview = meta.overview?.trim();
  const availableSeasons = [...meta.seasons].sort((left, right) => left.season - right.season);
  const visibleEpisodes = loadedSeason === season ? episodes : [];
  const averageRuntime =
    detail?.runtime ??
    (detail?.episodeRunTime?.length
      ? detail.episodeRunTime.reduce((sum, value) => sum + value, 0) / detail.episodeRunTime.length
      : undefined);
  const initialEntry: LibraryEntryDraft = {
    status: 'watchlist',
    rating: undefined,
    timesWatched: 0,
    tags: [],
  };

  const saveEntry = async (draft: LibraryEntryDraft) => {
    if (!mediaType || !validId || entrySaving || !meta.title.trim()) return;
    setEntrySaving(true);
    try {
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
          ? await addItemAndMarkWatched(addArgs)
          : await addItem(addArgs);
      setEntryOpen(false);
      toast.show(`${meta.title} added`);
      router.replace(`/item/${itemId}`);
    } catch {
      toast.show('Couldn’t add this title');
    }
    setEntrySaving(false);
  };

  const renderEpisode = ({ item: episode }: { item: Episode }) => {
    const episodeKey = `${episode.season}:${episode.episode}`;
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
                <Text style={s.episodeImageNumber}>
                  {episode.episode.toString().padStart(2, '0')}
                </Text>
                <SkeletonShimmer />
              </View>
            )}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View episode ${episode.episode}`}
            accessibilityState={{ expanded: expanded === episodeKey }}
            style={s.epExpand}
            onPress={() => setExpanded(expanded === episodeKey ? undefined : episodeKey)}
          >
            <View style={s.epHeader}>
              <Text style={s.epNo}>EP {episode.episode.toString().padStart(2, '0')}</Text>
              {!!episode.runtime && <Text style={s.epTime}>{episode.runtime} min</Text>}
            </View>
            <Text numberOfLines={2} style={s.epName}>
              {episode.name}
            </Text>
            {!!episode.overview && expanded !== episodeKey && (
              <Text numberOfLines={2} style={s.epOverview}>
                {episode.overview}
              </Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Add title to track episode ${episode.episode}`}
            onPress={() => setEntryOpen(true)}
            hitSlop={8}
            style={s.check}
          >
            <Text style={{ color: colors.muted }}>+</Text>
          </Pressable>
        </View>
        {expanded === episodeKey && (
          <View style={s.epDetails}>
            {!!episode.overview && <Text style={s.epFullOverview}>{episode.overview}</Text>}
            {!!episode.airDate && <Text style={s.episodeDate}>Aired {episode.airDate}</Text>}
            <Text style={s.episodeHint}>
              Add this title to rate, tag, or mark individual episodes watched.
            </Text>
            <Button title="Add Entry" variant="outline" onPress={() => setEntryOpen(true)} />
          </View>
        )}
      </View>
    );
  };

  if (existing) return <Redirect href={`/item/${existing._id}`} />;

  if (!mediaType || !validId)
    return (
      <View style={s.root}>
        <SecondaryHeader
          title="Details"
          maxWidth={760}
          backLabel="Back to explore"
          fallback="/explore"
        />
        <View style={s.state}>
          <EmptyState title="Title not found" detail="This title link is invalid." />
        </View>
      </View>
    );

  if (failed && !hero)
    return (
      <View style={s.root}>
        <SecondaryHeader
          title="Details"
          maxWidth={760}
          backLabel="Back to explore"
          fallback="/explore"
        />
        <View style={s.state}>
          <View style={s.inlineError}>
            <Text style={s.errorText}>Title details couldn’t be loaded.</Text>
            <Button title="Retry" variant="ghost" onPress={() => touchTitle({ force: true })} />
          </View>
        </View>
      </View>
    );

  if (titleView === undefined || heroOwner === undefined)
    return (
      <View testID="title-detail-initial-placeholder" style={s.root}>
        <View style={s.initialPlaceholder}>
          <SkeletonShimmer />
        </View>
      </View>
    );

  return (
    <View style={s.root}>
      <SecondaryHeader
        title="Details"
        maxWidth={760}
        backLabel="Back to explore"
        fallback="/explore"
      />
      <FlatList
        testID="episode-list"
        data={mediaType === 'tv' ? visibleEpisodes : []}
        keyExtractor={(episode) => `${episode.season}:${episode.episode}`}
        initialNumToRender={SEASON_EPISODE_RENDER_BATCH}
        maxToRenderPerBatch={SEASON_EPISODE_RENDER_BATCH}
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() =>
              touchTitle(mediaType === 'tv' ? { season, force: true } : { force: true })
            }
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
                    meta.genres.map((genre) => <Chip key={genre} label={genre} />)
                  ) : (
                    <MetadataPlaceholder label="Loading genres" kind="chip" />
                  )}
                </View>
              </View>
            </View>
            {overview ? (
              <Text testID="title-detail-overview" style={s.overview}>
                {overview}
              </Text>
            ) : null}

            <View style={s.facts}>
              {detail ? (
                <>
                  <View style={s.fact}>
                    <Text style={s.factLabel}>Runtime</Text>
                    <Text style={s.factValue}>
                      {averageRuntime === undefined ? '—' : `${Math.round(averageRuntime)} min`}
                    </Text>
                  </View>
                  <View style={s.fact}>
                    <Text style={s.factLabel}>Rating</Text>
                    <Text style={s.factValue}>
                      {detail.voteAverage === undefined ? '—' : detail.voteAverage.toFixed(1)}
                    </Text>
                  </View>
                </>
              ) : (
                <>
                  <MetadataPlaceholder label="Loading runtime" kind="stat" />
                  <MetadataPlaceholder label="Loading rating" kind="stat" />
                </>
              )}
            </View>

            {loading && heroOwner !== 'preview' && <TitleSkeleton />}
            {failed && (
              <View style={s.inlineError}>
                <Text style={s.errorText}>Title details couldn’t be loaded.</Text>
                <Button title="Retry" variant="ghost" onPress={() => touchTitle({ force: true })} />
              </View>
            )}
            {(titleView?.requestState?.state === 'failed' || touchError !== undefined) &&
              detail && <Text style={s.metadataLoadingText}>couldn’t update — pull to retry</Text>}

            <Text style={s.section}>Your Entry</Text>
            <View style={s.entry}>
              <Text style={s.noEntry}>This title isn’t in your library yet.</Text>
              <Button
                title="Add Entry"
                variant="outline"
                disabled={existing === undefined || loading || !meta.title.trim()}
                onPress={() => setEntryOpen(true)}
              />
            </View>

            {!detail ? (
              <>
                <Text style={s.section}>Cast</Text>
                <View style={s.castPlaceholders}>
                  <MetadataPlaceholder label="Loading cast" kind="cast" />
                  <MetadataPlaceholder label="Loading more cast" kind="cast" />
                </View>
              </>
            ) : meta.cast.length > 0 ? (
              <>
                <Text style={s.section}>Cast</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {meta.cast.map((member) => (
                    <View key={`${member.name}-${member.character}`} style={s.cast}>
                      <PosterImage
                        path={member.profilePath}
                        title={member.name}
                        style={s.castImage}
                      />
                      <Text numberOfLines={1} style={s.castName}>
                        {member.name}
                      </Text>
                      <Text numberOfLines={1} style={s.castRole}>
                        {member.character}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              </>
            ) : null}

            {mediaType === 'tv' && (
              <>
                <Text style={s.section}>Episodes</Text>
                {!detail ? (
                  <View style={s.episodePlaceholders}>
                    <MetadataPlaceholder label="Loading seasons" kind="stat" />
                    <MetadataPlaceholder label="Loading episodes" kind="episodes" />
                  </View>
                ) : availableSeasons.length ? (
                  <>
                    <SeasonPicker
                      open={seasonMenuOpen}
                      value={season}
                      options={availableSeasons}
                      onOpenChange={setSeasonMenuOpen}
                      onChange={setSeason}
                    />
                    <View style={s.seasonAction}>
                      <View style={{ flex: 1 }}>
                        {loadedSeason !== season && (
                          <View style={s.seasonProgressSkeleton}>
                            <SkeletonShimmer />
                          </View>
                        )}
                      </View>
                      <Button
                        title="Add to track"
                        variant="outline"
                        onPress={() => setEntryOpen(true)}
                      />
                    </View>
                    {(seasonLoading || loadedSeason !== season) && !seasonError && (
                      <EpisodeSkeletonRows />
                    )}
                    {seasonError && (
                      <View style={s.inlineError}>
                        <Text style={s.errorText}>Episodes couldn’t be loaded.</Text>
                        <Button
                          title="Retry"
                          variant="ghost"
                          onPress={() => touchTitle({ season, force: true })}
                        />
                      </View>
                    )}
                    {seasonRequestState?.state === 'failed' && seasonRow && (
                      <Text style={s.metadataLoadingText}>couldn’t update — pull to retry</Text>
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
            {detail?.metadataProvider === 'tvdb' && (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Season and episode metadata provided by TheTVDB; artwork provided by TMDB where available"
                onPress={() => void Linking.openURL('https://thetvdb.com')}
              >
                <Text style={s.tvdbAttribution}>
                  Season and episode metadata by TheTVDB · artwork by TMDB where available
                </Text>
              </Pressable>
            )}
          </>
        }
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
      />
    </View>
  );
}

const s = createStyles({
  root: { flex: 1, backgroundColor: colors.bg },
  initialPlaceholder: {
    position: 'relative',
    overflow: 'hidden',
    width: 20,
    height: 3,
    marginTop: 20,
    alignSelf: 'center',
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  content: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 96,
    paddingBottom: 70,
  },
  state: {
    flex: 1,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    padding: 20,
    paddingTop: 96,
  },
  hero: { flexDirection: 'row', gap: 18 },
  poster: { width: 122, height: 183 },
  heroCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 27, fontWeight: '800', lineHeight: 31 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 8 },
  genres: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  overview: { color: colors.muted, fontSize: 14, lineHeight: 22, marginTop: 22 },
  facts: { flexDirection: 'row', gap: 12, marginTop: 22 },
  fact: {
    minWidth: 96,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
  },
  factLabel: { color: colors.muted, fontSize: 9, textTransform: 'uppercase' },
  factValue: { color: colors.text, fontSize: 13, fontWeight: '600', marginTop: 5 },
  placeholder: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  chipPlaceholder: { width: 78, height: 32, borderRadius: 16 },
  statPlaceholder: { width: 96, height: 48, borderRadius: 10 },
  castPlaceholder: { width: 72, height: 96, borderRadius: 10, marginRight: 12 },
  episodesPlaceholder: { width: '100%', height: 92, borderRadius: 14 },
  castPlaceholders: { flexDirection: 'row' },
  episodePlaceholders: { gap: 14 },
  section: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingBottom: 11,
    marginTop: 34,
    marginBottom: 16,
  },
  entry: { gap: 16 },
  noEntry: { color: colors.muted, fontSize: 13 },
  cast: { width: 82, marginRight: 12 },
  castImage: { width: 72, height: 96 },
  castName: { color: colors.text, fontSize: 11, fontWeight: '600', marginTop: 7 },
  castRole: { color: colors.muted, fontSize: 10, marginTop: 3 },
  metadataLoading: {
    minHeight: 92,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  metadataLoadingText: { color: colors.muted, fontSize: 12 },
  titleSkeleton: {
    position: 'relative',
    overflow: 'hidden',
    flexDirection: 'row',
    gap: 18,
    marginTop: 22,
  },
  titleSkeletonPoster: {
    width: 122,
    height: 183,
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  titleSkeletonCopy: { flex: 1, justifyContent: 'center', gap: 14 },
  skeletonLineTitle: { width: '84%', height: 22, borderRadius: 8, backgroundColor: colors.surface },
  skeletonLineShort: { width: '22%', height: 8, borderRadius: 4, backgroundColor: colors.surface },
  skeletonLine: { width: '72%', height: 12, borderRadius: 6, backgroundColor: colors.surface },
  skeletonLineLong: { width: '92%', height: 8, borderRadius: 4, backgroundColor: colors.surface },
  seasonProgressSkeleton: {
    position: 'relative',
    overflow: 'hidden',
    width: 104,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.surface,
  },
  inlineError: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12 },
  errorText: { color: colors.muted, fontSize: 12, flex: 1 },
  episode: { borderBottomWidth: 1, borderColor: colors.border, paddingVertical: 14 },
  epRow: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 12 },
  episodeArtwork: {
    width: 112,
    height: 64,
    overflow: 'hidden',
    borderRadius: 10,
    backgroundColor: colors.surface,
  },
  episodeImage: { width: 112, height: 64 },
  episodeImageFallback: {
    position: 'relative',
    overflow: 'hidden',
    width: 112,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
  },
  episodeImageNumber: {
    color: colors.border,
    fontSize: 26,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  epExpand: { flex: 1, minHeight: 64, justifyContent: 'center' },
  epHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  epNo: { color: colors.accent, fontVariant: ['tabular-nums'], fontSize: 9, fontWeight: '700' },
  epName: { color: colors.text, fontSize: 14, fontWeight: '600', lineHeight: 18 },
  epOverview: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 4 },
  epTime: { color: colors.muted, fontSize: 9 },
  check: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  epDetails: {
    backgroundColor: colors.surface,
    padding: 16,
    gap: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  epFullOverview: { color: colors.text, fontSize: 13, lineHeight: 20 },
  episodeDate: { color: colors.text, fontSize: 12, fontWeight: '600' },
  episodeHint: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  episodeLoading: { marginVertical: 24 },
  seasonAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 8,
  },
  seasonProgress: { color: colors.muted, fontSize: 11 },
  tvdbAttribution: {
    color: colors.muted,
    fontSize: 10,
    textAlign: 'center',
    marginTop: 18,
    textDecorationLine: 'underline',
  },
});
