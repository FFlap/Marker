import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useAction, useMutation, useQuery } from 'convex/react';
import { EllipsisVertical } from 'lucide-react-native';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { Button, Chip, EmptyState } from '@/components/ui/primitives';
import { PosterImage } from '@/components/ui/PosterImage';
import { RatingControl, TagEditor } from '@/components/ui/library-controls';
import { useToast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { createStyles } from '@/lib/typography';
import { ScreenErrorBoundary } from '@/components/ScreenErrorBoundary';
import { SkeletonShimmer } from '@/components/SkeletonShimmer';
import { EpisodeSkeletonRows } from '@/components/EpisodeSkeletonRows';
import { LibraryEntryDrawer, type LibraryEntryDraft } from '@/components/LibraryEntryDrawer';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { SecondaryHeader } from '@/components/BackButton';
import { DetailPageSkeleton } from '@/components/PageSkeletons';
import { SeasonPicker } from '@/components/SeasonPicker';
import { useMetadataRecoveryTimers, useTitleView } from '@/hooks/use-title-view';
import {
  SEASON_EPISODE_RENDER_BATCH,
  useRouteSeason,
  useSeasonView,
} from '@/hooks/use-season-view';
const statusOptions = [
  { label: 'Watched', value: 'watched' },
  { label: 'Watching', value: 'watching' },
  { label: 'Watchlist', value: 'watchlist' },
  { label: 'Dropped', value: 'dropped' },
] as const;
type Detail = {
  tmdbId?: number;
  title: string;
  posterPath?: string;
  overview?: string;
  releaseDate?: string;
  firstAirDate?: string;
  runtime?: number;
  episodeRunTime?: number[];
  genres?: string[];
  seasons?: { season: number; name: string; episodeCount: number }[];
  cast?: { name: string; character: string; profilePath?: string }[];
  metadataProvider?: 'tmdb' | 'tvdb';
  tvdbId?: number;
  seasonOrder?: string;
  orderEpoch?: number;
};
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
type ItemDraft = LibraryEntryDraft;
type EpisodeDraft = { rating?: number; tags: string[] };

const sameValue = (left: unknown, right: unknown) =>
  Array.isArray(left) && Array.isArray(right)
    ? left.length === right.length && left.every((value, index) => value === right[index])
    : left === right;
const isStaleSeasonError = (error: unknown) => {
  const data =
    typeof error === 'object' && error !== null && 'data' in error
      ? (error as { data?: { code?: unknown } }).data
      : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return (
    data?.code === 'stale_epoch' ||
    /stale.?epoch/i.test(message) ||
    /season metadata changed/i.test(message)
  );
};
export default function ItemDetailScreen() {
  return (
    <ScreenErrorBoundary message="Couldn’t load this item.">
      <ItemDetail />
    </ScreenErrorBoundary>
  );
}
function ItemDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const itemId = id as Id<'items'>;
  return <ItemDetailRoute key={itemId} itemId={itemId} />;
}
function ItemDetailRoute({ itemId }: { itemId: Id<'items'> }) {
  const [selectedSeason, setSeason] = useRouteSeason(String(itemId));
  const list = useQuery(api.library.listItems);
  const itemView = useQuery(api.resolvedMetadata.getItemView, { itemId });
  const item = itemView?.item ?? list?.find((entry) => entry._id === itemId);
  const title = itemView?.title as Detail | null | undefined;
  const firstSeason = title?.seasons?.find((entry) => entry.season > 0)?.season ?? 1;
  const season =
    title?.seasons?.some((entry) => entry.season === selectedSeason) === false
      ? firstSeason
      : selectedSeason;
  const setSeasonWatched = useAction(api.library.setSeasonWatched);
  const moveItemToWatched = useAction(api.library.moveItemToWatched);
  const update = useMutation(api.library.updateItem),
    remove = useMutation(api.library.removeItem),
    setEpisode = useMutation(api.library.setEpisodeState);
  const toast = useToast();
  const seasonView = useSeasonView(
    item?.mediaType === 'tv' ? { tmdbId: item.tmdbId, season } : undefined,
  );
  const savedEpisodes = useQuery(
    api.library.listEpisodes,
    item ? { itemId, season, pageCount: Math.max(1, seasonView.pageCount) } : 'skip',
  );
  const episodeProgress = useQuery(api.library.listEpisodeProgress, item ? { itemId } : 'skip');
  const seasonRequestState = useQuery(
    api.resolvedMetadata.getSeasonRequestState,
    item?.mediaType === 'tv' ? { tmdbId: item.tmdbId, season } : 'skip',
  );
  const titleRequestState = useQuery(
    api.resolvedMetadata.getTitleRequestState,
    item ? { mediaType: item.mediaType, tmdbId: item.tmdbId } : 'skip',
  );
  const [expanded, setExpanded] = useState<string>();
  const [editingEpisode, setEditingEpisode] = useState<string>();
  const { touchError, touchItemView } = useTitleView(undefined, itemId, titleRequestState, false);
  const [pendingEpisodes, setPendingEpisodes] = useState<Set<string>>(() => new Set());
  const [removePending, setRemovePending] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [seasonMenuOpen, setSeasonMenuOpen] = useState(false);
  const [entrySaving, setEntrySaving] = useState(false);
  const [seasonPending, setSeasonPending] = useState(false);
  const [draft, setDraft] = useState<ItemDraft>();
  const [episodeDrafts, setEpisodeDrafts] = useState<Record<string, EpisodeDraft>>({});
  const fieldVersions = useRef(new Map<string, number>());
  useEffect(() => {
    if (!item) return;
    setDraft((current) => {
      for (const field of ['status', 'rating', 'timesWatched', 'tags'] as const) {
        const pending = fieldVersions.current.get(field);
        if (pending !== undefined && sameValue(item[field], current?.[field]))
          fieldVersions.current.delete(field);
      }
      return {
        status: fieldVersions.current.has('status')
          ? (current?.status ?? item.status)
          : item.status,
        rating: fieldVersions.current.has('rating') ? current?.rating : item.rating,
        timesWatched: fieldVersions.current.has('timesWatched')
          ? (current?.timesWatched ?? item.timesWatched)
          : item.timesWatched,
        tags: fieldVersions.current.has('tags') ? (current?.tags ?? item.tags) : item.tags,
      };
    });
  }, [item]);
  useEffect(() => {
    if (!savedEpisodes) return;
    setEpisodeDrafts((current) => {
      let next = current;
      for (const [draftKey, episodeDraft] of Object.entries(current)) {
        const [seasonNumber, episodeNumber] = draftKey.split(':').map(Number);
        const saved = savedEpisodes.find(
          (entry) => entry.season === seasonNumber && entry.episode === episodeNumber,
        );
        if (!saved) continue;
        let acknowledged = false;
        for (const field of ['rating', 'tags'] as const) {
          const key = `episode:${draftKey}:${field}`;
          if (fieldVersions.current.has(key) && sameValue(saved[field], episodeDraft[field])) {
            fieldVersions.current.delete(key);
            acknowledged = true;
          }
        }
        if (
          acknowledged &&
          !fieldVersions.current.has(`episode:${draftKey}:rating`) &&
          !fieldVersions.current.has(`episode:${draftKey}:tags`)
        ) {
          if (next === current) next = { ...current };
          delete next[draftKey];
        }
      }
      return next;
    });
  }, [savedEpisodes]);
  useEffect(() => {
    if (!item) return;
    touchItemView(item.mediaType === 'tv' ? { season } : undefined);
  }, [item, itemId, season, touchItemView]);
  const detail = title;
  const returnedSeasonRow = seasonView.season as SeasonRow | undefined;
  const seasonRow = returnedSeasonRow?.season === season ? returnedSeasonRow : undefined;
  const episodes = seasonRow ? seasonView.episodes : [];
  const loadedSeason = seasonRow?.season;
  const titleUpdateFailed = titleRequestState?.state === 'failed' || touchError !== undefined;
  const detailsLoading = !title && !titleUpdateFailed;
  const detailsError = !title && titleUpdateFailed;
  const seasonLoading =
    !seasonRow &&
    seasonView.status === 'LoadingFirstPage' &&
    seasonRequestState?.state !== 'failed' &&
    seasonRequestState?.state !== 'notFound' &&
    !touchError;
  const seasonError =
    !seasonRow &&
    (seasonRequestState?.state === 'failed' ||
      seasonRequestState?.state === 'notFound' ||
      !!touchError);
  const canLoadMore =
    seasonView.status === 'CanLoadMore' &&
    seasonRow !== undefined &&
    episodes.length < seasonRow.totalCount;
  useMetadataRecoveryTimers({
    titleKey: item ? `item:${itemId}` : undefined,
    titleState: titleRequestState,
    seasonKey: item?.mediaType === 'tv' ? `season:${item.tmdbId}:${season}` : undefined,
    seasonState: seasonRequestState,
    retouchTitle: () => touchItemView(),
    retouchSeason: () => touchItemView({ season }),
  });
  const tags = useMemo(() => (list ? [...new Set(list.flatMap((i) => i.tags))] : []), [list]);
  const savedByEpisode = useMemo(
    () =>
      new Map(
        savedEpisodes?.map((episode) => [`${episode.season}:${episode.episode}`, episode]) ?? [],
      ),
    [savedEpisodes],
  );
  if (itemView === undefined && list === undefined)
    return (
      <View style={s.root}>
        <SecondaryHeader title="Details" maxWidth={760} />
        <DetailPageSkeleton />
      </View>
    );
  if (!item)
    return (
      <View style={s.root}>
        <SecondaryHeader title="Details" maxWidth={760} />
        <View style={s.state}>
          <EmptyState title="Title not found" />
        </View>
      </View>
    );
  const performRemoval = async () => {
    if (removePending) return;
    setRemovePending(true);
    try {
      await remove({ itemId });
      router.replace('/(tabs)');
    } catch {
      toast.show('Couldn’t remove this title');
    }
    setRemovePending(false);
  };
  const requestRemoval = () => {
    if (removePending) return;
    const message = `Remove ${item.title} and its episode history?`;
    if (Platform.OS === 'web') {
      if (globalThis.confirm(message)) void performRemoval();
      return;
    }
    Alert.alert('Remove title?', message, [
      { text: 'Cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void performRemoval() },
    ]);
  };
  const patchEpisode = (
    seasonNumber: number,
    episode: number,
    field: keyof EpisodeDraft,
    value: number | undefined | string[],
  ) => {
    const saved = savedEpisodes?.find(
      (entry) => entry.season === seasonNumber && entry.episode === episode,
    );
    const draftKey = `${seasonNumber}:${episode}`;
    const savedValue = field === 'rating' ? saved?.rating : (saved?.tags ?? []);
    const key = `episode:${seasonNumber}:${episode}:${field}`;
    const version = (fieldVersions.current.get(key) ?? 0) + 1;
    fieldVersions.current.set(key, version);
    setEpisodeDrafts((current) => {
      const previous = current[draftKey] ?? { rating: saved?.rating, tags: saved?.tags ?? [] };
      return { ...current, [draftKey]: { ...previous, [field]: value } };
    });
    const args =
      field === 'rating'
        ? value === undefined
          ? { clearRating: true }
          : { rating: value as number }
        : { tags: value as string[] };
    void setEpisode({ itemId, season: seasonNumber, episode, ...args }).catch(() => {
      if (fieldVersions.current.get(key) === version) {
        fieldVersions.current.delete(key);
        setEpisodeDrafts((current) => {
          const latest = current[draftKey] ?? { rating: saved?.rating, tags: saved?.tags ?? [] };
          return { ...current, [draftKey]: { ...latest, [field]: savedValue } };
        });
      }
      toast.show('Couldn’t update this episode');
    });
  };
  const meta = {
    title: item.title,
    posterPath: item.posterPath,
    overview: item.overview,
    releaseDate: item.releaseDate,
    genres: item.genres ?? [],
    cast: [],
    ...detail,
  };
  const overview = meta.overview?.trim();
  const availableSeasons = [...(meta.seasons ?? [])].sort((a, b) => a.season - b.season);
  const setSeasonState = async (
    seasonNumber: number,
    watched: boolean,
    identity: Pick<SeasonRow, 'metadataProvider' | 'orderEpoch'>,
  ) => {
    await setSeasonWatched({
      itemId,
      season: seasonNumber,
      watched,
      orderEpoch: identity.orderEpoch,
      metadataProvider: identity.metadataProvider,
    });
  };
  const saveEntry = async (entryForm: ItemDraft) => {
    if (entrySaving) return;
    setEntrySaving(true);
    try {
      if (item.mediaType === 'tv' && entryForm.status === 'watched') {
        await moveItemToWatched({ itemId });
      }
      await update({
        itemId,
        ...(item.mediaType !== 'tv' || entryForm.status !== 'watched'
          ? { status: entryForm.status }
          : {}),
        ...(entryForm.rating === undefined ? { clearRating: true } : { rating: entryForm.rating }),
        timesWatched: entryForm.timesWatched,
        tags: entryForm.tags,
      });
      setDraft(entryForm);
      setEntryOpen(false);
      toast.show('Entry updated');
    } catch {
      toast.show('Couldn’t update this entry');
    }
    setEntrySaving(false);
  };
  const visibleEpisodes = loadedSeason === season ? episodes : [];
  const watchedSeasonCount =
    episodeProgress?.find((summary) => summary.season === season)?.currentWatchedCount ?? 0;
  const seasonFullyWatched =
    (seasonRow?.totalCount ?? 0) > 0 && watchedSeasonCount >= (seasonRow?.totalCount ?? 0);
  const toggle = (ep: Episode) => {
    const episodeKey = `${ep.season}:${ep.episode}`;
    if (pendingEpisodes.has(episodeKey)) return;
    const old = savedByEpisode.get(episodeKey);
    setPendingEpisodes((current) => new Set(current).add(episodeKey));
    return setEpisode({
      itemId,
      season: ep.season,
      episode: ep.episode,
      watched: !old?.watched,
      seasonName:
        availableSeasons.find((entry) => entry.season === ep.season)?.name ??
        (ep.season === 0 ? 'Specials' : `Season ${ep.season}`),
      name: ep.name,
      ...(ep.overview !== undefined && { overview: ep.overview }),
      ...(ep.runtime !== undefined && { runtime: ep.runtime }),
      ...(ep.imageUrl !== undefined && { imageUrl: ep.imageUrl }),
      ...(ep.airDate !== undefined && { airDate: ep.airDate }),
    })
      .catch(() => toast.show('Couldn’t update this episode'))
      .finally(() => {
        setPendingEpisodes((current) => {
          const next = new Set(current);
          next.delete(episodeKey);
          return next;
        });
      });
  };
  const renderEpisode = ({ item: ep }: { item: Episode }) => {
    const episodeKey = `${ep.season}:${ep.episode}`;
    const saved = savedByEpisode.get(episodeKey);
    const episodeDraft = episodeDrafts[episodeKey] ?? {
      rating: saved?.rating,
      tags: saved?.tags ?? [],
    };
    return (
      <View style={s.episode}>
        <View style={s.epRow}>
          <View style={s.episodeArtwork}>
            {ep.imageUrl ? (
              <Image
                source={ep.imageUrl}
                accessibilityLabel={`Episode ${ep.episode} artwork`}
                contentFit="cover"
                transition={150}
                recyclingKey={episodeKey}
                style={s.episodeImage}
              />
            ) : (
              <View style={s.episodeImageFallback}>
                <Text style={s.episodeImageNumber}>{ep.episode.toString().padStart(2, '0')}</Text>
                <SkeletonShimmer />
              </View>
            )}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View episode ${ep.episode}`}
            style={s.epExpand}
            onPress={() => setExpanded(expanded === episodeKey ? undefined : episodeKey)}
          >
            <View style={s.epHeader}>
              <Text style={s.epNo}>EP {ep.episode.toString().padStart(2, '0')}</Text>
              {!!ep.runtime && <Text style={s.epTime}>{ep.runtime} min</Text>}
            </View>
            <Text numberOfLines={2} style={s.epName}>
              {ep.name}
            </Text>
            {!!ep.overview && expanded !== episodeKey && (
              <Text numberOfLines={2} style={s.epOverview}>
                {ep.overview}
              </Text>
            )}
          </Pressable>
          <View style={s.epActions}>
            <Pressable
              accessibilityRole={saved?.watched ? 'button' : 'checkbox'}
              accessibilityLabel={
                saved?.watched
                  ? `Episode ${ep.episode} options`
                  : `Mark episode ${ep.episode} watched`
              }
              accessibilityState={
                saved?.watched
                  ? undefined
                  : { checked: false, disabled: pendingEpisodes.has(episodeKey) }
              }
              disabled={pendingEpisodes.has(episodeKey)}
              hitSlop={8}
              onPress={() => {
                setEditingEpisode(episodeKey);
                if (!saved?.watched) void toggle(ep);
              }}
              style={saved?.watched ? s.episodeOptionsButton : s.check}
            >
              {saved?.watched ? (
                <EllipsisVertical size={14} color={colors.muted} strokeWidth={1.8} />
              ) : (
                <Text style={{ color: colors.muted }}>✓</Text>
              )}
            </Pressable>
          </View>
        </View>
        {expanded === episodeKey && (
          <View style={s.epDetails}>
            {!!ep.overview && <Text style={s.epFullOverview}>{ep.overview}</Text>}
            {!!ep.airDate && <Text style={s.epFact}>Aired {ep.airDate}</Text>}
          </View>
        )}
        <Drawer
          open={editingEpisode === episodeKey}
          onOpenChange={(open) => !open && setEditingEpisode(undefined)}
        >
          {editingEpisode === episodeKey && (
            <DrawerContent className="max-w-lg gap-6 rounded-2xl border-border bg-background p-6">
              <DrawerHeader>
                <DrawerTitle>Edit episode {ep.episode}</DrawerTitle>
              </DrawerHeader>
              <View style={s.episodeEditorContent}>
                <RatingControl
                  value={episodeDraft.rating}
                  onChange={(rating) => patchEpisode(ep.season, ep.episode, 'rating', rating)}
                />
                <TagEditor
                  tags={episodeDraft.tags}
                  onChange={(next) => patchEpisode(ep.season, ep.episode, 'tags', next)}
                />
                <Pressable
                  accessibilityRole="button"
                  disabled={pendingEpisodes.has(episodeKey)}
                  onPress={() => void toggle(ep)}
                  style={s.drawerTextAction}
                >
                  <Text
                    style={[
                      s.drawerTextActionLabel,
                      pendingEpisodes.has(episodeKey) && s.drawerTextActionDisabled,
                    ]}
                  >
                    {saved?.watched ? 'Mark episode unwatched' : 'Mark episode watched'}
                  </Text>
                </Pressable>
              </View>
            </DrawerContent>
          )}
        </Drawer>
      </View>
    );
  };
  return (
    <View style={s.root}>
      <SecondaryHeader title="Details" maxWidth={760} />
      <FlatList
        testID="episode-list"
        data={item.mediaType === 'tv' ? visibleEpisodes : []}
        keyExtractor={(episode) => `${episode.season}:${episode.episode}`}
        initialNumToRender={SEASON_EPISODE_RENDER_BATCH}
        maxToRenderPerBatch={SEASON_EPISODE_RENDER_BATCH}
        contentContainerStyle={s.content}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() =>
              touchItemView(item.mediaType === 'tv' ? { season, force: true } : { force: true })
            }
            tintColor={colors.accent}
          />
        }
        ListHeaderComponent={
          <>
            <View style={s.hero}>
              <PosterImage
                path={meta.posterPath}
                title={meta.title}
                style={{ width: 122, height: 183 }}
              />
              <View style={{ flex: 1 }}>
                <Text style={s.title}>{meta.title}</Text>
                <Text style={s.meta}>{(meta.releaseDate ?? meta.firstAirDate)?.slice(0, 4)}</Text>
                <View style={s.genres}>
                  {meta.genres?.map((g) => (
                    <Chip key={g} label={g} />
                  ))}
                </View>
              </View>
            </View>
            {overview ? <Text style={s.overview}>{overview}</Text> : null}
            {detailsError && !title && (
              <View style={s.inlineError}>
                <Text style={s.errorText}>Title details couldn’t be loaded.</Text>
                <Button
                  title="Retry"
                  variant="ghost"
                  onPress={() => touchItemView({ season, force: true })}
                />
              </View>
            )}
            {titleUpdateFailed && title && (
              <Text style={s.metadataHint}>couldn’t update — pull to retry</Text>
            )}
            <Text style={s.section}>Your Entry</Text>
            {draft && (
              <View style={s.entry}>
                <View style={s.entrySummary}>
                  <View>
                    <Text style={s.entryLabel}>Status</Text>
                    <Text style={s.entryValue}>
                      {statusOptions.find((option) => option.value === draft.status)?.label}
                    </Text>
                  </View>
                  <View>
                    <Text style={s.entryLabel}>Rating</Text>
                    <Text style={s.entryValue}>
                      {draft.rating === undefined ? 'Not rated' : draft.rating.toFixed(1)}
                    </Text>
                  </View>
                  <View>
                    <Text style={s.entryLabel}>Watched</Text>
                    <Text style={s.entryValue}>{draft.timesWatched}×</Text>
                  </View>
                </View>
                <View style={s.entryTags}>
                  {draft.tags.length ? (
                    draft.tags.map((tag) => <Chip key={tag} label={tag} />)
                  ) : (
                    <Text style={s.noTags}>No tags</Text>
                  )}
                </View>
                <Button title="Update Entry" variant="outline" onPress={() => setEntryOpen(true)} />
              </View>
            )}
            {draft && (
              <LibraryEntryDrawer
                open={entryOpen}
                onOpenChange={setEntryOpen}
                mode="update"
                initial={draft}
                suggestions={tags}
                saving={entrySaving}
                onSubmit={saveEntry}
                watchedHint={
                  item.mediaType === 'tv'
                    ? 'Marking this show as Watched will mark every episode as watched.'
                    : undefined
                }
                onRemove={requestRemoval}
                removePending={removePending}
              />
            )}
            {(meta.cast?.length ?? 0) > 0 && (
              <>
                <Text style={s.section}>Cast</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {meta.cast?.map((c) => (
                    <View key={`${c.name}-${c.character}`} style={s.cast}>
                      <PosterImage
                        path={c.profilePath}
                        title={c.name}
                        style={{ width: 72, height: 96 }}
                      />
                      <Text numberOfLines={1} style={s.castName}>
                        {c.name}
                      </Text>
                      <Text numberOfLines={1} style={s.castRole}>
                        {c.character}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              </>
            )}
            {item.mediaType === 'tv' && (
              <>
                <Text style={s.section}>Episodes</Text>
                {!detail ? (
                  detailsLoading ? (
                    <EpisodeSkeletonRows count={2} />
                  ) : (
                    <View style={s.metadataLoading}>
                      <Text style={s.metadataLoadingText}>Episode guide unavailable</Text>
                    </View>
                  )
                ) : (
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
                        {loadedSeason !== season ? (
                          <View style={s.seasonProgressSkeleton}>
                            <SkeletonShimmer />
                          </View>
                        ) : (
                          <Text style={s.seasonProgress}>
                            {(seasonRow?.totalCount ?? 0) > 0
                              ? `${watchedSeasonCount} of ${seasonRow?.totalCount ?? 0} watched`
                              : 'No episodes'}
                          </Text>
                        )}
                      </View>
                      <Button
                        title={seasonFullyWatched ? 'Mark unwatched' : 'Mark watched'}
                        variant="outline"
                        disabled={
                          seasonPending ||
                          seasonLoading ||
                          seasonError ||
                          loadedSeason !== season ||
                          visibleEpisodes.length === 0
                        }
                        onPress={() => {
                          const watched = !seasonFullyWatched;
                          setSeasonPending(true);
                          void setSeasonState(season, watched, seasonRow!)
                            .then(() =>
                              toast.show(
                                watched ? 'Season marked watched' : 'Season marked unwatched',
                              ),
                            )
                            .catch((error: unknown) => {
                              if (isStaleSeasonError(error)) {
                                toast.show('Season data changed — refreshing');
                                touchItemView({ season, force: true });
                              } else toast.show('Couldn’t update this season');
                            })
                            .finally(() => setSeasonPending(false));
                        }}
                      />
                    </View>
                    {(seasonLoading || loadedSeason !== season) && !seasonError && (
                      <EpisodeSkeletonRows />
                    )}
                    {seasonError && !seasonRow && (
                      <View style={s.inlineError}>
                        <Text style={s.errorText}>Episodes couldn’t be loaded.</Text>
                        <Button
                          title="Retry"
                          variant="ghost"
                          onPress={() => touchItemView({ season, force: true })}
                        />
                      </View>
                    )}
                    {seasonRequestState?.state === 'failed' && seasonRow && (
                      <Text style={s.metadataHint}>couldn’t update — pull to retry</Text>
                    )}
                  </>
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
                onPress={() => seasonView.loadMore(1)}
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
    </View>
  );
}
const s = createStyles({
  root: { flex: 1, backgroundColor: colors.bg },
  state: {
    flex: 1,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 96,
  },
  content: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 96,
    paddingBottom: 70,
  },
  hero: { flexDirection: 'row', gap: 18 },
  title: { color: colors.text, fontSize: 27, fontWeight: '800', lineHeight: 31 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 8 },
  genres: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  overview: { color: colors.muted, fontSize: 14, lineHeight: 22, marginTop: 22 },
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
  entrySummary: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  entryLabel: { color: colors.muted, fontSize: 10, fontWeight: '600', letterSpacing: 0.15 },
  entryValue: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 6 },
  entryTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, minHeight: 32 },
  noTags: { color: colors.muted, fontSize: 13, paddingVertical: 7 },
  cast: { width: 82, marginRight: 12 },
  castName: { color: colors.text, fontSize: 11, fontWeight: '600', marginTop: 7 },
  castRole: { color: colors.muted, fontSize: 10, marginTop: 3 },
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
  check: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  epNo: { color: colors.accent, fontVariant: ['tabular-nums'], fontSize: 9, fontWeight: '700' },
  epName: { color: colors.text, fontSize: 14, fontWeight: '600', lineHeight: 18 },
  epOverview: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 4 },
  epTime: { color: colors.muted, fontSize: 9 },
  epActions: { alignItems: 'center', justifyContent: 'center' },
  episodeOptionsButton: {
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
    gap: 10,
    borderRadius: 12,
    marginBottom: 12,
  },
  epFullOverview: { color: colors.text, fontSize: 13, lineHeight: 20 },
  epFact: { color: colors.muted, fontSize: 11 },
  episodeEditorContent: { gap: 24 },
  drawerTextAction: {
    minHeight: 44,
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  drawerTextActionLabel: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  drawerTextActionDisabled: { opacity: 0.4 },
  inlineError: {
    marginTop: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorText: { color: colors.muted, fontSize: 13, flex: 1 },
  seasonAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 8,
  },
  seasonProgress: { color: colors.muted, fontSize: 11 },
  seasonProgressSkeleton: {
    position: 'relative',
    overflow: 'hidden',
    width: 104,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.surface,
  },
  tvdbAttribution: {
    color: colors.muted,
    fontSize: 10,
    textAlign: 'center',
    marginTop: 18,
    textDecorationLine: 'underline',
  },
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
  metadataHint: { color: colors.muted, fontSize: 11, marginTop: 8 },
});
