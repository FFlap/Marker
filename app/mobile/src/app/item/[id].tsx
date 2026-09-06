import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  Pressable,
  ScrollView,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { Button, Chip, EmptyState } from '@/components/ui/primitives';
import { PosterImage } from '@/components/ui/PosterImage';
import { useToast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { ScreenErrorBoundary } from '@/components/ScreenErrorBoundary';
import { SkeletonShimmer } from '@/components/SkeletonShimmer';
import { EpisodeSkeletonRows } from '@/components/EpisodeSkeletonRows';
import { LibraryEntryDrawer } from '@/components/LibraryEntryDrawer';
import { SecondaryHeader } from '@/components/BackButton';
import { DetailPageSkeleton } from '@/components/PageSkeletons';
import { SeasonPicker } from '@/components/SeasonPicker';
import { useMetadataRecoveryTimers, useTitleView } from '@/hooks/use-title-view';
import { useRefreshControl } from '@/hooks/use-refresh-control';
import {
  SEASON_EPISODE_RENDER_BATCH,
  selectAvailableSeason,
  useSeasonView,
} from '@/hooks/use-season-view';
import { libraryItemScreenStyles as s } from '@/features/title/screens/LibraryItemScreen.styles';
import { EpisodeCard } from '@/features/title/components/EpisodeCard';
import {
  type Episode,
  type EpisodeDraft,
  isStaleSeasonError,
  type ItemDraft,
  sameValue,
  type SeasonRow,
  statusOptions,
} from '@/features/title/libraryItemTypes';
export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const itemId = id as Id<'items'>;
  return (
    <ScreenErrorBoundary message="Couldn’t load this item.">
      <ItemDetailRoute key={itemId} itemId={itemId} />
    </ScreenErrorBoundary>
  );
}
function ItemDetailRoute({ itemId }: { itemId: Id<'items'> }) {
  const [selectedSeason, setSeason] = useState(1);
  const episodeApi = api.library.episodes;
  const list = useQuery(api.library.items.listItems);
  const itemView = useQuery(api.resolvedMetadata.reads.getItemView, { itemId });
  const item = itemView?.item ?? list?.find((entry) => entry._id === itemId);
  const title = itemView?.title;
  const season = selectAvailableSeason(title?.seasons, selectedSeason);
  const setSeasonWatched = useAction(api.library.seasonWatched.setSeasonWatched);
  const moveItemToWatched = useAction(api.library.seasonWatched.moveItemToWatched);
  const update = useMutation(api.library.items.updateItem),
    remove = useMutation(api.library.items.removeItem),
    setEpisode = useMutation(episodeApi.setEpisodeState);
  const toast = useToast();
  const seasonView = useSeasonView(
    item?.mediaType === 'tv' ? { tmdbId: item.tmdbId, season } : undefined,
  );
  const savedEpisodes = useQuery(
    episodeApi.listEpisodes,
    item ? { itemId, season, pageCount: Math.max(1, seasonView.pageCount) } : 'skip',
  );
  const episodeProgress = useQuery(episodeApi.listEpisodeProgress, item ? { itemId } : 'skip');
  const seasonRequestState = useQuery(
    api.resolvedMetadata.reads.getSeasonRequestState,
    item?.mediaType === 'tv' ? { tmdbId: item.tmdbId, season } : 'skip',
  );
  const titleRequestState = useQuery(
    api.resolvedMetadata.reads.getTitleRequestState,
    item ? { mediaType: item.mediaType, tmdbId: item.tmdbId } : 'skip',
  );
  const [expanded, setExpanded] = useState<string>();
  const [editingEpisode, setEditingEpisode] = useState<string>();
  const { touchError, touchItemView } = useTitleView(undefined, itemId, titleRequestState, false);
  const metadataRefresh = useRefreshControl(() =>
    touchItemView(item?.mediaType === 'tv' ? { season, force: true } : { force: true }),
  );
  const [pendingEpisodes, setPendingEpisodes] = useState<Set<string>>(() => new Set());
  const [removePending, setRemovePending] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  const [seasonMenuOpen, setSeasonMenuOpen] = useState(false);
  const [entrySaving, setEntrySaving] = useState(false);
  const [seasonPending, setSeasonPending] = useState(false);
  const draft = item;
  const [episodeDrafts, setEpisodeDrafts] = useState<Record<string, EpisodeDraft>>({});
  const fieldVersions = useRef(new Map<string, number>());
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
  const itemMediaType = item?.mediaType;
  useEffect(() => {
    if (!itemMediaType) return;
    touchItemView(itemMediaType === 'tv' ? { season } : undefined);
  }, [itemMediaType, itemId, season, touchItemView]);
  const detail = title;
  const returnedSeasonRow = seasonView.season;
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
  if (!item && (itemView === undefined || list === undefined))
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
        status:
          item.mediaType !== 'tv' || entryForm.status !== 'watched' ? entryForm.status : undefined,
        rating: entryForm.rating,
        clearRating: entryForm.rating === undefined,
        timesWatched: entryForm.timesWatched,
        tags: entryForm.tags,
      });
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
  const renderEpisode = ({ item: episode }: { item: Episode }) => {
    const episodeKey = `${episode.season}:${episode.episode}`;
    const saved = savedByEpisode.get(episodeKey);
    const episodeDraft = episodeDrafts[episodeKey] ?? {
      rating: saved?.rating,
      tags: saved?.tags ?? [],
    };
    return (
      <EpisodeCard
        episode={episode}
        saved={saved}
        draft={episodeDraft}
        expanded={expanded === episodeKey}
        editing={editingEpisode === episodeKey}
        pending={pendingEpisodes.has(episodeKey)}
        onExpand={() => setExpanded(expanded === episodeKey ? undefined : episodeKey)}
        onEditingChange={(editing) => setEditingEpisode(editing ? episodeKey : undefined)}
        onPatch={(field, value) => patchEpisode(episode.season, episode.episode, field, value)}
        onToggle={() => void toggle(episode)}
      />
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
            refreshing={metadataRefresh.refreshing}
            onRefresh={metadataRefresh.onRefresh}
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
