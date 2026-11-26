import { CastSection } from '@/features/title/components/CastSection';
import Pencil from 'lucide-react-native/icons/pencil';
import { ExpandableOverview } from '@/components/ExpandableOverview';
import { usePendingTasks } from '@/hooks/use-pending-tasks';
import { useTaskState } from '@/hooks/use-task-state';
import { castForDisplay } from '@marker/shared/castPresentation';
import { ConfirmDialog, RemoveTitleDialog } from '@/components/RemoveTitleDialog';
import { ScreenView } from '@/components/ScreenLayout';
import * as Effect from 'effect/Effect';
import { saveLibrary } from '@marker/shared/clientEffects';
import { useOperation } from '@/hooks/use-operation';
import { useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '@marker/shared/api';
import type { Id } from '@marker/shared/dataModel';
import { Button, EmptyState } from '@/components/ui/primitives';
import { TagList } from '@/components/ui/TagList';
import { PosterImage } from '@/components/ui/PosterImage';
import { useToast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { ScreenErrorBoundary } from '@/components/ScreenErrorBoundary';
import { EpisodeSkeletonRows } from '@/components/EpisodeSkeletonRows';
import { LibraryEntryDrawer, type LibraryEntryDraft } from '@/components/LibraryEntryDrawer';
import { SecondaryHeader } from '@/components/BackButton';
import { DetailPageSkeleton } from '@/components/PageSkeletons';
import { SeasonPicker } from '@/components/SeasonPicker';
import { availableSeasons as getAvailableSeasons } from '@/features/title/seasons';
import { SeasonProgress } from '@/features/title/components/SeasonProgress';
import { SectionHeader } from '@/features/title/components/SectionHeader';
import {
  EntryActionBar,
  useEntryActionBarLayout,
} from '@/features/title/components/EntryActionBar';
import { useTitleView } from '@/hooks/use-title-view';
import { useRefreshControl } from '@/hooks/use-refresh-control';
import { localDateKey, useLocalToday } from '@/hooks/use-local-today';
import { SEASON_EPISODE_RENDER_BATCH, useSeasonView } from '@/hooks/use-season-view';
import { libraryItemScreenStyles as s } from '@/features/title/screens/LibraryItemScreen.styles';
import { isAlsoWatching, LIBRARY_STATUSES } from '@/lib/libraryFilters';
import { EpisodeCard } from '@/features/title/components/EpisodeCard';
import { useScrolledPast } from '@/hooks/use-scrolled-past';
import {
  type Episode,
  type EpisodeDraft,
  isStaleSeasonError,
  type SeasonRow,
} from '@/features/title/libraryItemTypes';
import { clipSynopsis, displayGenres } from '@/lib/text';
type PendingEpisodeDraft = {
  [Field in keyof EpisodeDraft]?: { version: number; value: EpisodeDraft[Field] };
};

export default function ItemDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const itemId = id as Id<'items'>;
  return (
    <ScreenErrorBoundary message="Couldn’t load this item.">
      <ItemDetailRoute key={itemId} itemId={itemId} />
    </ScreenErrorBoundary>
  );
}
/** Show saved title metadata and controls for managing library watch progress. */
function ItemDetailRoute({ itemId }: { itemId: Id<'items'> }) {
  const runOperation = useOperation();
  const [selectedSeason, setSeason] = useState(1);
  const episodeApi = api.library.episodes;
  const {
    item,
    title,
    loading: itemViewLoading,
    season,
    titleRequestState,
    seasonRequestState,
    touchError,
    refresh,
  } = useTitleView({ itemId, season: selectedSeason });
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
  const [editingEpisode, setEditingEpisode] = useState<string>();
  const metadataRefresh = useRefreshControl(() => refresh({ force: true }));
  const entryBar = useEntryActionBarLayout();
  const [pendingEpisodes, setPendingEpisodes] = usePendingTasks();
  const { pending: removePending, setPending: setRemovePending } = useTaskState();
  const [removeError, setRemoveError] = useState<string>();
  const [removeOpen, setRemoveOpen] = useState(false);
  const [entryOpen, setEntryOpen] = useState(false);
  // "Also in Watching" is chosen by hand only when the automatic setting is off.
  const settings = useQuery(api.settings.getSettings);
  const today = useLocalToday();
  const seasonUpcoming = useQuery(
    episodeApi.getSeasonUpcoming,
    item?.mediaType === 'tv' ? { itemId, season, today } : 'skip',
  );
  const [unsavedEntry, setUnsavedEntry] = useState<LibraryEntryDraft>();
  const [tagPrefix, setTagPrefix] = useState('');
  const [seasonMenuOpen, setSeasonMenuOpen] = useState(false);
  const [seasonUnwatchOpen, setSeasonUnwatchOpen] = useState(false);
  const { pending: entrySaving, setPending: setEntrySaving } = useTaskState();
  const { pending: seasonPending, setPending: setSeasonPending } = useTaskState();
  const draft = item;
  const [episodeDrafts, setEpisodeDrafts] = useState<Record<string, PendingEpisodeDraft>>({});
  // The header names the title once the poster and title scroll out of view.
  const { past: heroHidden, onScroll: onListScroll } = useScrolledPast(200);
  // IDs are allocated only in event handlers and never reused after acknowledgment.
  const nextEditVersion = useRef(0);
  const detail = title;
  const returnedSeasonRow = seasonView.season;
  const seasonRow = returnedSeasonRow?.season === season ? returnedSeasonRow : undefined;
  const episodes = seasonRow ? seasonView.episodes : [];
  const titleUpdateFailed = titleRequestState?.state === 'failed' || touchError !== undefined;
  const detailsLoading = !title && !titleUpdateFailed;
  const detailsError = !title && titleUpdateFailed;
  const seasonError =
    !seasonRow &&
    (seasonRequestState?.state === 'failed' ||
      seasonRequestState?.state === 'notFound' ||
      !!touchError);
  const canLoadMore =
    seasonView.status === 'CanLoadMore' &&
    seasonRow !== undefined &&
    episodes.length < seasonRow.totalCount;
  const tagQuery = useQuery(
    api.library.items.listTagSuggestions,
    entryOpen ? { prefix: tagPrefix.trim() || undefined } : 'skip',
  );
  const tags = tagQuery ?? [];
  // Tags already used on this show's episodes, suggested in the episode sheet (undefined
  // until the saved episodes load).
  const episodeTagSuggestions = useMemo(
    () =>
      savedEpisodes &&
      [
        ...new Map(
          savedEpisodes
            .flatMap((episode) => episode.tags)
            .map((tag) => [tag.toLocaleLowerCase(), tag] as const),
        ).values(),
      ].sort((left, right) => left.localeCompare(right)),
    [savedEpisodes],
  );
  const savedByEpisode = useMemo(
    () =>
      new Map(
        savedEpisodes?.map((episode) => [`${episode.season}:${episode.episode}`, episode]) ?? [],
      ),
    [savedEpisodes],
  );
  if (itemViewLoading)
    return (
      <ScreenView style={s.root}>
        <SecondaryHeader title="Details" maxWidth={760} />
        <DetailPageSkeleton />
      </ScreenView>
    );
  if (!item)
    return (
      <ScreenView style={s.root}>
        <SecondaryHeader title="Details" maxWidth={760} />
        <View style={s.state}>
          <EmptyState title="Title not found" />
        </View>
      </ScreenView>
    );
  const performRemoval = async () => {
    if (removePending) return;
    setRemoveError(undefined);
    setRemovePending(true);
    await runOperation.write(
      Effect.gen(function* () {
        yield* saveLibrary(() => remove({ itemId }));
      }),
      {
        success: () => {
          router.replace('/(tabs)');
        },

        failure: () => {
          setRemoveError('Couldn’t remove this title. Please try again.');
        },
        settled: () => {
          setRemovePending(false);
        },
      },
    );
  };
  const requestRemoval = () => {
    if (removePending) return;
    setRemoveError(undefined);
    setRemoveOpen(true);
  };
  const patchEpisode = (
    seasonNumber: number,
    episode: number,
    field: keyof EpisodeDraft,
    value: number | undefined | string[],
  ) => {
    const draftKey = `${seasonNumber}:${episode}`;
    const version = ++nextEditVersion.current;
    setEpisodeDrafts((current) => ({
      ...current,
      [draftKey]: { ...current[draftKey], [field]: { version, value } },
    }));
    const releaseDraft = () => {
      setEpisodeDrafts((current) => {
        if (current[draftKey]?.[field]?.version !== version) return current;
        const remaining = { ...current[draftKey] };
        delete remaining[field];
        const drafts = { ...current };
        if (remaining.rating || remaining.tags || remaining.timesWatched)
          drafts[draftKey] = remaining;
        else delete drafts[draftKey];
        return drafts;
      });
    };
    const args =
      field === 'rating'
        ? value === undefined
          ? { clearRating: true }
          : { rating: value as number }
        : field === 'timesWatched'
          ? { timesWatched: value as number }
          : { tags: value as string[] };
    void runOperation.write(
      saveLibrary(() => setEpisode({ itemId, season: seasonNumber, episode, ...args })),
      {
        // Convex resolves mutations after subscribed queries reflect the write.
        // Equal snapshots alone cannot acknowledge a newer, still-pending edit.
        success: releaseDraft,
        failure: () => {
          releaseDraft();
          toast.show('Couldn’t update this episode');
        },
      },
    );
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
  const visibleCast = castForDisplay(meta.cast ?? [], meta.genres);
  const overview = meta.overview?.trim();
  const availableSeasons = getAvailableSeasons(meta.seasons);
  const setSeasonState = async (
    seasonNumber: number,
    watched: boolean,
    identity: Pick<SeasonRow, 'metadataProvider' | 'orderEpoch'>,
  ) => {
    await setSeasonWatched({
      activityDate: localDateKey(),
      itemId,
      season: seasonNumber,
      watched,
      orderEpoch: identity.orderEpoch,
      metadataProvider: identity.metadataProvider,
    });
  };
  const saveEntry = async (entryForm: LibraryEntryDraft) => {
    if (entrySaving) return;
    setEntrySaving(true);
    // Only a show newly marked Watched needs the whole-series action. Running it for an
    // already-watched show would move it to the top of the ranking on every edit.
    const becameWatchedShow =
      item.mediaType === 'tv' && entryForm.status === 'watched' && item.status !== 'watched';
    // The two writes can't be one transaction (marking a series runs as its own action),
    // so remember whether the first landed to say exactly what still needs saving.
    let markedWatched = false;
    await runOperation.write(
      Effect.gen(function* () {
        if (becameWatchedShow) {
          yield* saveLibrary(() =>
            moveItemToWatched({
              itemId,
              activityDate: localDateKey(),
            }),
          );
          markedWatched = true;
        }
        yield* saveLibrary(() =>
          update({
            itemId,
            status: becameWatchedShow ? undefined : entryForm.status,
            rating: entryForm.rating,
            clearRating: entryForm.rating === undefined,
            timesWatched: entryForm.timesWatched,
            alsoWatching:
              entryForm.status === 'watched' && item.mediaType === 'tv'
                ? !!entryForm.alsoWatching
                : undefined,
            tags: entryForm.tags,
          }),
        );
      }),
      {
        success: () => {
          setUnsavedEntry(undefined);
          setEntryOpen(false);
          toast.show('Entry updated');
        },

        failure: () => {
          // Bring the changes back so nothing typed is lost; closing tries again.
          setUnsavedEntry(entryForm);
          setEntryOpen(true);
          toast.show(
            markedWatched
              ? 'Marked as watched, but your rating, tags and count didn’t save. Try again.'
              : 'Couldn’t save your changes. Try again.',
          );
        },
        settled: () => {
          setEntrySaving(false);
        },
      },
    );
  };
  const watchedSeasonCount =
    episodeProgress?.find((summary) => summary.season === season)?.currentWatchedCount ?? 0;
  const seasonFullyWatched =
    (seasonRow?.totalCount ?? 0) > 0 && watchedSeasonCount >= (seasonRow?.totalCount ?? 0);
  const toggle = (ep: Episode) => {
    const episodeKey = `${ep.season}:${ep.episode}`;
    // Without the saved state a tap could set the opposite of what was meant.
    if (savedEpisodes === undefined || pendingEpisodes.has(episodeKey)) return;
    const old = savedByEpisode.get(episodeKey);
    setPendingEpisodes((current) => new Set(current).add(episodeKey));
    return runOperation.write(
      saveLibrary(() =>
        setEpisode({
          itemId,
          season: ep.season,
          episode: ep.episode,
          watched: !old?.watched,
          ...(!old?.watched && { activityDate: localDateKey() }),
          seasonName:
            availableSeasons.find((entry) => entry.season === ep.season)?.name ??
            (ep.season === 0 ? 'Specials' : `Season ${ep.season}`),
          name: ep.name,
          ...(ep.overview !== undefined && { overview: clipSynopsis(ep.overview) }),
          ...(ep.runtime !== undefined && { runtime: ep.runtime }),
          ...(ep.imageUrl !== undefined && { imageUrl: ep.imageUrl }),
          ...(ep.airDate !== undefined && { airDate: ep.airDate }),
        }),
      ),
      {
        settled: () => {
          setPendingEpisodes((current) => {
            const next = new Set(current);
            next.delete(episodeKey);
            return next;
          });
        },
        failure: () => toast.show('Couldn’t update this episode'),
      },
    );
  };
  // A season with listed episodes still to air: marking it covers the aired ones. Once those
  // are all watched it counts as done for the action (offering "unwatched"), and with none
  // aired yet there is nothing to mark. Counted over the whole season, not the loaded pages.
  const upcomingCount = seasonUpcoming?.upcoming ?? 0;
  const airedCount = (seasonRow?.totalCount ?? 0) - upcomingCount;
  const seasonOngoing = upcomingCount > 0;
  const seasonNothingAired = seasonOngoing && airedCount <= 0;
  const seasonCaughtUp =
    seasonOngoing &&
    airedCount > 0 &&
    watchedSeasonCount - (seasonUpcoming?.watchedUpcoming ?? 0) >= airedCount;
  const seasonDone = seasonFullyWatched || seasonCaughtUp;
  const applySeasonWatched = (watched: boolean) => {
    if (!seasonRow) return;
    setSeasonPending(true);
    void runOperation.write(
      saveLibrary(() => setSeasonState(season, watched, seasonRow)),
      {
        settled: () => {
          setSeasonPending(false);
          setSeasonUnwatchOpen(false);
        },
        failure: ({ cause: error }: { cause: unknown }) => {
          if (isStaleSeasonError(error)) {
            toast.show('Season data changed — refreshing');
            refresh({ force: true });
          } else toast.show('Couldn’t update this season');
        },
        success: () =>
          toast.show(
            !watched
              ? 'Season marked unwatched'
              : seasonOngoing
                ? 'Aired episodes marked watched'
                : 'Season marked watched',
          ),
      },
    );
  };
  const renderEpisode = ({ item: episode }: { item: Episode }) => {
    const episodeKey = `${episode.season}:${episode.episode}`;
    const saved = savedByEpisode.get(episodeKey);
    const pendingDraft = episodeDrafts[episodeKey];
    const episodeDraft: EpisodeDraft = {
      rating: pendingDraft?.rating ? pendingDraft.rating.value : saved?.rating,
      tags: pendingDraft?.tags ? pendingDraft.tags.value : (saved?.tags ?? []),
      timesWatched: pendingDraft?.timesWatched
        ? pendingDraft.timesWatched.value
        : (saved?.timesWatched ?? 1),
    };
    return (
      <EpisodeCard
        episode={episode}
        saved={saved}
        draft={episodeDraft}
        editing={editingEpisode === episodeKey}
        pending={pendingEpisodes.has(episodeKey)}
        // Editing waits for the saved episode, so its tags and count start from what is saved.
        editable={savedEpisodes !== undefined}
        onEditingChange={(editing) => setEditingEpisode(editing ? episodeKey : undefined)}
        onPatch={(field, value) => patchEpisode(episode.season, episode.episode, field, value)}
        onToggle={() => void toggle(episode)}
        tagSuggestions={episodeTagSuggestions}
      />
    );
  };
  return (
    <ScreenView style={s.root}>
      <ConfirmDialog
        open={seasonUnwatchOpen}
        title="Mark season unwatched?"
        message={`${
          seasonFullyWatched
            ? seasonRow?.totalCount === 1
              ? 'The episode'
              : `All ${seasonRow?.totalCount ?? 0} episodes`
            : watchedSeasonCount === 1
              ? 'The watched episode'
              : `The ${watchedSeasonCount} watched episodes`
        } in ${
          availableSeasons.find((entry) => entry.season === season)?.name ?? `Season ${season}`
        } will be marked unwatched.`}
        confirmLabel="Mark unwatched"
        pendingLabel="Updating…"
        destructive
        pending={seasonPending}
        onCancel={() => setSeasonUnwatchOpen(false)}
        onConfirm={() => applySeasonWatched(false)}
      />
      <RemoveTitleDialog
        open={removeOpen}
        title={item.title}
        pending={removePending}
        error={removeError}
        onCancel={() => setRemoveOpen(false)}
        onConfirm={() => void performRemoval()}
      />
      <SecondaryHeader title={heroHidden ? meta.title : ''} maxWidth={760} />
      <FlatList
        testID="episode-list"
        onScroll={onListScroll}
        scrollEventThrottle={16}
        data={item.mediaType === 'tv' ? episodes : []}
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
                path={meta.posterPath}
                title={meta.title}
                style={{ width: 122, height: 183 }}
              />
              <View style={{ flex: 1 }}>
                <Text style={s.title}>{meta.title}</Text>
                <Text style={s.meta}>{(meta.releaseDate ?? meta.firstAirDate)?.slice(0, 4)}</Text>
                {meta.genres?.length ? (
                  <View style={s.genres}>
                    <TagList tags={displayGenres(meta.genres)} />
                  </View>
                ) : null}
              </View>
            </View>
            {overview ? (
              <ExpandableOverview key={overview} text={overview} style={s.overview} />
            ) : null}
            {detailsError && !title && (
              <View style={s.inlineError}>
                <Text style={s.errorText}>Title details couldn’t be loaded.</Text>
                <Button title="Retry" variant="ghost" onPress={() => refresh({ force: true })} />
              </View>
            )}
            {titleUpdateFailed && title && (
              <Text style={s.metadataHint}>Couldn’t update. Pull to retry.</Text>
            )}
            <SectionHeader title="Your entry" />
            {draft && (
              <View style={s.entry}>
                <View style={s.entrySummary}>
                  <View style={s.entryStat}>
                    <Text style={s.entryLabel}>Status</Text>
                    <Text style={s.entryValue}>
                      {LIBRARY_STATUSES.find(([status]) => status === draft.status)?.[1]}
                    </Text>
                    {/* Listed under Watching too, as the library shows it. */}
                    {draft.status === 'watched' &&
                      item.status === 'watched' &&
                      isAlsoWatching(item, settings?.airingInWatching !== false, today) && (
                        <Text style={s.entryNote}>Also in Watching</Text>
                      )}
                  </View>
                  <View style={s.entryStat}>
                    <Text style={s.entryLabel}>Rating</Text>
                    <Text style={[s.entryValue, draft.rating === undefined && s.entryValueEmpty]}>
                      {draft.rating === undefined ? 'Not rated' : `★ ${draft.rating.toFixed(1)}`}
                    </Text>
                  </View>
                  <View style={s.entryStat}>
                    <Text style={s.entryLabel}>Times watched</Text>
                    <Text style={s.entryValue}>{draft.timesWatched}</Text>
                  </View>
                </View>
                <View style={s.entryTags}>
                  <Text style={s.entryLabel}>Tags</Text>
                  {draft.tags.length ? (
                    <TagList tags={draft.tags} />
                  ) : (
                    <Text style={s.noTags}>No tags</Text>
                  )}
                </View>
              </View>
            )}
            {draft && (
              <LibraryEntryDrawer
                open={entryOpen}
                onOpenChange={setEntryOpen}
                mode="update"
                initial={draft}
                unsaved={unsavedEntry}
                offerAlsoWatching={item.mediaType === 'tv' && settings?.airingInWatching === false}
                suggestions={tags}
                suggestionsReady={tagQuery !== undefined}
                onTagPrefixChange={setTagPrefix}
                saving={entrySaving}
                onSubmit={saveEntry}
                watchedHint={
                  item.mediaType === 'tv'
                    ? 'Marking this show as Watched will mark all released episodes as watched.'
                    : undefined
                }
                onRemove={requestRemoval}
                removePending={removePending}
              />
            )}
            <CastSection
              members={visibleCast}
              loading={
                (!detail || titleRequestState?.state === 'inFlight') &&
                titleRequestState?.state !== 'failed' &&
                touchError === undefined
              }
            />

            {item.mediaType === 'tv' && (
              <>
                <SectionHeader title="Episodes" />
                {!detail ? (
                  detailsLoading ? (
                    <EpisodeSkeletonRows count={2} />
                  ) : (
                    <View style={s.metadataLoading}>
                      <Text style={s.metadataLoadingText}>Episode guide unavailable</Text>
                    </View>
                  )
                ) : availableSeasons.length ? (
                  <>
                    <SeasonProgress
                      picker={
                        <SeasonPicker
                          open={seasonMenuOpen}
                          value={season}
                          options={availableSeasons}
                          onOpenChange={setSeasonMenuOpen}
                          onChange={setSeason}
                        />
                      }
                      loading={!seasonRow}
                      watched={watchedSeasonCount}
                      total={seasonRow?.totalCount ?? 0}
                      complete={seasonDone}
                      ongoing={seasonOngoing}
                      nothingAired={seasonNothingAired}
                      disabled={
                        seasonPending ||
                        seasonError ||
                        !seasonRow ||
                        episodes.length === 0 ||
                        seasonNothingAired
                      }
                      // Until the counts arrive the action could offer the wrong direction.
                      ready={episodeProgress !== undefined && seasonUpcoming !== undefined}
                      onToggle={() => {
                        // Unwatching a whole season asks first; marking it watched doesn't.
                        if (seasonDone) setSeasonUnwatchOpen(true);
                        else applySeasonWatched(true);
                      }}
                    />
                    {!seasonRow && !seasonError && <EpisodeSkeletonRows />}
                    {seasonError && !seasonRow && (
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
                      <Text style={s.metadataHint}>Couldn’t update. Pull to retry.</Text>
                    )}
                  </>
                ) : (
                  <Text style={s.metadataLoadingText}>No episodes available</Text>
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
          </>
        }
      />
      {/* A second edit can't start while the last one is saving, so neither is lost. */}
      <EntryActionBar
        label={entrySaving ? 'Saving…' : 'Edit entry'}
        disabled={entrySaving}
        icon={entrySaving ? undefined : <Pencil size={18} color={colors.bg} strokeWidth={2.2} />}
        onLayout={entryBar.onLayout}
        onPress={() => setEntryOpen(true)}
      />
    </ScreenView>
  );
}
