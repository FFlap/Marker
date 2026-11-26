import { usePendingTasks } from '@/hooks/use-pending-tasks';
import { ScreenView } from '@/components/ScreenLayout';
import * as Effect from 'effect/Effect';
import { saveProfile } from '@marker/shared/clientEffects';
import { useOperation } from '@/hooks/use-operation';
import { useEffect, useRef, useState } from 'react';
import Clock from 'lucide-react-native/icons/clock';
import X from 'lucide-react-native/icons/x';
import {
  readRecentSearches,
  restoredRecentSearches,
  withRecentSearch,
  writeRecentSearches,
} from '@/lib/recentSearches';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { KeyboardScrollView } from '@/components/ui/KeyboardScrollView';
import { useAuth } from '@clerk/expo';
import type { KeyboardAwareScrollViewRef } from 'react-native-keyboard-controller';
import { router } from 'expo-router';
import { useMutation, useQuery } from 'convex/react';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import TagsIcon from 'lucide-react-native/icons/tags';
import { api } from '@marker/shared/api';
import { SecondaryHeader } from '@/components/BackButton';
import { SearchResultsSkeleton } from '@/components/PageSkeletons';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import {
  Button,
  EmptyState,
  IconButton,
  SearchField,
  SectionHeading,
  TextAction,
} from '@/components/ui/primitives';
import { NativePressable } from '@/components/ui/NativePressable';
import { PosterImage } from '@/components/ui/PosterImage';
import { useToast } from '@/components/ui/Toast';
import { SwipeTabsArea } from '@/components/SwipeTabsArea';
import { SearchFailed } from '@/components/SearchFailed';
import { useTabScrollMemory } from '@/hooks/use-tab-scroll-memory';
import { useChipInView } from '@/hooks/use-chip-in-view';
import { colors } from '@/constants/colors';
import { radius, typeRamp } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';
import type { SearchResult } from '@/types';
import { useTitleSearch } from '@/hooks/use-title-search';

type Filter = 'all' | 'movie' | 'tv' | 'people' | 'tags';
type Person = {
  username: string;
  isPublic: boolean;
  avatarUrl?: string;
  followerCount: number;
  followingCount: number;
  relationship: 'self' | 'none' | 'pending' | 'accepted';
};
type PublicTag = {
  tag: string;
  entryCount: number;
  contributorCount: number;
  posters: { title: string; posterPath?: string }[];
};

const filters: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'movie', label: 'Movies' },
  { value: 'tv', label: 'TV shows' },
  { value: 'people', label: 'People' },
  { value: 'tags', label: 'Tags' },
];
const FILTER_VALUES = filters.map((entry) => entry.value);
const PREVIEW_RESULT_LIMIT = 3;
export default function Explore() {
  const runOperation = useOperation();
  const follow = useMutation(api.profiles.follow);
  const unfollow = useMutation(api.profiles.unfollow);
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  // "See all" and swiping between chips open each result list at its start.
  const chipStrip = useChipInView(filter);
  const tabScroll = useTabScrollMemory<Filter, KeyboardAwareScrollViewRef>(filter, {
    topInset: CONTENT_TOP,
    resetKey: query.trim(),
  });
  const seeAll = (next: Filter) => {
    tabScroll.forget(next);
    setFilter(next);
  };
  const [recent, setRecent] = useState<string[]>([]);
  const recentRef = useRef<string[]>([]);
  const { userId } = useAuth();
  useEffect(() => {
    let live = true;
    void readRecentSearches(userId).then((saved) => {
      if (!live) return;
      recentRef.current = saved;
      setRecent(saved);
    });
    return () => {
      live = false;
    };
  }, [userId]);
  const saveRecent = (next: string[]) => {
    recentRef.current = next;
    setRecent(next);
    writeRecentSearches(userId, next);
  };
  const remember = (value: string) => saveRecent(withRecentSearch(recentRef.current, value));
  const {
    debouncedQuery,
    ready,
    settled,
    results: mediaResults,
    loading: mediaLoading,
    failed: mediaFailed,
    retry: retryMedia,
    hasMore: mediaHasMore,
    loadingMore: mediaLoadingMore,
    loadMoreFailed: mediaLoadMoreFailed,
    loadMore: loadMoreMedia,
  } = useTitleSearch(query, {
    enabled: filter !== 'people' && filter !== 'tags',
    // Movies and TV shows search their own category, so "See all" isn't limited to the
    // titles that made the mixed first page.
    type: filter === 'movie' || filter === 'tv' ? filter : undefined,
  });
  const [pendingPeople, setPendingPeople] = usePendingTasks();
  const library = useQuery(api.library.items.listItems);
  const people = useQuery(
    api.profiles.search,
    ready && settled && (filter === 'all' || filter === 'people')
      ? { query: debouncedQuery }
      : 'skip',
  ) as Person[] | undefined;
  const publicTags = useQuery(
    api.tags.searchPublic,
    ready && settled && (filter === 'all' || filter === 'tags')
      ? { query: debouncedQuery }
      : 'skip',
  ) as PublicTag[] | undefined;

  const isSaved = (result: SearchResult) =>
    !!library?.some((item) => item.tmdbId === result.id && item.mediaType === result.mediaType);
  const openTitle = (result: SearchResult) => {
    // Opening a result keeps the search in Recent searches.
    remember(debouncedQuery);
    const existing = library?.find(
      (item) => item.tmdbId === result.id && item.mediaType === result.mediaType,
    );
    if (existing) {
      router.push(`/item/${existing._id}`);
      return;
    }
    router.push({
      pathname: '/title/[mediaType]/[tmdbId]',
      params: {
        mediaType: result.mediaType,
        tmdbId: String(result.id),
        preview: JSON.stringify(result),
      },
    });
  };

  const updateFollow = async (person: Person) => {
    if (person.relationship === 'self' || pendingPeople.has(person.username)) return;
    setPendingPeople((current) => new Set(current).add(person.username));
    await runOperation.write(
      Effect.gen(function* () {
        if (person.relationship === 'none')
          yield* saveProfile(() => follow({ username: person.username }));
        else yield* saveProfile(() => unfollow({ username: person.username }));
      }),
      {
        failure: () => {
          toast.show('Couldn’t update this follow');
        },
        settled: () => {
          setPendingPeople((current) => {
            const next = new Set(current);
            next.delete(person.username);
            return next;
          });
        },
      },
    );
  };

  const movies = mediaResults.filter((result) => result.mediaType === 'movie');
  const shows = mediaResults.filter((result) => result.mediaType === 'tv');
  const allMovies = movies.slice(0, PREVIEW_RESULT_LIMIT);
  const allShows = shows.slice(0, PREVIEW_RESULT_LIMIT);
  const visibleMedia = filter === 'movie' ? movies : filter === 'tv' ? shows : mediaResults;
  const visiblePeople = filter === 'all' || filter === 'people' ? (people ?? []) : [];
  const allPeople = visiblePeople.slice(0, PREVIEW_RESULT_LIMIT);
  const visibleTags = filter === 'all' || filter === 'tags' ? (publicTags ?? []) : [];
  const allTags = visibleTags.slice(0, PREVIEW_RESULT_LIMIT);
  // Retrying only the title search keeps people and tag results on screen meanwhile.
  const [retryingMedia, setRetryingMedia] = useState(false);
  if (retryingMedia && !mediaLoading) setRetryingMedia(false);
  const retryTitles = () => {
    setRetryingMedia(true);
    retryMedia();
  };
  const loading =
    ready &&
    (!settled ||
      (filter === 'people'
        ? people === undefined
        : filter === 'tags'
          ? publicTags === undefined
          : filter === 'all'
            ? (mediaLoading && !retryingMedia) || people === undefined || publicTags === undefined
            : mediaLoading));
  const hasResults = visibleMedia.length > 0 || visiblePeople.length > 0 || visibleTags.length > 0;
  const searchLabel = 'Search movies, TV shows, people, and tags';

  return (
    <ScreenView style={s.root}>
      <SecondaryHeader title="Explore" maxWidth={760} />
      <KeyboardScrollView
        ref={tabScroll.scrollRef}
        onScroll={tabScroll.onScroll}
        onScrollBeginDrag={tabScroll.onScrollBeginDrag}
        onContentSizeChange={tabScroll.onContentSizeChange}
        scrollEventThrottle={32}
        contentContainerStyle={s.content}
      >
        <SearchField
          accessibilityLabel={searchLabel}
          autoCapitalize="none"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => remember(query)}
          placeholder="Search Marker"
          containerStyle={s.searchField}
        />
        <ScrollView
          {...chipStrip.stripProps}
          onLayout={(event) => {
            tabScroll.onContentLayout(event);
            chipStrip.stripProps.onLayout(event);
          }}
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityRole="tablist"
          style={s.filtersShell}
          contentContainerStyle={s.filters}
        >
          {filters.map((entry) => {
            const selected = filter === entry.value;
            return (
              <Pressable
                key={entry.value}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setFilter(entry.value)}
                hitSlop={{ top: 4, bottom: 4 }}
                onLayout={chipStrip.onChipLayout(entry.value)}
                style={[s.filter, selected && s.filterSelected]}
              >
                <Text style={[s.filterText, selected && s.filterTextSelected]}>{entry.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <SwipeTabsArea tabs={FILTER_VALUES} value={filter} onChange={setFilter} style={s.results}>
          {!ready ? (
            recent.length > 0 ? (
              <View style={s.resultSection}>
                <SectionHeading
                  title="Recent searches"
                  action={
                    <TextAction
                      title="Clear"
                      accessibilityLabel="Clear recent searches"
                      onPress={() => {
                        const cleared = recent;
                        saveRecent([]);
                        toast.show('Recent searches cleared', {
                          action: {
                            label: 'Undo',
                            onPress: () =>
                              saveRecent(restoredRecentSearches(recentRef.current, cleared)),
                          },
                        });
                      }}
                    />
                  }
                />
                {recent.map((entry) => (
                  <View key={entry} style={s.recentRow}>
                    <NativePressable
                      accessibilityRole="button"
                      accessibilityLabel={`Search for ${entry}`}
                      onPress={() => setQuery(entry)}
                      style={s.recentOpen}
                      pressedStyle={s.pressed}
                    >
                      <Clock size={17} color={colors.muted} strokeWidth={1.8} />
                      <Text numberOfLines={1} style={s.recentText}>
                        {entry}
                      </Text>
                    </NativePressable>
                    <IconButton
                      icon={X}
                      size="sm"
                      color={colors.muted}
                      accessibilityLabel={`Remove ${entry} from recent searches`}
                      // The × lines up with "Clear" above it.
                      style={s.recentRemove}
                      onPress={() =>
                        saveRecent(recentRef.current.filter((value) => value !== entry))
                      }
                    />
                  </View>
                ))}
              </View>
            ) : (
              <Text style={s.idleHint}>Search movies, TV shows, people and public tags.</Text>
            )
          ) : loading ? (
            <SearchResultsSkeleton />
          ) : !hasResults ? (
            retryingMedia ? (
              <SearchResultsSkeleton />
            ) : mediaFailed ? (
              <SearchFailed onRetry={retryTitles} />
            ) : (
              <EmptyState title="No results" detail="Try a different search." />
            )
          ) : filter === 'all' ? (
            <>
              {/* People and tags still show when only the title search failed. */}
              {retryingMedia ? (
                <SearchResultsSkeleton count={2} />
              ) : (
                mediaFailed && <SearchFailed inline onRetry={retryTitles} />
              )}
              <ResultSection
                title="Movies"
                visible={allMovies.length > 0}
                // Its own search can find more than the mixed page shows, so always offered.
                more={() => seeAll('movie')}
              >
                {allMovies.map((result) => (
                  <MediaResult
                    key={`movie-${result.id}`}
                    result={result}
                    saved={isSaved(result)}
                    onPress={openTitle}
                  />
                ))}
              </ResultSection>
              <ResultSection
                title="TV shows"
                visible={allShows.length > 0}
                more={() => seeAll('tv')}
              >
                {allShows.map((result) => (
                  <MediaResult
                    key={`tv-${result.id}`}
                    result={result}
                    saved={isSaved(result)}
                    onPress={openTitle}
                  />
                ))}
              </ResultSection>
              <ResultSection
                title="People"
                visible={allPeople.length > 0}
                more={visiblePeople.length > allPeople.length ? () => seeAll('people') : undefined}
              >
                {allPeople.map((person) => (
                  <PersonResult
                    key={person.username}
                    onOpen={() => remember(debouncedQuery)}
                    person={person}
                    pending={pendingPeople.has(person.username)}
                    onFollow={() => void updateFollow(person)}
                  />
                ))}
              </ResultSection>
              <ResultSection
                title="Tags"
                visible={allTags.length > 0}
                more={visibleTags.length > allTags.length ? () => seeAll('tags') : undefined}
              >
                {allTags.map((tag) => (
                  <PublicTagResult
                    key={tag.tag.toLocaleLowerCase()}
                    tag={tag}
                    onOpen={() => remember(debouncedQuery)}
                  />
                ))}
              </ResultSection>
            </>
          ) : filter === 'people' ? (
            visiblePeople.map((person) => (
              <PersonResult
                key={person.username}
                onOpen={() => remember(debouncedQuery)}
                person={person}
                pending={pendingPeople.has(person.username)}
                onFollow={() => void updateFollow(person)}
              />
            ))
          ) : filter === 'tags' ? (
            visibleTags.map((tag) => (
              <PublicTagResult
                key={tag.tag.toLocaleLowerCase()}
                tag={tag}
                onOpen={() => remember(debouncedQuery)}
              />
            ))
          ) : (
            <>
              {visibleMedia.map((result) => (
                <MediaResult
                  key={`${result.mediaType}-${result.id}`}
                  result={result}
                  saved={isSaved(result)}
                  onPress={openTitle}
                />
              ))}
              {/* A category lists every page of its own search, one page at a time. */}
              {mediaHasMore && (
                <Button
                  title={
                    mediaLoadingMore
                      ? 'Loading…'
                      : mediaLoadMoreFailed
                        ? 'Couldn’t load more · Try again'
                        : 'Load more'
                  }
                  variant="secondary"
                  disabled={mediaLoadingMore}
                  onPress={loadMoreMedia}
                  style={s.loadMore}
                />
              )}
            </>
          )}
        </SwipeTabsArea>
      </KeyboardScrollView>
    </ScreenView>
  );
}

function PublicTagResult({ tag, onOpen }: { tag: PublicTag; onOpen: () => void }) {
  return (
    <NativePressable
      accessibilityRole="button"
      accessibilityLabel={`Explore ${tag.tag} tag`}
      onPress={() => {
        onOpen();
        router.push({ pathname: '/tag/[tag]', params: { tag: tag.tag } });
      }}
      style={s.tagResult}
      pressedStyle={s.pressed}
    >
      <View style={s.tagPosters}>
        {tag.posters.length ? (
          tag.posters.map((poster, index) => (
            <PosterImage
              key={`${poster.title}:${poster.posterPath ?? ''}`}
              path={poster.posterPath}
              title={poster.title}
              style={[s.tagPoster, index > 0 && { marginLeft: -14 }]}
            />
          ))
        ) : (
          <View style={s.tagFallback}>
            <TagsIcon size={20} color={colors.muted} strokeWidth={1.6} />
          </View>
        )}
      </View>
      <View style={s.resultCopy}>
        <Text numberOfLines={1} style={s.resultTitle}>
          {tag.tag}
        </Text>
        <Text style={s.resultMeta}>
          {tag.entryCount} {tag.entryCount === 1 ? 'saved title' : 'saved titles'} ·{' '}
          {tag.contributorCount} {tag.contributorCount === 1 ? 'person' : 'people'}
        </Text>
      </View>
      <ChevronRight
        size={17}
        color={colors.muted}
        strokeWidth={1.7}
        // The glyph's own padding: end it on the 20dp gutter like the text above.
        style={ROW_CHEVRON}
      />
    </NativePressable>
  );
}

function ResultSection({
  title,
  visible,
  more,
  children,
}: {
  title: string;
  visible: boolean;
  more?: () => void;
  children: React.ReactNode;
}) {
  if (!visible) return null;
  return (
    <View style={s.resultSection}>
      <SectionHeading
        title={title}
        action={
          more ? (
            <TextAction
              title="See all"
              accessibilityLabel={`See all ${title.toLocaleLowerCase()}`}
              onPress={more}
            />
          ) : undefined
        }
      />
      {children}
    </View>
  );
}

function MediaResult({
  result,
  saved,
  onPress,
}: {
  result: SearchResult;
  saved: boolean;
  onPress: (result: SearchResult) => void;
}) {
  return (
    <NativePressable
      accessibilityRole="button"
      accessibilityLabel={`View ${result.title}${saved ? ', in your library' : ''}`}
      onPress={() => onPress(result)}
      style={s.mediaResult}
      pressedStyle={s.pressed}
    >
      <PosterImage path={result.posterPath} title={result.title} style={s.poster} />
      <View style={s.resultCopy}>
        <Text numberOfLines={2} style={s.resultTitle}>
          {result.title}
        </Text>
        {(!!result.releaseDate || saved) && (
          <Text style={s.resultMeta}>
            {[result.releaseDate?.slice(0, 4), saved && 'In library'].filter(Boolean).join(' · ')}
          </Text>
        )}
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
}

function PersonResult({
  person,
  onOpen,
  pending,
  onFollow,
}: {
  person: Person;
  onOpen: () => void;
  pending: boolean;
  onFollow: () => void;
}) {
  const label =
    person.relationship === 'accepted'
      ? 'Following'
      : person.relationship === 'pending'
        ? 'Requested'
        : person.isPublic
          ? 'Follow'
          : 'Request';
  return (
    <View style={s.personResult}>
      <NativePressable
        accessibilityRole="button"
        accessibilityLabel={`Open @${person.username}`}
        onPress={() => {
          onOpen();
          router.push(`/u/${person.username}`);
        }}
        style={s.personIdentity}
        pressedStyle={s.pressed}
      >
        <ProfileAvatar username={person.username} avatarUrl={person.avatarUrl} size={52} />
        <View style={s.resultCopy}>
          <Text style={s.personName}>@{person.username}</Text>
          <Text style={s.resultMeta}>
            {person.followerCount.toLocaleString()} follower{person.followerCount === 1 ? '' : 's'}{' '}
            · {person.isPublic ? 'Public' : 'Private'}
          </Text>
        </View>
        {/* With a Follow button at the end of the row, the row needs no chevron. */}
        {person.relationship === 'self' && (
          <ChevronRight
            size={17}
            color={colors.muted}
            strokeWidth={1.7}
            // The glyph's own padding: end it on the 20dp gutter like the text above.
            style={ROW_CHEVRON}
          />
        )}
      </NativePressable>
      {person.relationship !== 'self' && (
        <NativePressable
          accessibilityRole="button"
          accessibilityLabel={`${label} @${person.username}`}
          disabled={pending}
          onPress={onFollow}
          hitSlop={3}
          style={[s.followButton, person.relationship === 'none' && s.followButtonPrimary]}
          pressedStyle={s.pressed}
        >
          {pending ? (
            <ActivityIndicator size="small" color={colors.muted} />
          ) : (
            <Text style={[s.followText, person.relationship === 'none' && s.followTextPrimary]}>
              {label}
            </Text>
          )}
        </NativePressable>
      )}
    </View>
  );
}

// Room for the bar floating over the scroll view.
const CONTENT_TOP = 92;

const ROW_CHEVRON = { marginRight: -5 };

const s = createAppStyles(
  {
    root: { flex: 1, backgroundColor: colors.bg },
    loadMore: { alignSelf: 'center', marginTop: 16 },
    content: {
      width: '100%',
      maxWidth: 760,
      alignSelf: 'center',
      paddingHorizontal: 20,
      paddingTop: CONTENT_TOP,
      paddingBottom: 72,
    },
    searchField: { flex: 0 },
    tagResult: {
      minHeight: 84,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 8,
    },
    tagPosters: { width: 92, height: 68, flexDirection: 'row', alignItems: 'center' },
    tagPoster: {
      width: 42,
      height: 63,
      borderRadius: radius.xs,
      borderWidth: 2,
      borderColor: colors.bg,
    },
    tagFallback: {
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // 4dp above and below the 36dp chips gives each a 44dp touch area inside the strip.
    filtersShell: { marginTop: 10, marginBottom: -4, marginHorizontal: -20 },
    filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingVertical: 4 },
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
    results: { paddingTop: 8 },
    resultSection: { marginTop: 20, gap: 4 },
    idleHint: { ...typeRamp.meta, textAlign: 'center', marginTop: 24 },
    recentRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 4 },
    recentRemove: { marginRight: -8 },
    recentOpen: {
      flex: 1,
      minWidth: 0,
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      borderRadius: radius.md,
    },
    recentText: { ...typeRamp.rowTitle, flex: 1, fontWeight: '500' },
    mediaResult: {
      minHeight: 96,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 8,
    },
    poster: { width: 52, height: 78, borderRadius: radius.xs },
    resultCopy: { flex: 1, minWidth: 0, gap: 3 },
    resultTitle: { ...typeRamp.rowTitle },
    resultMeta: { ...typeRamp.meta },
    personResult: {
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    personIdentity: {
      flex: 1,
      minWidth: 0,
      minHeight: 78,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 13,
    },
    personName: { ...typeRamp.rowTitle },
    followButton: {
      minWidth: 88,
      height: 36,
      paddingHorizontal: 14,
      borderRadius: radius.pill,
      backgroundColor: colors.elevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    followButtonPrimary: { backgroundColor: colors.text },
    followText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    followTextPrimary: { color: colors.bg },
    pressed: { opacity: 0.62 },
  },
  [
    'filterText',
    'filterTextSelected',
    'resultTitle',
    'resultMeta',
    'personName',
    'followText',
    'followTextPrimary',
    'recentText',
    'idleHint',
  ] as const,
);
