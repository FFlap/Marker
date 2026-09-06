import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { Button, EmptyState, Input, Segmented } from '@/components/ui/primitives';
import { PosterImage } from '@/components/ui/PosterImage';
import { RatingControl, Stepper, TagEditor } from '@/components/ui/library-controls';
import { useToast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';
import { SecondaryHeader } from '@/components/BackButton';
import { SearchResultsSkeleton } from '@/components/PageSkeletons';
import type { LibraryItem, SearchResult, Status } from '@/types';
const statusOptions = [
  { label: 'Watched', value: 'watched' },
  { label: 'Watching', value: 'watching' },
  { label: 'Watchlist', value: 'watchlist' },
  { label: 'Dropped', value: 'dropped' },
] as const;
type MediaFilter = 'all' | SearchResult['mediaType'];
const mediaFilters: { value: MediaFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'movie', label: 'Movies' },
  { value: 'tv', label: 'TV Shows' },
];
const EMPTY_LIBRARY: LibraryItem[] = [];
const mediaLabel = (mediaType: SearchResult['mediaType'], genres?: string[]) => {
  const anime = genres?.some((genre) => genre.toLocaleLowerCase() === 'anime');
  if (anime) return mediaType === 'movie' ? 'Anime Movie' : 'Anime';
  return mediaType === 'movie' ? 'Movie' : 'TV Show';
};
export default function Add() {
  const { prefill } = useLocalSearchParams<{ prefill?: string }>();
  const initialResult = useMemo(() => {
    if (!prefill) return undefined;
    try {
      const value = JSON.parse(prefill) as Partial<SearchResult>;
      if (
        typeof value.id !== 'number' ||
        typeof value.title !== 'string' ||
        (value.mediaType !== 'movie' && value.mediaType !== 'tv')
      )
        return undefined;
      return value as SearchResult;
    } catch {
      return undefined;
    }
  }, [prefill]);
  const searchAction = useAction(api.tmdb.searchMulti);
  const addItemAndMarkWatched = useAction(api.library.seasonWatched.addItemAndMarkWatched);
  const touchTitle = useMutation(api.resolvedMetadata.touch.touchTitle);
  const add = useMutation(api.library.items.addItem);
  const libraryQuery = useQuery(api.library.items.listItems);
  const library = libraryQuery ?? EMPTY_LIBRARY;
  const toast = useToast();
  const [query, setQuery] = useState(initialResult?.title ?? '');
  const [filter, setFilter] = useState<MediaFilter>('all');
  const [searchResult, setSearchResult] = useState<{
    query: string;
    results: SearchResult[];
  }>({ query: '', results: [] });
  const [loadingQuery, setLoadingQuery] = useState<string>();
  const [picked, setPicked] = useState<SearchResult | undefined>(initialResult);
  const resolvedTitle = useQuery(
    api.resolvedMetadata.reads.getTitle,
    picked ? { mediaType: picked.mediaType, tmdbId: picked.id } : 'skip',
  );
  const requestGeneration = useRef(0);
  const [status, setStatus] = useState<Status>('watchlist');
  const [rating, setRating] = useState<number>();
  const [times, setTimes] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    if (picked) return;
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) {
      requestGeneration.current += 1;
      return;
    }
    const generation = ++requestGeneration.current;
    const timer = setTimeout(async () => {
      setLoadingQuery(normalizedQuery);
      try {
        const next = await searchAction({ query: normalizedQuery });
        if (generation === requestGeneration.current)
          setSearchResult({ query: normalizedQuery, results: next });
      } catch {
        if (generation === requestGeneration.current) {
          setSearchResult({ query: normalizedQuery, results: [] });
          toast.show('Search is unavailable right now');
        }
      }
      if (generation === requestGeneration.current) setLoadingQuery(undefined);
    }, 350);
    return () => {
      clearTimeout(timer);
      requestGeneration.current += 1;
    };
  }, [query, picked, searchAction, toast]);
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
      void touchTitle({
        mediaType: result.mediaType,
        tmdbId: result.id,
        title: result.title,
      }).catch(() => undefined);
    },
    [touchTitle],
  );
  const prefillStarted = useRef(false);
  useEffect(() => {
    if (!initialResult || prefillStarted.current) return;
    prefillStarted.current = true;
    void touchTitle({
      mediaType: initialResult.mediaType,
      tmdbId: initialResult.id,
      title: initialResult.title,
    }).catch(() => undefined);
  }, [initialResult, touchTitle]);
  const suggestions = useMemo(() => [...new Set(library.flatMap((i) => i.tags))], [library]);
  const normalizedQuery = query.trim();
  const results =
    normalizedQuery.length >= 2 && searchResult.query === normalizedQuery
      ? searchResult.results
      : [];
  const loading = normalizedQuery.length >= 2 && loadingQuery === normalizedQuery;
  const visibleResults =
    filter === 'all' ? results : results.filter((result) => result.mediaType === filter);
  const resolvedRuntime =
    resolvedTitle?.runtime ??
    (resolvedTitle?.episodeRunTime?.length
      ? resolvedTitle.episodeRunTime.reduce((total, value) => total + value, 0) /
        resolvedTitle.episodeRunTime.length
      : undefined);
  const submit = async () => {
    if (!picked || resolvedTitle === undefined || submitting) return;
    setSubmitting(true);
    try {
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
        tags,
      };
      if (picked.mediaType === 'tv' && status === 'watched') {
        await addItemAndMarkWatched(addArgs);
      } else {
        await add(addArgs);
      }
      toast.show(`${picked.title} added`);
      router.back();
    } catch (e) {
      toast.show(
        e instanceof Error && /already exists/i.test(e.message)
          ? 'Already in your library'
          : 'Couldn’t add this title',
      );
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <View style={s.root}>
      <SecondaryHeader title="Add Title" maxWidth={680} />
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Input
          testID="tmdb-search"
          autoFocus
          value={query}
          onChangeText={(v) => {
            setQuery(v);
            setPicked(undefined);
          }}
          placeholder="Search movies and TV…"
        />
        {!picked && (
          <View accessibilityRole="tablist" style={s.filters}>
            {mediaFilters.map((entry) => {
              const selected = filter === entry.value;
              return (
                <Pressable
                  key={entry.value}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  onPress={() => setFilter(entry.value)}
                  style={[s.filter, selected && s.filterSelected]}
                >
                  <Text style={[s.filterText, selected && s.filterTextSelected]}>
                    {entry.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}
        {loading && <SearchResultsSkeleton />}
        {!picked ? (
          query.trim().length < 2 ? (
            <View style={s.emptySearch}>
              <EmptyState title="Search all of Marker" detail="Find movies, TV shows, or people." />
            </View>
          ) : (
            visibleResults.map((r) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Select ${r.title}`}
                testID={`result-${r.id}`}
                key={`${r.mediaType}-${r.id}`}
                onPress={() => void selectResult(r)}
                style={s.result}
              >
                <PosterImage
                  path={r.posterPath}
                  title={r.title}
                  style={{ width: 54, height: 81 }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={s.resultTitle}>{r.title}</Text>
                  <Text style={s.meta}>
                    {r.releaseDate?.slice(0, 4) ?? '—'} · {mediaLabel(r.mediaType)}
                  </Text>
                </View>
                <Text style={s.chev}>›</Text>
              </Pressable>
            ))
          )
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
                  {picked.releaseDate?.slice(0, 4)} ·{' '}
                  {mediaLabel(picked.mediaType, resolvedTitle?.genres)}
                </Text>
              </View>
            </View>
            <Segmented options={statusOptions} value={status} onChange={changeStatus} />
            <RatingControl value={rating} onChange={setRating} />
            {status === 'watched' && (
              <Stepper label="Times Watched" value={times} onChange={setTimes} min={1} />
            )}
            <TagEditor tags={tags} onChange={setTags} suggestions={suggestions} />
            <Button
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
      </ScrollView>
    </View>
  );
}
const s = createAppStyles(
  {
    root: { flex: 1, backgroundColor: colors.bg },
    content: {
      width: '100%',
      maxWidth: 680,
      alignSelf: 'center',
      paddingHorizontal: 20,
      paddingTop: 96,
      paddingBottom: 70,
    },
    result: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    emptySearch: { paddingTop: 12 },
    filters: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderColor: colors.border,
      marginTop: 18,
    },
    filter: {
      minHeight: 46,
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      borderBottomWidth: 2,
      borderBottomColor: 'transparent',
    },
    filterSelected: { borderBottomColor: colors.text },
    filterText: { color: colors.muted, fontSize: 11, fontWeight: '600' },
    filterTextSelected: { color: colors.text },
    resultTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
    meta: { color: colors.muted, fontSize: 11, marginTop: 6, letterSpacing: 0.1 },
    chev: { color: colors.muted, fontSize: 28 },
    form: { gap: 24, paddingTop: 22 },
    picked: { flexDirection: 'row', gap: 16 },
    pickedTitle: { color: colors.text, fontSize: 22, fontWeight: '700', marginBottom: 8 },
    detailLoading: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    detailLoadingText: { color: colors.muted, fontSize: 12 },
    detailWarning: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    detailWarningText: { color: colors.muted, fontSize: 12 },
    retry: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  },
  [
    'filterText',
    'filterTextSelected',
    'resultTitle',
    'meta',
    'chev',
    'pickedTitle',
    'detailLoadingText',
    'detailWarningText',
    'retry',
  ] as const,
);
