import { useTaskState } from '@/hooks/use-task-state';
import { localDateKey } from '@/hooks/use-local-today';
import { ScreenView } from '@/components/ScreenLayout';
import * as Effect from 'effect/Effect';
import { touchMetadata, saveLibrary } from '@marker/shared/clientEffects';
import { useOperation } from '@/hooks/use-operation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { KeyboardScrollView } from '@/components/ui/KeyboardScrollView';
import { router, useLocalSearchParams } from 'expo-router';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '@marker/shared/api';
import { Button, EmptyState, SearchField, Segmented } from '@/components/ui/primitives';
import { PosterImage } from '@/components/ui/PosterImage';
import {
  ControlSection,
  RatingControl,
  Stepper,
  TagEditor,
  withPendingTag,
} from '@/components/ui/library-controls';
import { ENTRY_STATUS_OPTIONS } from '@/components/ui/entryStatusOptions';
import { useToast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { NativePressable } from '@/components/ui/NativePressable';
import { radius, typeRamp } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';
import { SecondaryHeader } from '@/components/BackButton';
import { SearchResultsSkeleton } from '@/components/PageSkeletons';
import type { SearchResult, Status } from '@/types';
import { parseTitlePreview } from '@/features/title/titleRoute';
import { useTitleSearch } from '@/hooks/use-title-search';
import { SwipeTabsArea } from '@/components/SwipeTabsArea';
import { SearchFailed } from '@/components/SearchFailed';
import { useChipInView } from '@/hooks/use-chip-in-view';
type MediaFilter = 'all' | SearchResult['mediaType'];
const mediaFilters: { value: MediaFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'movie', label: 'Movies' },
  { value: 'tv', label: 'TV shows' },
];
const MEDIA_FILTER_VALUES = mediaFilters.map((entry) => entry.value);
const mediaLabel = (mediaType: SearchResult['mediaType'], genres?: string[]) => {
  const anime = genres?.some((genre) => genre.toLocaleLowerCase() === 'anime');
  if (anime) return mediaType === 'movie' ? 'Anime movie' : 'Anime';
  return mediaType === 'movie' ? 'Movie' : 'TV show';
};
export default function Add() {
  const { prefill } = useLocalSearchParams<{ prefill?: string }>();
  const initialResult = useMemo(() => parseTitlePreview(prefill), [prefill]);
  return <AddForm key={prefill ?? ''} initialResult={initialResult} />;
}

function AddForm({ initialResult }: { initialResult?: SearchResult }) {
  const runOperation = useOperation();
  const addItemAndMarkWatched = useAction(api.library.seasonWatched.addItemAndMarkWatched);
  const touchTitle = useMutation(api.resolvedMetadata.touch.touchTitle);
  const add = useMutation(api.library.items.addItem);
  const toast = useToast();
  const [query, setQuery] = useState(initialResult?.title ?? '');
  const [filter, setFilter] = useState<MediaFilter>('all');
  const chipStrip = useChipInView(filter);
  const [picked, setPicked] = useState<SearchResult | undefined>(initialResult);
  const { results, loading, ready, failed, retry } = useTitleSearch(query, {
    enabled: !picked,
    delayMs: 350,
  });
  const library = useQuery(api.library.items.listItems);
  const libraryEntry = (result: SearchResult) =>
    library?.find((item) => item.tmdbId === result.id && item.mediaType === result.mediaType);
  const resolvedTitle = useQuery(
    api.resolvedMetadata.reads.getTitle,
    picked ? { mediaType: picked.mediaType, tmdbId: picked.id } : 'skip',
  );
  const [status, setStatus] = useState<Status>('watchlist');
  const [rating, setRating] = useState<number>();
  const [times, setTimes] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const { pending: submitting, setPending: setSubmitting } = useTaskState();
  const changeStatus = (nextStatus: Status) => {
    setStatus(nextStatus);
    setTimes((current) =>
      nextStatus === 'watched'
        ? Math.max(1, current)
        : nextStatus === 'watchlist' || nextStatus === 'dropped'
          ? 0
          : current,
    );
  };
  const selectResult = useCallback(
    (result: SearchResult) => {
      setPicked(result);
      void runOperation(
        touchMetadata(() =>
          touchTitle({
            mediaType: result.mediaType,
            tmdbId: result.id,
            title: result.title,
          }),
        ),
        { failure: () => undefined },
      );
    },
    [touchTitle, runOperation],
  );
  useEffect(() => {
    if (!initialResult) return;
    void runOperation(
      touchMetadata(() =>
        touchTitle({
          mediaType: initialResult.mediaType,
          tmdbId: initialResult.id,
          title: initialResult.title,
        }),
      ),
      { failure: () => undefined },
    );
  }, [initialResult, touchTitle, runOperation]);
  const [tagPrefix, setTagPrefix] = useState('');
  const suggestions =
    useQuery(
      api.library.items.listTagSuggestions,
      picked ? { prefix: tagPrefix.trim() || undefined } : 'skip',
    ) ?? [];
  const visibleResults =
    filter === 'all' ? results : results.filter((result) => result.mediaType === filter);
  const resolvedRuntime = resolvedTitle?.episodeRunTime?.length
    ? resolvedTitle.episodeRunTime.reduce((total, value) => total + value, 0) /
      resolvedTitle.episodeRunTime.length
    : undefined;
  const submit = async () => {
    if (!picked || resolvedTitle === undefined || submitting) return;
    setSubmitting(true);
    await runOperation.write(
      Effect.gen(function* () {
        const addArgs = {
          tmdbId: picked.id,
          mediaType: picked.mediaType,
          title: picked.title,
          posterPath: picked.posterPath,
          overview: picked.overview,
          releaseDate: picked.releaseDate,
          runtime: resolvedRuntime,
          genres: resolvedTitle?.genres,
          status,
          rating,
          timesWatched: times,
          // A tag still typed in the field counts too.
          tags: withPendingTag(tags, tagPrefix),
        };
        if (picked.mediaType === 'tv' && status === 'watched') {
          yield* saveLibrary(() =>
            addItemAndMarkWatched({
              ...addArgs,
              activityDate: localDateKey(),
            }),
          );
        } else {
          yield* saveLibrary(() => add(addArgs));
        }
      }),
      {
        success: () => {
          toast.show(`${picked.title} added`);
          router.back();
        },

        failure: ({ cause: e }) => {
          toast.show(
            e instanceof Error && /already exists/i.test(e.message)
              ? 'Already in your library'
              : 'Couldn’t add this title',
          );
        },
        settled: () => {
          setSubmitting(false);
        },
      },
    );
  };
  return (
    <ScreenView style={s.root}>
      <SecondaryHeader title="Add title" maxWidth={680} />
      <KeyboardScrollView contentContainerStyle={s.content}>
        <SearchField
          testID="tmdb-search"
          autoFocus
          value={query}
          onChangeText={(v) => {
            setQuery(v);
            setPicked(undefined);
          }}
          placeholder="Search movies and TV"
          containerStyle={s.searchField}
        />
        {!picked && (
          <ScrollView
            {...chipStrip.stripProps}
            horizontal
            showsHorizontalScrollIndicator={false}
            accessibilityRole="tablist"
            style={s.filtersShell}
            contentContainerStyle={s.filters}
          >
            {mediaFilters.map((entry) => {
              const selected = filter === entry.value;
              return (
                <Pressable
                  key={entry.value}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  onPress={() => setFilter(entry.value)}
                  onLayout={chipStrip.onChipLayout(entry.value)}
                  style={[s.filter, selected && s.filterSelected]}
                >
                  <Text style={[s.filterText, selected && s.filterTextSelected]}>
                    {entry.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        {!picked ? (
          <SwipeTabsArea tabs={MEDIA_FILTER_VALUES} value={filter} onChange={setFilter}>
            {/* While a search runs, the skeleton replaces the previous results. */}
            {query.trim().length >= 2 && loading ? (
              <SearchResultsSkeleton />
            ) : query.trim().length < 2 ? (
              <View style={s.emptySearch}>
                <EmptyState
                  title="Find a title"
                  detail="Search by name to add it to your library."
                />
              </View>
            ) : ready && failed ? (
              <View style={s.emptySearch}>
                <SearchFailed onRetry={retry} />
              </View>
            ) : ready && !loading && visibleResults.length === 0 ? (
              <View style={s.emptySearch}>
                <EmptyState
                  title="No matching titles"
                  detail="Check the spelling or try another name."
                />
              </View>
            ) : (
              visibleResults.map((r) => {
                // Titles already saved open their entry instead of adding a duplicate.
                const entry = libraryEntry(r);
                return (
                  <NativePressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      entry ? `Open ${r.title}, in your library` : `Select ${r.title}`
                    }
                    testID={`result-${r.id}`}
                    key={`${r.mediaType}-${r.id}`}
                    onPress={() => (entry ? router.push(`/item/${entry._id}`) : selectResult(r))}
                    style={s.result}
                    pressedStyle={s.resultPressed}
                  >
                    <PosterImage path={r.posterPath} title={r.title} style={s.resultPoster} />
                    <View style={s.resultCopy}>
                      <Text numberOfLines={2} style={s.resultTitle}>
                        {r.title}
                      </Text>
                      <Text style={s.meta}>
                        {[
                          r.releaseDate?.slice(0, 4),
                          filter === 'all' &&
                            mediaLabel(r.mediaType, entry?.isAnime ? ['Anime'] : undefined),
                          entry && 'In library',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>
                    <ChevronRight
                      size={18}
                      color={colors.muted}
                      strokeWidth={1.8}
                      // The glyph's own padding: end it on the 20dp gutter like the text above.
                      style={ROW_CHEVRON}
                    />
                  </NativePressable>
                );
              })
            )}
          </SwipeTabsArea>
        ) : (
          <View style={s.form}>
            <View style={s.picked}>
              <PosterImage
                path={picked.posterPath}
                title={picked.title}
                style={{ width: 74, height: 111 }}
              />
              <View style={{ flex: 1 }}>
                <Text style={s.pickedTitle}>{picked.title}</Text>
                <Text style={s.meta}>
                  {[
                    picked.releaseDate?.slice(0, 4),
                    mediaLabel(picked.mediaType, resolvedTitle?.genres),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
            </View>
            <ControlSection label="Status">
              <Segmented options={ENTRY_STATUS_OPTIONS} value={status} onChange={changeStatus} />
              {status === 'watched' && picked.mediaType === 'tv' && (
                <Text style={s.hint}>
                  Marking this show as Watched will mark all released episodes as watched.
                </Text>
              )}
            </ControlSection>
            {status === 'watched' && (
              <View style={s.watchedGroup}>
                <Stepper label="Times watched" value={times} onChange={setTimes} min={1} />
              </View>
            )}
            <RatingControl value={rating} onChange={setRating} />
            <TagEditor
              tags={tags}
              onChange={setTags}
              suggestions={suggestions}
              onInputChange={setTagPrefix}
            />
            <Button
              size="lg"
              testID="add-submit"
              title={
                resolvedTitle === undefined
                  ? 'Loading details…'
                  : submitting
                    ? 'Adding…'
                    : 'Add to library'
              }
              disabled={resolvedTitle === undefined || submitting}
              onPress={submit}
            />
          </View>
        )}
      </KeyboardScrollView>
    </ScreenView>
  );
}
const ROW_CHEVRON = { marginRight: -5 };

const s = createAppStyles(
  {
    root: { flex: 1, backgroundColor: colors.bg },
    content: {
      width: '100%',
      maxWidth: 680,
      alignSelf: 'center',
      paddingHorizontal: 20,
      paddingTop: 88,
      paddingBottom: 70,
    },
    searchField: { flex: 0 },
    resultPressed: { opacity: 0.7 },
    hint: { color: colors.muted, fontSize: 12, lineHeight: 17 },
    result: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 8,
    },
    resultPoster: { width: 52, height: 78, borderRadius: radius.xs },
    resultCopy: { flex: 1, minWidth: 0, gap: 3 },
    emptySearch: { paddingTop: 12 },
    filtersShell: { marginTop: 14, marginBottom: 8, marginHorizontal: -20 },
    filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 20 },
    filter: {
      height: 36,
      paddingHorizontal: 13,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    filterSelected: { backgroundColor: colors.text },
    filterText: { color: colors.secondary, fontSize: 13, fontWeight: '600' },
    filterTextSelected: { color: colors.bg },
    resultTitle: { ...typeRamp.rowTitle },
    meta: { ...typeRamp.meta },
    form: { gap: 24, paddingTop: 22 },
    watchedGroup: {
      marginTop: -8,
      paddingLeft: 16,
      paddingRight: 10,
      paddingVertical: 6,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
    },
    picked: { flexDirection: 'row', gap: 16 },
    pickedTitle: { ...typeRamp.screenTitle, fontSize: 22, lineHeight: 28, marginBottom: 6 },
  },
  ['filterText', 'filterTextSelected', 'resultTitle', 'meta', 'pickedTitle', 'hint'] as const,
);
