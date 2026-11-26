import { usePendingTasks } from '@/hooks/use-pending-tasks';
import { useSharedValue } from 'react-native-reanimated';
import { ScreenView } from '@/components/ScreenLayout';
import * as Effect from 'effect/Effect';
import { saveLibrary } from '@marker/shared/clientEffects';
import { useOperation } from '@/hooks/use-operation';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { Image } from 'expo-image';
import { useMutation, useQuery } from 'convex/react';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Star from 'lucide-react-native/icons/star';
import { api } from '@marker/shared/api';
import { EpisodePageSkeleton } from '@/components/PageSkeletons';
import { NativePressable } from '@/components/ui/NativePressable';
import type { FunctionReturnType } from 'convex/server';
import { EmptyState, SectionHeading } from '@/components/ui/primitives';
import { EpisodeEditSheet } from '@/features/title/components/EpisodeEditSheet';
import { useToast } from '@/components/ui/Toast';
import { useWatchingRefresh } from '@/hooks/use-watching-refresh';
import {
  EpisodeFiltersDrawer,
  type ShowFilter,
} from '@/features/episodes/components/EpisodeFiltersDrawer';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/theme';
import { SwipePages } from '@/components/SwipePages';
import { useTabScrollMemory } from '@/hooks/use-tab-scroll-memory';
import { UnderlineTabs } from '@/components/ui/UnderlineTabs';
import { createAppStyles } from '@/lib/typography';
import { ScreenErrorBoundary } from '@/components/ScreenErrorBoundary';
import { MobileNav } from '@/components/MobileNav';
import { TabHeader } from '@/components/TabHeader';
import { localDateKey, useLocalToday } from '@/hooks/use-local-today';
import { displayEpisodeName } from '@/lib/text';

type EpisodeHubOverview = FunctionReturnType<typeof api.episodeHub.overview>;
type EpisodeHubItem =
  EpisodeHubOverview['watching'][number] | EpisodeHubOverview['favorites'][number];

type EpisodeTab = 'watching' | 'favorites';
type EpisodeFilters = {
  search: string;
  showFilter: ShowFilter;
  minimumRating: number;
  tagFilter: string;
};
const NO_FILTERS: EpisodeFilters = {
  search: '',
  showFilter: 'all',
  minimumRating: 0,
  tagFilter: 'all',
};
type EpisodeEditor = {
  savedRating?: number;
  savedTags: string[];
  savedTimes: number;
  ratingVersion: number;
  tagsVersion: number;
  timesVersion: number;
};
const EMPTY_EPISODES: EpisodeHubItem[] = [];

const EPISODE_TABS = [
  { value: 'watching', label: 'Watching' },
  { value: 'favorites', label: 'Favorites' },
] as const;

export default function EpisodesScreen() {
  return (
    <ScreenErrorBoundary message="Couldn’t load your episodes.">
      <Episodes />
    </ScreenErrorBoundary>
  );
}

function Episodes() {
  const runOperation = useOperation();
  const today = useLocalToday();
  const overview = useQuery(api.episodeHub.overview, { today });
  const setEpisode = useMutation(api.library.episodes.setEpisodeState);
  const toast = useToast();
  const refreshFailed = useCallback(() => toast.show('Couldn’t refresh your episodes'), [toast]);
  useWatchingRefresh({ enabled: true, onFailure: refreshFailed });
  const [tab, setTab] = useState<EpisodeTab>('watching');
  const tabScroll = useTabScrollMemory(tab, { topInset: CONTENT_TOP });
  const pagerPosition = useSharedValue(0);
  // Each tab keeps its own search and filters, so swiping across and back loses nothing.
  const [tabFilters, setTabFilters] = useState<Record<EpisodeTab, EpisodeFilters>>({
    watching: NO_FILTERS,
    favorites: NO_FILTERS,
  });
  const { search, showFilter, minimumRating, tagFilter } = tabFilters[tab];
  const patchFilters = (patch: Partial<EpisodeFilters>) =>
    setTabFilters((current) => ({ ...current, [tab]: { ...current[tab], ...patch } }));
  const setSearch = (value: string) => patchFilters({ search: value });
  const setShowFilter = (value: ShowFilter) => patchFilters({ showFilter: value });
  const setMinimumRating = (value: number) => patchFilters({ minimumRating: value });
  const setTagFilter = (value: string) => patchFilters({ tagFilter: value });
  const [editing, setEditing] = useState<EpisodeHubItem>();
  const [pending, setPending] = usePendingTasks();
  const episodeMutationQueues = useRef(
    new Map<string, { state: 'queued'; completion: Promise<unknown> }>(),
  );
  const [draftRating, setDraftRating] = useState<number>();
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [draftTimes, setDraftTimes] = useState(1);
  const [editingWatched, setEditingWatched] = useState(false);
  const editor = useRef<EpisodeEditor | undefined>(undefined);
  const favoriteTags = useMemo(
    () =>
      [
        ...new Map(
          (overview?.favorites ?? [])
            .flatMap((episode) => episode.tags)
            .map((tag) => [tag.toLocaleLowerCase(), tag] as const),
        ).values(),
      ].sort((left, right) => left.localeCompare(right)),
    [overview],
  );
  const filteredPages = useMemo(() => {
    const filterPage = (page: EpisodeTab) => {
      const {
        search: query,
        showFilter: shows,
        minimumRating: rating,
        tagFilter: tag,
      } = tabFilters[page];
      const needle = query.trim().toLocaleLowerCase();
      return (overview?.[page] ?? EMPTY_EPISODES).filter(
        (episode) =>
          (!needle ||
            episode.title.toLocaleLowerCase().includes(needle) ||
            episode.name.toLocaleLowerCase().includes(needle)) &&
          (shows === 'all' || (shows === 'anime' ? episode.isAnime : !episode.isAnime)) &&
          (page !== 'favorites' || (episode.rating ?? 0) >= rating) &&
          (page !== 'favorites' ||
            tag === 'all' ||
            episode.tags.some((entry) => entry.toLocaleLowerCase() === tag)),
      );
    };
    return { watching: filterPage('watching'), favorites: filterPage('favorites') };
  }, [overview, tabFilters]);
  const narrowedPage = (page: EpisodeTab) => {
    const filters = tabFilters[page];
    return (
      !!filters.search ||
      filters.showFilter !== 'all' ||
      (page === 'favorites' && (filters.minimumRating > 0 || filters.tagFilter !== 'all'))
    );
  };

  const openEpisode = (episode: EpisodeHubItem, watched = tab === 'favorites') => {
    const times = ('timesWatched' in episode ? episode.timesWatched : undefined) ?? 1;
    editor.current = {
      savedRating: episode.rating,
      savedTags: episode.tags,
      savedTimes: times,
      ratingVersion: 0,
      tagsVersion: 0,
      timesVersion: 0,
    };
    setEditing(episode);
    setEditingWatched(watched);
    setDraftRating(episode.rating);
    setDraftTags(episode.tags);
    setDraftTimes(times);
  };
  const updateEpisode = async (
    episode: EpisodeHubItem,
    patch: {
      watched?: boolean;
      timesWatched?: number;
      rating?: number;
      clearRating?: boolean;
      tags?: string[];
    },
    handlers: { success?: () => void; failure?: () => void } = {},
  ) => {
    const key = `${episode.itemId}:${episode.season}:${episode.episode}`;
    setPending((current) => new Set(current).add(key));
    const previous = episodeMutationQueues.current.get(key)?.completion ?? Promise.resolve();
    const request = runOperation.write(
      Effect.promise(() => previous.catch(() => undefined)).pipe(
        Effect.andThen(
          saveLibrary(() =>
            setEpisode({
              itemId: episode.itemId,
              season: episode.season,
              episode: episode.episode,
              ...(episode.seasonName !== undefined && { seasonName: episode.seasonName }),
              name: episode.name,
              ...(episode.overview !== undefined && { overview: episode.overview }),
              ...(episode.runtime !== undefined && { runtime: episode.runtime }),
              ...(episode.imageUrl !== undefined && { imageUrl: episode.imageUrl }),
              ...(episode.airDate !== undefined && { airDate: episode.airDate }),
              ...(patch.watched && { activityDate: localDateKey() }),
              ...patch,
            }),
          ),
        ),
      ),
      {
        success: handlers.success,
        failure: () => {
          handlers.failure?.();
          toast.show('Couldn’t update this episode');
        },
        settled: () => {
          if (episodeMutationQueues.current.get(key)?.completion === request) {
            episodeMutationQueues.current.delete(key);
            setPending((current) => {
              const next = new Set(current);
              next.delete(key);
              return next;
            });
          }
        },
      },
    );
    episodeMutationQueues.current.set(key, { state: 'queued', completion: request });
    await request;
  };

  // Ticks made while the Undo toast is showing join it, so one Undo covers them all. The
  // batch ends with that toast: dismissed, timed out, used, or replaced by another message.
  const undoBatch = useRef<EpisodeHubItem[]>([]);
  const markWatched = (episode: EpisodeHubItem) =>
    void updateEpisode(
      episode,
      { watched: true },
      {
        success: () => {
          const batch = undoBatch.current;
          batch.push(episode);
          const ticked = [...batch];
          toast.show(
            ticked.length === 1
              ? `${episode.title} · S${episode.season} E${episode.episode} marked watched`
              : `${ticked.length} episodes marked watched`,
            {
              key: 'episode-undo',
              onHide: () => {
                if (undoBatch.current === batch) undoBatch.current = [];
              },
              action: {
                label: 'Undo',
                onPress: () => {
                  for (const entry of ticked) void updateEpisode(entry, { watched: false });
                },
              },
            },
          );
        },
      },
    );

  const { height: windowHeight } = useWindowDimensions();
  const selectTab = (value: 'watching' | 'favorites') => {
    if (value === tab) return;
    setTab(value);
  };

  return (
    <ScreenView style={s.root}>
      <View style={s.toolbar}>
        <TabHeader
          current="episodes"
          maxWidth={940}
          accessibilityLabel={`Search ${tab} episodes`}
          value={search}
          onChangeText={setSearch}
          placeholder={tab === 'watching' ? 'Search next episodes' : 'Search favorites'}
          returnKeyType="search"
          trailing={
            <EpisodeFiltersDrawer
              tab={tab}
              showFilter={showFilter}
              minimumRating={minimumRating}
              tagFilter={tagFilter}
              tags={favoriteTags}
              onShowFilterChange={setShowFilter}
              onMinimumRatingChange={setMinimumRating}
              onTagFilterChange={setTagFilter}
            />
          }
        />
      </View>

      <ScrollView
        ref={tabScroll.scrollRef}
        onScroll={tabScroll.onScroll}
        onScrollBeginDrag={tabScroll.onScrollBeginDrag}
        onContentSizeChange={tabScroll.onContentSizeChange}
        onLayout={tabScroll.onViewportLayout}
        scrollEventThrottle={32}
        contentContainerStyle={s.content}
      >
        <View style={s.tabs} onLayout={tabScroll.onContentLayout}>
          <UnderlineTabs
            tabs={EPISODE_TABS}
            value={tab}
            onChange={selectTab}
            position={pagerPosition}
          />
        </View>

        <SwipePages
          onSwipeStart={tabScroll.onSwipeStart}
          gutter={20}
          position={pagerPosition}
          index={tab === 'watching' ? 0 : 1}
          onIndexChange={(index) => selectTab(index === 0 ? 'watching' : 'favorites')}
          minHeight={Math.max(360, windowHeight - 260)}
        >
          {(['watching', 'favorites'] as const).map((page) => {
            const list = filteredPages[page];
            const narrowed = narrowedPage(page);
            return (
              <View key={page} style={s.page}>
                {page === 'watching' && overview !== undefined && list.length > 0 && (
                  <SectionHeading title="Up next" count={list.length} style={s.upNext} />
                )}
                {overview === undefined ? (
                  <EpisodePageSkeleton heading={page === 'watching'} />
                ) : list.length ? (
                  <View style={s.list}>
                    {list.map((episode) => {
                      const key = `${episode.itemId}:${episode.season}:${episode.episode}`;
                      return (
                        <View key={key} style={s.episodeRow}>
                          <NativePressable
                            accessibilityRole="button"
                            accessibilityLabel={`View ${episode.title}, season ${episode.season} episode ${episode.episode}, ${displayEpisodeName(episode.name)}`}
                            accessibilityHint="Shows the synopsis, rating, tags and watch count"
                            accessibilityState={{ disabled: pending.has(key) }}
                            disabled={pending.has(key)}
                            onPress={() => openEpisode(episode)}
                            style={s.rowOpen}
                            pressedStyle={s.rowPressed}
                          >
                            <View style={s.artwork}>
                              {episode.imageUrl ? (
                                <Image
                                  source={episode.imageUrl}
                                  accessibilityLabel={`${episode.name} artwork`}
                                  contentFit="cover"
                                  style={s.image}
                                />
                              ) : (
                                // No still: the episode number, like title pages.
                                <View style={s.imageFallback}>
                                  <Text style={s.imageFallbackNumber}>
                                    {episode.episode.toString().padStart(2, '0')}
                                  </Text>
                                </View>
                              )}
                            </View>
                            {/* The synopsis lives in the episode sheet, like on series pages. */}
                            <View style={s.copy}>
                              {/* The show name truncates; the episode number always shows. */}
                              <View style={s.showLine}>
                                <Text numberOfLines={1} style={[s.showTitle, s.showName]}>
                                  {episode.title}
                                </Text>
                                <Text style={s.showTitle}>
                                  {' · '}
                                  {/* Emphasised like the episode number on title pages. */}
                                  <Text style={s.episodeNumber}>
                                    {`S${episode.season} E${episode.episode}`}
                                  </Text>
                                </Text>
                              </View>
                              <Text numberOfLines={3} style={s.episodeTitle}>
                                {displayEpisodeName(episode.name)}
                              </Text>
                            </View>
                            {/* The row opens the episode's details; the circle only ticks it. */}
                            <ChevronRight size={16} color={colors.muted} strokeWidth={2} />
                          </NativePressable>
                          {page === 'watching' ? (
                            <NativePressable
                              accessibilityRole="checkbox"
                              accessibilityLabel={`Mark ${episode.title} season ${episode.season} episode ${episode.episode} watched`}
                              accessibilityState={{ checked: false, disabled: pending.has(key) }}
                              disabled={pending.has(key)}
                              onPress={() => markWatched(episode)}
                              hitSlop={8}
                              style={s.check}
                              pressedStyle={s.pressed}
                            ></NativePressable>
                          ) : (
                            episode.rating !== undefined && (
                              <View
                                accessibilityLabel={`Rated ${episode.rating} out of 5 stars`}
                                style={s.ratingPill}
                              >
                                <Star size={12} color={colors.text} fill={colors.text} />
                                <Text style={s.ratingText}>{episode.rating.toFixed(1)}</Text>
                              </View>
                            )
                          )}
                        </View>
                      );
                    })}
                  </View>
                ) : (
                  <EmptyState
                    title={
                      narrowed
                        ? 'No matching episodes'
                        : page === 'watching'
                          ? 'Nothing queued'
                          : 'No favorite episodes yet'
                    }
                    detail={
                      narrowed
                        ? 'Try clearing your search or filters.'
                        : page === 'watching'
                          ? 'New episodes from the shows you’re watching will appear here.'
                          : 'Rate watched episodes and your highest scores will appear here.'
                    }
                  />
                )}
              </View>
            );
          })}
        </SwipePages>
      </ScrollView>

      {editing && (
        <EpisodeEditSheet
          open
          onOpenChange={(open) => {
            if (!open) {
              editor.current = undefined;
              setEditing(undefined);
            }
          }}
          episode={{ ...editing, showTitle: editing.title }}
          watched={editingWatched}
          pending={pending.has(`${editing.itemId}:${editing.season}:${editing.episode}`)}
          draft={{ rating: draftRating, tags: draftTags, timesWatched: draftTimes }}
          tagSuggestions={favoriteTags}
          onToggleWatched={() => {
            const current = editor.current;
            const next = !editingWatched;
            setEditingWatched(next);
            void updateEpisode(
              editing,
              { watched: next },
              {
                // Only roll back the sheet that made this change.
                failure: () => {
                  if (editor.current === current) setEditingWatched(!next);
                },
              },
            );
          }}
          onTimesWatchedChange={(timesWatched) => {
            const current = editor.current;
            if (!current) return;
            const version = ++current.timesVersion;
            setDraftTimes(timesWatched);
            void updateEpisode(
              editing,
              { timesWatched },
              {
                success: () => {
                  current.savedTimes = timesWatched;
                },
                failure: () => {
                  if (editor.current === current && current.timesVersion === version)
                    setDraftTimes(current.savedTimes);
                },
              },
            );
          }}
          onRatingChange={(rating) => {
            const current = editor.current;
            if (!current) return;
            const version = ++current.ratingVersion;
            setDraftRating(rating);
            void updateEpisode(editing, rating === undefined ? { clearRating: true } : { rating }, {
              success: () => {
                current.savedRating = rating;
              },
              failure: () => {
                if (editor.current === current && current.ratingVersion === version) {
                  setDraftRating(current.savedRating);
                }
              },
            });
          }}
          onTagsChange={(tags) => {
            const current = editor.current;
            if (!current) return;
            const version = ++current.tagsVersion;
            setDraftTags(tags);
            void updateEpisode(
              editing,
              { tags },
              {
                success: () => {
                  current.savedTags = tags;
                },
                failure: () => {
                  if (editor.current === current && current.tagsVersion === version) {
                    setDraftTags(current.savedTags);
                  }
                },
              },
            );
          }}
        />
      )}
      <MobileNav current="episodes" />
    </ScreenView>
  );
}

// Room for the bar floating over the scroll view.
const CONTENT_TOP = 76;

const s = createAppStyles(
  {
    root: { flex: 1, backgroundColor: colors.bg },
    toolbar: {
      position: 'absolute',
      zIndex: 10,
      left: 0,
      right: 0,
      top: 0,
      backgroundColor: colors.bg,
    },
    content: {
      width: '100%',
      maxWidth: 940,
      alignSelf: 'center',
      paddingHorizontal: 20,
      paddingTop: CONTENT_TOP,
      paddingBottom: 128,
      minHeight: '100%',
    },
    tabs: { marginTop: 4, marginBottom: 8, width: '100%' },
    page: {},
    upNext: { marginBottom: 4 },
    list: { gap: 2 },
    episodeRow: {
      minHeight: 76,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    rowOpen: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      borderRadius: radius.md,
    },
    rowPressed: { opacity: 0.7 },
    artwork: {
      width: 96,
      height: 54,
      borderRadius: radius.xs,
      overflow: 'hidden',
      backgroundColor: colors.surface,
    },
    image: { width: '100%', height: '100%' },
    imageFallbackNumber: {
      color: colors.muted,
      fontSize: 16,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    imageFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    copy: { flex: 1, minWidth: 0, minHeight: 64, justifyContent: 'center', gap: 3 },
    showTitle: { color: colors.secondary, fontSize: 12, fontWeight: '600' },
    showLine: { flexDirection: 'row', minWidth: 0 },
    showName: { flexShrink: 1 },
    episodeNumber: { color: colors.text, fontWeight: '700' },
    episodeTitle: { color: colors.text, fontSize: 15, lineHeight: 19, fontWeight: '600' },
    check: {
      width: 32,
      height: 32,
      borderRadius: radius.pill,
      borderWidth: 1.5,
      borderColor: colors.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: { backgroundColor: colors.elevated },
    ratingPill: {
      height: 28,
      paddingHorizontal: 10,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      borderRadius: radius.pill,
      backgroundColor: colors.elevated,
    },

    ratingText: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
  },
  ['showTitle', 'episodeNumber', 'episodeTitle', 'ratingText', 'imageFallbackNumber'] as const,
);
