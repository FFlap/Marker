import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useMutation, useQuery } from 'convex/react';
import { Check, EllipsisVertical, SlidersHorizontal, Star } from 'lucide-react-native';
import { api } from '../../../convex/_generated/api';
import { EpisodePageSkeleton } from '@/components/PageSkeletons';
import { NativePressable } from '@/components/ui/NativePressable';
import type { Id } from '../../../convex/_generated/dataModel';
import type { AppDrawerHandle } from '@/components/AppDrawer';
import { Chip, EmptyState } from '@/components/ui/primitives';
import { RatingControl, TagEditor } from '@/components/ui/library-controls';
import { useToast } from '@/components/ui/Toast';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';
import { ScreenErrorBoundary } from '@/components/ScreenErrorBoundary';
import { MobileNav } from '@/components/MobileNav';
import { TabHeader } from '@/components/TabHeader';

type EpisodeHubItem = {
  itemId: Id<'items'>;
  title: string;
  posterPath?: string;
  isAnime: boolean;
  season: number;
  episode: number;
  name: string;
  overview?: string;
  runtime?: number;
  imageUrl?: string;
  airDate?: string;
  seasonName?: string;
  rating?: number;
  tags: string[];
};

type EpisodeTab = 'watching' | 'favorites';
type ShowFilter = 'all' | 'anime' | 'other';
const EMPTY_EPISODES: EpisodeHubItem[] = [];

const localDateKey = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function useLocalToday() {
  const [today, setToday] = useState(localDateKey);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      setToday(localDateKey());
      const now = new Date();
      const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, Math.max(1_000, nextDay.getTime() - now.getTime() + 100));
    };
    refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, []);
  return today;
}

export default function EpisodesScreen() {
  return (
    <ScreenErrorBoundary message="Couldn’t load your episodes.">
      <Episodes />
    </ScreenErrorBoundary>
  );
}

function Episodes() {
  const today = useLocalToday();
  const overview = useQuery(api.episodeHub.overview, { today }) as
    { watching: EpisodeHubItem[]; favorites: EpisodeHubItem[] } | undefined;
  const setEpisode = useMutation(api.library.episodes.setEpisodeState);
  const toast = useToast();
  const drawerRef = useRef<AppDrawerHandle>(null);
  const [tab, setTab] = useState<EpisodeTab>('watching');
  const [search, setSearch] = useState('');
  const [showFilter, setShowFilter] = useState<ShowFilter>('all');
  const [minimumRating, setMinimumRating] = useState(0);
  const [tagFilter, setTagFilter] = useState('all');
  const [expanded, setExpanded] = useState<string>();
  const [editing, setEditing] = useState<EpisodeHubItem>();
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const episodeMutationQueues = useRef(new Map<string, Promise<unknown>>());
  const [draftRating, setDraftRating] = useState<number>();
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const episodes = overview?.[tab] ?? EMPTY_EPISODES;
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
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return episodes.filter(
      (episode) =>
        (!needle ||
          episode.title.toLocaleLowerCase().includes(needle) ||
          episode.name.toLocaleLowerCase().includes(needle)) &&
        (showFilter === 'all' || (showFilter === 'anime' ? episode.isAnime : !episode.isAnime)) &&
        (tab !== 'favorites' || (episode.rating ?? 0) >= minimumRating) &&
        (tab !== 'favorites' ||
          tagFilter === 'all' ||
          episode.tags.some((tag) => tag.toLocaleLowerCase() === tagFilter)),
    );
  }, [episodes, minimumRating, search, showFilter, tab, tagFilter]);
  const filterActive =
    showFilter !== 'all' || (tab === 'favorites' && (minimumRating > 0 || tagFilter !== 'all'));

  const openEpisode = (episode: EpisodeHubItem) => {
    setEditing(episode);
    setDraftRating(episode.rating);
    setDraftTags(episode.tags);
  };
  const updateEpisode = async (
    episode: EpisodeHubItem,
    patch: { watched?: boolean; rating?: number; clearRating?: boolean; tags?: string[] },
  ) => {
    const key = `${episode.itemId}:${episode.season}:${episode.episode}`;
    setPending((current) => new Set(current).add(key));
    const previous = episodeMutationQueues.current.get(key) ?? Promise.resolve();
    const request = previous
      .catch(() => undefined)
      .then(() =>
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
          ...patch,
        }),
      );
    episodeMutationQueues.current.set(key, request);
    try {
      await request;
      return true;
    } catch {
      toast.show('Couldn’t update this episode');
      return false;
    } finally {
      if (episodeMutationQueues.current.get(key) === request) {
        episodeMutationQueues.current.delete(key);
        setPending((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    }
  };

  return (
    <View style={s.root}>
      <View style={s.toolbar}>
        <TabHeader
          ref={drawerRef}
          current="episodes"
          maxWidth={940}
          accessibilityLabel={`Search ${tab} episodes`}
          value={search}
          onChangeText={setSearch}
          placeholder={tab === 'watching' ? 'Search next episodes' : 'Search favorites'}
          returnKeyType="search"
          trailing={
            <Drawer>
              <DrawerTrigger asChild>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Filter ${tab} episodes`}
                  style={[s.filterButton, filterActive && s.filterActive]}
                >
                  <SlidersHorizontal size={18} color={colors.text} strokeWidth={1.8} />
                  {filterActive && <View style={s.activeDot} />}
                </Pressable>
              </DrawerTrigger>
              <DrawerContent className="max-w-md gap-6 rounded-2xl border-border bg-background p-6">
                <DrawerHeader>
                  <DrawerTitle>Episode filters</DrawerTitle>
                </DrawerHeader>
                <View style={s.filterGroup}>
                  <Text style={s.filterLabel}>SHOW TYPE</Text>
                  <View style={s.chips}>
                    <Chip
                      label="All"
                      selected={showFilter === 'all'}
                      onPress={() => setShowFilter('all')}
                    />
                    <Chip
                      label="Anime"
                      selected={showFilter === 'anime'}
                      onPress={() => setShowFilter('anime')}
                    />
                    <Chip
                      label="Other TV"
                      selected={showFilter === 'other'}
                      onPress={() => setShowFilter('other')}
                    />
                  </View>
                </View>
                {tab === 'favorites' && (
                  <>
                    <View style={s.filterGroup}>
                      <Text style={s.filterLabel}>MINIMUM RATING</Text>
                      <View style={s.chips}>
                        {[0, 8, 9, 10].map((rating) => (
                          <Chip
                            key={rating}
                            label={rating ? `${rating}+` : 'Any'}
                            selected={minimumRating === rating}
                            onPress={() => setMinimumRating(rating)}
                          />
                        ))}
                      </View>
                    </View>
                    <View style={s.filterGroup}>
                      <Text style={s.filterLabel}>TAGS</Text>
                      <View style={s.chips}>
                        <Chip
                          label="All tags"
                          selected={tagFilter === 'all'}
                          onPress={() => setTagFilter('all')}
                        />
                        {favoriteTags.map((tag) => (
                          <Chip
                            key={tag}
                            label={tag}
                            selected={tagFilter === tag.toLocaleLowerCase()}
                            onPress={() => setTagFilter(tag.toLocaleLowerCase())}
                          />
                        ))}
                      </View>
                    </View>
                  </>
                )}
              </DrawerContent>
            </Drawer>
          }
        />
      </View>

      <ScrollView contentContainerStyle={s.content}>
        <View accessibilityRole="tablist" style={s.tabs}>
          {(['watching', 'favorites'] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="tab"
              accessibilityLabel={value === 'watching' ? 'Watching' : 'Favorites'}
              accessibilityState={{ selected: tab === value }}
              onPress={() => {
                setTab(value);
                setSearch('');
                setShowFilter('all');
                setMinimumRating(0);
                setTagFilter('all');
                setExpanded(undefined);
              }}
              style={[s.tab, tab === value && s.tabActive]}
            >
              <Text style={[s.tabText, tab === value && s.tabTextActive]}>
                {value === 'watching' ? 'Watching' : 'Favorites'}
              </Text>
            </Pressable>
          ))}
        </View>

        {overview === undefined ? (
          <EpisodePageSkeleton />
        ) : filtered.length ? (
          <View style={s.list}>
            {filtered.map((episode) => {
              const key = `${episode.itemId}:${episode.season}:${episode.episode}`;
              const isExpanded = expanded === key;
              return (
                <View key={key} style={s.episodeCard}>
                  <View style={s.episodeRow}>
                    <View style={s.artwork}>
                      {episode.imageUrl ? (
                        <Image
                          source={episode.imageUrl}
                          accessibilityLabel={`${episode.name} artwork`}
                          contentFit="cover"
                          style={s.image}
                        />
                      ) : (
                        <View style={s.imageFallback} />
                      )}
                    </View>
                    <NativePressable
                      accessibilityRole="button"
                      accessibilityLabel={`View ${episode.title}, episode ${episode.episode}`}
                      accessibilityState={{ expanded: isExpanded }}
                      onPress={() => setExpanded(isExpanded ? undefined : key)}
                      style={s.copy}
                    >
                      <View style={s.showHeader}>
                        <Text numberOfLines={1} style={s.showTitle}>
                          {episode.title}
                        </Text>
                        {tab === 'favorites' && episode.rating !== undefined && (
                          <View
                            accessibilityLabel={`Rated ${episode.rating} out of 10`}
                            style={s.inlineRating}
                          >
                            <Star size={11} color={colors.muted} fill={colors.muted} />
                            <Text style={s.metaText}>{episode.rating.toFixed(1)}</Text>
                          </View>
                        )}
                      </View>
                      <Text numberOfLines={2} style={s.episodeTitle}>
                        {episode.name}
                      </Text>
                      {!!episode.overview && !isExpanded && (
                        <Text numberOfLines={2} style={s.episodeOverview}>
                          {episode.overview}
                        </Text>
                      )}
                    </NativePressable>
                    <NativePressable
                      accessibilityRole={tab === 'watching' ? 'checkbox' : 'button'}
                      accessibilityLabel={
                        tab === 'watching'
                          ? `Mark ${episode.title} episode ${episode.episode} watched`
                          : `${episode.title} episode ${episode.episode} options`
                      }
                      accessibilityState={
                        tab === 'watching'
                          ? { checked: false, disabled: pending.has(key) }
                          : { disabled: pending.has(key) }
                      }
                      disabled={pending.has(key)}
                      onPress={() => {
                        if (tab === 'watching') {
                          void updateEpisode(episode, { watched: true });
                        } else {
                          openEpisode(episode);
                        }
                      }}
                      hitSlop={8}
                      style={s.check}
                      pressedStyle={s.pressed}
                    >
                      {tab === 'watching' ? (
                        <Check size={17} color={colors.text} strokeWidth={2} />
                      ) : (
                        <EllipsisVertical size={15} color={colors.muted} strokeWidth={1.8} />
                      )}
                    </NativePressable>
                  </View>
                  {isExpanded && (
                    <View style={s.episodeDetails}>
                      {!!episode.overview && <Text style={s.fullOverview}>{episode.overview}</Text>}
                      <View style={s.episodeFacts}>
                        <Text style={s.episodeFact}>
                          EP {episode.episode.toString().padStart(2, '0')}
                        </Text>
                        {!!episode.runtime && (
                          <Text style={s.episodeFact}>{episode.runtime} min</Text>
                        )}
                        {!!episode.airDate && (
                          <Text style={s.episodeFact}>Aired {episode.airDate}</Text>
                        )}
                      </View>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        ) : (
          <EmptyState
            title={tab === 'watching' ? 'Nothing queued' : 'No favorite episodes yet'}
            detail={
              search || filterActive
                ? 'Try clearing your search or filters.'
                : tab === 'watching'
                  ? 'Move a series into Watching to track its next episode here.'
                  : 'Rate watched episodes and your highest scores will appear here.'
            }
          />
        )}
      </ScrollView>

      <Drawer open={editing !== undefined} onOpenChange={(open) => !open && setEditing(undefined)}>
        {editing && (
          <DrawerContent className="max-w-lg gap-6 rounded-2xl border-border bg-background p-6">
            <DrawerHeader className="sr-only">
              <DrawerTitle>Episode options</DrawerTitle>
            </DrawerHeader>
            <RatingControl
              value={draftRating}
              onChange={(rating) => {
                const previous = draftRating;
                setDraftRating(rating);
                void updateEpisode(
                  editing,
                  rating === undefined ? { clearRating: true } : { rating },
                ).then((saved) => {
                  if (!saved) setDraftRating(previous);
                });
              }}
            />
            <TagEditor
              tags={draftTags}
              suggestions={favoriteTags}
              onChange={(tags) => {
                const previous = draftTags;
                setDraftTags(tags);
                void updateEpisode(editing, { tags }).then((saved) => {
                  if (!saved) setDraftTags(previous);
                });
              }}
            />
            {tab === 'favorites' && (
              <Pressable
                accessibilityRole="button"
                onPress={() => void updateEpisode(editing, { watched: false })}
                style={s.textAction}
              >
                <Text style={s.textActionLabel}>Mark episode unwatched</Text>
              </Pressable>
            )}
          </DrawerContent>
        )}
      </Drawer>
      <MobileNav current="episodes" />
    </View>
  );
}

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
    filterButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    filterActive: {},
    activeDot: {
      position: 'absolute',
      right: 5,
      top: 5,
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.text,
    },
    content: {
      width: '100%',
      maxWidth: 940,
      alignSelf: 'center',
      paddingHorizontal: 20,
      paddingTop: 76,
      paddingBottom: 128,
      minHeight: '100%',
    },
    tabs: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderColor: colors.border,
      marginBottom: 8,
      width: '100%',
    },
    tab: {
      flex: 1,
      minHeight: 56,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabActive: { borderBottomWidth: 2, borderColor: colors.text },
    tabText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
    tabTextActive: { color: colors.text },
    list: { gap: 0 },
    episodeCard: {
      borderBottomWidth: 1,
      borderColor: colors.border,
      paddingVertical: 14,
    },
    episodeRow: {
      minHeight: 78,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    artwork: {
      width: 112,
      height: 64,
      borderRadius: 10,
      overflow: 'hidden',
      backgroundColor: colors.surface,
    },
    image: { width: '100%', height: '100%' },
    imageFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    copy: { flex: 1, minWidth: 0, minHeight: 64, justifyContent: 'center' },
    showHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
    showTitle: {
      flexShrink: 1,
      minWidth: 0,
      color: colors.muted,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.7,
    },
    episodeTitle: { color: colors.text, fontSize: 14, lineHeight: 18, fontWeight: '600' },
    episodeOverview: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 4 },
    metaText: { color: colors.muted, fontSize: 9 },
    inlineRating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    check: {
      width: 28,
      height: 28,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: { opacity: 0.62 },
    episodeDetails: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      gap: 10,
      marginTop: 10,
    },
    fullOverview: { color: colors.text, fontSize: 13, lineHeight: 20 },
    episodeFacts: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
    episodeFact: { color: colors.muted, fontSize: 11 },
    filterGroup: { gap: 10 },
    filterLabel: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    textAction: { minHeight: 44, justifyContent: 'center' },
    textActionLabel: { color: colors.text, fontSize: 13, fontWeight: '600' },
  },
  [
    'tabText',
    'tabTextActive',
    'showTitle',
    'episodeTitle',
    'episodeOverview',
    'metaText',
    'fullOverview',
    'episodeFact',
    'filterLabel',
    'textActionLabel',
  ] as const,
);
