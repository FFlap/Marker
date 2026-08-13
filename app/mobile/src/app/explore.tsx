import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useAction, useMutation, useQuery } from 'convex/react';
import { ChevronRight, Plus, Search, Tags as TagsIcon } from 'lucide-react-native';
import { api } from '../../convex/_generated/api';
import { SecondaryHeader } from '@/components/BackButton';
import { SearchResultsSkeleton } from '@/components/PageSkeletons';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { EmptyState } from '@/components/ui/primitives';
import { NativePressable } from '@/components/ui/NativePressable';
import { PosterImage } from '@/components/ui/PosterImage';
import { useToast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { createStyles } from '@/lib/typography';
import type { SearchResult } from '@/types';

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
  { value: 'tv', label: 'TV Shows' },
  { value: 'people', label: 'People' },
  { value: 'tags', label: 'Tags' },
];
const PREVIEW_RESULT_LIMIT = 3;
export default function Explore() {
  const searchMedia = useAction(api.tmdb.searchMulti);
  const follow = useMutation(api.profiles.follow);
  const unfollow = useMutation(api.profiles.unfollow);
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [mediaResponse, setMediaResponse] = useState<{
    query: string;
    results: SearchResult[];
  }>({ query: '', results: [] });
  const [pendingPeople, setPendingPeople] = useState<Set<string>>(() => new Set());
  const generation = useRef(0);
  const library = useQuery(api.library.listItems);
  const people = useQuery(
    api.profiles.search,
    debounced.length >= 2 && (filter === 'all' || filter === 'people')
      ? { query: debounced }
      : 'skip',
  ) as Person[] | undefined;
  const publicTags = useQuery(
    api.tags.searchPublic,
    debounced.length >= 2 && (filter === 'all' || filter === 'tags')
      ? { query: debounced }
      : 'skip',
  ) as PublicTag[] | undefined;

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const request = ++generation.current;
    if (debounced.length < 2 || filter === 'people' || filter === 'tags') return;
    void searchMedia({ query: debounced })
      .then((results) => {
        if (request === generation.current) setMediaResponse({ query: debounced, results });
      })
      .catch(() => {
        if (request === generation.current) {
          setMediaResponse({ query: debounced, results: [] });
          toast.show('Search is unavailable right now');
        }
      });
  }, [debounced, filter, searchMedia, toast]);

  const openTitle = (result: SearchResult) => {
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
    try {
      if (person.relationship === 'none') await follow({ username: person.username });
      else await unfollow({ username: person.username });
    } catch {
      toast.show('Couldn’t update this follow');
    }
    setPendingPeople((current) => {
      const next = new Set(current);
      next.delete(person.username);
      return next;
    });
  };

  const ready = debounced.length >= 2;
  const mediaRequested = ready && filter !== 'people' && filter !== 'tags';
  const mediaResults =
    mediaRequested && mediaResponse.query === debounced ? mediaResponse.results : [];
  const mediaLoading = mediaRequested && mediaResponse.query !== debounced;
  const movies = mediaResults.filter((result) => result.mediaType === 'movie');
  const shows = mediaResults.filter((result) => result.mediaType === 'tv');
  const allMovies = movies.slice(0, PREVIEW_RESULT_LIMIT);
  const allShows = shows.slice(0, PREVIEW_RESULT_LIMIT);
  const visibleMedia = filter === 'movie' ? movies : filter === 'tv' ? shows : mediaResults;
  const visiblePeople = filter === 'all' || filter === 'people' ? (people ?? []) : [];
  const allPeople = visiblePeople.slice(0, PREVIEW_RESULT_LIMIT);
  const visibleTags = filter === 'all' || filter === 'tags' ? (publicTags ?? []) : [];
  const allTags = visibleTags.slice(0, PREVIEW_RESULT_LIMIT);
  const loading =
    ready &&
    (filter === 'people'
      ? people === undefined
      : filter === 'tags'
        ? publicTags === undefined
        : filter === 'all'
          ? mediaLoading || people === undefined || publicTags === undefined
          : mediaLoading);
  const hasResults = visibleMedia.length > 0 || visiblePeople.length > 0 || visibleTags.length > 0;
  const searchLabel = 'Search movies, TV shows, people, and tags';

  return (
    <View style={s.root}>
      <SecondaryHeader title="Explore" maxWidth={760} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
        <View style={s.searchField}>
          <Search size={18} color={colors.muted} strokeWidth={1.7} />
          <TextInput
            accessibilityLabel={searchLabel}
            autoCapitalize="none"
            autoCorrect={false}
            value={query}
            onChangeText={setQuery}
            placeholder="Movies, TV shows, people, or tags"
            placeholderTextColor={colors.muted}
            returnKeyType="search"
            style={s.searchInput}
          />
        </View>
        <View accessibilityRole="tablist" style={s.filters}>
          {filters.map((entry) => {
            const selected = filter === entry.value;
            return (
              <Pressable
                key={entry.value}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setFilter(entry.value)}
                style={[s.filter, selected && s.filterSelected]}
              >
                <Text style={[s.filterText, selected && s.filterTextSelected]}>{entry.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={s.results}>
          {!ready ? (
            <EmptyState
              title="Search all of Marker"
              detail="Find movies, TV shows, people, or public tags."
            />
          ) : loading ? (
            <SearchResultsSkeleton />
          ) : !hasResults ? (
            <EmptyState title="No results" detail="Try a different search." />
          ) : filter === 'all' ? (
            <>
              <ResultSection title="Movies" visible={allMovies.length > 0}>
                {allMovies.map((result) => (
                  <MediaResult key={`movie-${result.id}`} result={result} onPress={openTitle} />
                ))}
              </ResultSection>
              <ResultSection title="TV shows" visible={allShows.length > 0}>
                {allShows.map((result) => (
                  <MediaResult key={`tv-${result.id}`} result={result} onPress={openTitle} />
                ))}
              </ResultSection>
              <ResultSection title="People" visible={allPeople.length > 0}>
                {allPeople.map((person) => (
                  <PersonResult
                    key={person.username}
                    person={person}
                    pending={pendingPeople.has(person.username)}
                    onFollow={() => void updateFollow(person)}
                  />
                ))}
              </ResultSection>
              <ResultSection title="Tags" visible={allTags.length > 0}>
                {allTags.map((tag) => (
                  <PublicTagResult key={tag.tag.toLocaleLowerCase()} tag={tag} />
                ))}
              </ResultSection>
            </>
          ) : filter === 'people' ? (
            visiblePeople.map((person) => (
              <PersonResult
                key={person.username}
                person={person}
                pending={pendingPeople.has(person.username)}
                onFollow={() => void updateFollow(person)}
              />
            ))
          ) : filter === 'tags' ? (
            visibleTags.map((tag) => (
              <PublicTagResult key={tag.tag.toLocaleLowerCase()} tag={tag} />
            ))
          ) : (
            visibleMedia.map((result) => (
              <MediaResult
                key={`${result.mediaType}-${result.id}`}
                result={result}
                onPress={openTitle}
              />
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function PublicTagResult({ tag }: { tag: PublicTag }) {
  return (
    <NativePressable
      accessibilityRole="button"
      accessibilityLabel={`Explore ${tag.tag} tag`}
      onPress={() => router.push({ pathname: '/tag/[tag]', params: { tag: tag.tag } })}
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
      <ChevronRight size={17} color={colors.muted} strokeWidth={1.7} />
    </NativePressable>
  );
}

function ResultSection({
  title,
  visible,
  children,
}: {
  title: string;
  visible: boolean;
  children: React.ReactNode;
}) {
  if (!visible) return null;
  return (
    <View style={s.resultSection}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function MediaResult({
  result,
  onPress,
}: {
  result: SearchResult;
  onPress: (result: SearchResult) => void;
}) {
  return (
    <NativePressable
      accessibilityRole="button"
      accessibilityLabel={`View ${result.title}`}
      onPress={() => onPress(result)}
      style={s.mediaResult}
      pressedStyle={s.pressed}
    >
      <PosterImage path={result.posterPath} title={result.title} style={s.poster} />
      <View style={s.resultCopy}>
        <Text numberOfLines={2} style={s.resultTitle}>
          {result.title}
        </Text>
        <Text style={s.resultMeta}>
          {result.releaseDate?.slice(0, 4) || '—'} ·{' '}
          {result.mediaType === 'movie' ? 'Movie' : 'TV Show'}
          {result.voteAverage ? ` · ${result.voteAverage.toFixed(1)}` : ''}
        </Text>
      </View>
      <View style={s.addIcon}>
        <Plus size={18} color={colors.bg} strokeWidth={2} />
      </View>
    </NativePressable>
  );
}

function PersonResult({
  person,
  pending,
  onFollow,
}: {
  person: Person;
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
        onPress={() => router.push(`/u/${person.username}`)}
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
        <ChevronRight size={17} color={colors.muted} strokeWidth={1.7} />
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

const s = createStyles({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 104,
    paddingBottom: 72,
  },
  searchField: {
    height: 54,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.surface,
    paddingLeft: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    height: 52,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: colors.text,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  tagResult: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
  },
  tagPosters: { width: 92, height: 68, flexDirection: 'row', alignItems: 'center' },
  tagPoster: {
    width: 42,
    height: 63,
    borderRadius: 7,
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
  results: { minHeight: 320, paddingTop: 12 },
  resultSection: { marginTop: 10 },
  sectionTitle: { color: colors.text, fontSize: 13, fontWeight: '700', marginBottom: 4 },
  mediaResult: {
    minHeight: 114,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
  },
  poster: { width: 58, height: 87, borderRadius: 8 },
  resultCopy: { flex: 1, minWidth: 0 },
  resultTitle: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '700' },
  resultMeta: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 5 },
  addIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  personResult: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderColor: colors.border,
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
  personName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  followButton: {
    minWidth: 82,
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followButtonPrimary: { backgroundColor: colors.text, borderColor: colors.text },
  followText: { color: colors.text, fontSize: 10, fontWeight: '700' },
  followTextPrimary: { color: colors.bg },
  pressed: { opacity: 0.62 },
});
