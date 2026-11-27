import * as Effect from 'effect/Effect';
import { saveLibrary } from '@marker/shared/clientEffects';
import { useOperation } from '@/hooks/use-operation';
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery } from 'convex/react';
import Plus from 'lucide-react-native/icons/plus';
import Minus from 'lucide-react-native/icons/minus';
import DraggableFlatList, { type RenderItemParams } from 'react-native-draggable-flatlist';
import { api } from '@marker/shared/api';
import type { Id } from '@marker/shared/dataModel';
import { PosterCaption } from '@/components/ui/PosterCaption';
import { PosterImage } from '@/components/ui/PosterImage';
import { NativePressable } from '@/components/ui/NativePressable';
import { useToast } from '@/components/ui/Toast';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerScrollView,
  DrawerTitle,
} from '@/components/ui/drawer';
import { SearchField, SectionHeading, TextAction } from '@/components/ui/primitives';
import { colors } from '@/constants/colors';
import { radius, typeRamp } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';
import { compareTitles } from '@/lib/text';

type MediaType = 'movie' | 'tv';
type FavoriteSection = MediaType | 'anime';

export type ProfileFavorite = {
  _id: Id<'items'>;
  title: string;
  mediaType: MediaType;
  isAnime: boolean;
  posterPath?: string;
  rank: number;
};

type EligibleFavorite = Omit<ProfileFavorite, 'rank'>;

const sections: { section: FavoriteSection; title: string; singular: string }[] = [
  { section: 'tv', title: 'TV shows', singular: 'TV show' },
  { section: 'anime', title: 'Anime', singular: 'anime' },
  { section: 'movie', title: 'Movies', singular: 'movie' },
];

const favoriteSection = (favorite: Pick<ProfileFavorite, 'isAnime' | 'mediaType'>) =>
  favorite.isAnime ? 'anime' : favorite.mediaType;

const sectionLabel = (section: FavoriteSection) =>
  section === 'tv' ? 'TV show' : section === 'anime' ? 'anime' : 'movie';

export function ProfileFavorites({
  favorites,
  interactive = true,
}: {
  favorites: ProfileFavorite[];
  interactive?: boolean;
}) {
  const runOperation = useOperation();
  const [favoriteSearch, setFavoriteSearch] = useState('');
  // The picker's list fills the sheet below its title and search field (about 220dp).
  const { height: windowHeight } = useWindowDimensions();
  const pickerListHeight = Math.max(240, Math.round(windowHeight * 0.92 - 220));
  const [pickerType, setPickerType] = useState<FavoriteSection>();
  const eligible = useQuery(
    api.profileFavorites.eligible,
    interactive && pickerType !== undefined
      ? { search: favoriteSearch.trim() || undefined, section: pickerType }
      : 'skip',
  ) as EligibleFavorite[] | undefined;
  const add = useMutation(api.profileFavorites.add);
  const remove = useMutation(api.profileFavorites.remove);
  const reorder = useMutation(api.profileFavorites.reorder);
  const toast = useToast();
  const [pendingId, setPendingId] = useState<string>();
  const [orders, setOrders] = useState<Partial<Record<FavoriteSection, string[]>>>({});
  const reorderPending = useRef<'idle' | 'pending'>('idle');
  const persisted = useMemo(
    () => [...favorites].sort((left, right) => left.rank - right.rank),
    [favorites],
  );

  const displayedFor = (section: FavoriteSection) => {
    const group = persisted.filter((favorite) => favoriteSection(favorite) === section);
    const order = orders[section];
    if (
      !order ||
      order.length !== group.length ||
      order.some((id) => !group.some((item) => item._id === id))
    ) {
      return group;
    }
    return order
      .map((id) => group.find((favorite) => favorite._id === id))
      .filter((favorite): favorite is ProfileFavorite => favorite !== undefined);
  };

  const move = async (section: FavoriteSection, from: number, to: number) => {
    const displayed = displayedFor(section);
    if (reorderPending.current === 'pending') return;
    if (from === to || !displayed[from]) return;
    const next = [...displayed];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    reorderPending.current = 'pending';
    setOrders((current) => ({ ...current, [section]: next.map((favorite) => favorite._id) }));
    await runOperation.write(
      Effect.gen(function* () {
        yield* saveLibrary(() =>
          reorder({
            itemId: moved!._id,
            beforeId: next[to - 1]?._id,
            afterId: next[to + 1]?._id,
          }),
        );
      }),
      {
        success: () => {
          setOrders((current) => ({ ...current, [section]: undefined }));
        },

        failure: () => {
          setOrders((current) => ({ ...current, [section]: undefined }));
          toast.show(`Couldn’t save the ${sectionLabel(section)} order`);
        },
        settled: () => {
          reorderPending.current = 'idle';
        },
      },
    );
  };

  const removeFavorite = async (favorite: ProfileFavorite) => {
    setPendingId(favorite._id);
    await runOperation.write(
      Effect.gen(function* () {
        yield* saveLibrary(() => remove({ itemId: favorite._id }));
      }),
      {
        success: () => {
          setOrders((current) => ({ ...current, [favoriteSection(favorite)]: undefined }));
        },

        failure: () => {
          toast.show('Couldn’t remove this favorite');
        },
        settled: () => {
          setPendingId(undefined);
        },
      },
    );
  };

  const addFavorite = async (itemId: Id<'items'>) => {
    if (!pickerType) return;
    setPendingId(itemId);
    await runOperation.write(
      Effect.gen(function* () {
        yield* saveLibrary(() => add({ itemId }));
      }),
      {
        success: () => {
          setOrders((current) => ({ ...current, [pickerType]: undefined }));
        },

        failure: () => {
          toast.show('Couldn’t add this favorite');
        },
        settled: () => {
          setPendingId(undefined);
        },
      },
    );
  };

  const card = (
    favorite: ProfileFavorite,
    drag?: () => void,
    active = false,
    // Where it sits on its shelf, for the screen-reader "Move earlier / later" actions.
    place?: { section: FavoriteSection; index: number; count: number },
  ) => (
    <View style={[s.card, active && s.cardActive]}>
      <NativePressable
        accessibilityRole="button"
        accessibilityLabel={favorite.title}
        accessibilityHint={interactive ? 'Long press and drag to reorder this favorite' : undefined}
        accessibilityActions={
          interactive && place
            ? [
                ...(place.index > 0 ? [{ name: 'moveEarlier', label: 'Move earlier' }] : []),
                ...(place.index < place.count - 1
                  ? [{ name: 'moveLater', label: 'Move later' }]
                  : []),
              ]
            : undefined
        }
        onAccessibilityAction={(event) => {
          if (!place) return;
          const step = event.nativeEvent.actionName === 'moveEarlier' ? -1 : 1;
          void move(place.section, place.index, place.index + step);
        }}
        onPress={() => router.push(`/item/${favorite._id}`)}
        onLongPress={!interactive ? undefined : drag}
        delayLongPress={220}
        style={s.cardButton}
        pressedStyle={s.pressed}
      >
        <View pointerEvents="none" style={s.posterWrap}>
          <PosterImage path={favorite.posterPath} title={favorite.title} style={s.poster} />
        </View>
        {/* Measured like library captions: two lines ending at a whole word. */}
        <PosterCaption
          title={favorite.title}
          textStyle={s.title}
          boxStyle={captionBox}
          ellipsisFontSize={13}
        />
      </NativePressable>
    </View>
  );

  const pickerItems = eligible
    ?.filter((item) => favoriteSection(item) === pickerType)
    // The library's A–Z order (【OSHI NO KO】 under O).
    .sort((left, right) => compareTitles(left.title, right.title));
  // Searching found nothing new to add (either group may still have matches).
  const noWatchedMatches =
    !!favoriteSearch.trim() && eligible !== undefined && !pickerItems?.length;
  // The search narrows both groups, so a favorite to remove is as easy to find as one to add.
  // Every typed word appears in the title, the same rule the search uses for titles to add.
  const favoriteWords = favoriteSearch.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const currentFavorites = (pickerType ? displayedFor(pickerType) : []).filter((favorite) =>
    favoriteWords.every((word) => favorite.title.toLocaleLowerCase().includes(word)),
  );

  return (
    <View style={s.favorites}>
      {/* One heading for the shelves, so they read as favorites, not a library breakdown. */}
      <SectionHeading title="Favorites" />
      {sections.map(({ section, title, singular }) => {
        const displayed = displayedFor(section);
        return (
          <View key={section} style={s.section}>
            <View style={s.shelfHead}>
              <Text accessibilityRole="header" style={s.shelfTitle}>
                {title}
                {displayed.length > 0 && (
                  <Text style={s.shelfCount}>{`  ${displayed.length}`}</Text>
                )}
              </Text>
              {interactive && (
                <TextAction
                  title={displayed.length ? 'Edit' : 'Add'}
                  icon={displayed.length ? undefined : Plus}
                  accessibilityLabel={
                    displayed.length ? `Edit favorite ${title}` : `Add favorite ${singular}`
                  }
                  onPress={() => {
                    setFavoriteSearch('');
                    setPickerType(section);
                  }}
                />
              )}
            </View>

            {displayed.length ? (
              <View style={s.railShell}>
                <DraggableFlatList
                  horizontal
                  data={displayed}
                  keyExtractor={(favorite) => favorite._id}
                  onDragEnd={({ from, to }) => void move(section, from, to)}
                  renderItem={({
                    item,
                    drag,
                    isActive,
                    getIndex,
                  }: RenderItemParams<ProfileFavorite>) =>
                    card(item, drag, isActive, {
                      section,
                      index: getIndex() ?? displayed.indexOf(item),
                      count: displayed.length,
                    })
                  }
                  contentContainerStyle={s.rail}
                  showsHorizontalScrollIndicator={false}
                />
              </View>
            ) : interactive ? null : (
              <Text style={s.emptyText}>None yet</Text>
            )}
          </View>
        );
      })}

      <Drawer
        open={pickerType !== undefined}
        onOpenChange={(open) => !open && setPickerType(undefined)}
      >
        {pickerType !== undefined && (
          <DrawerContent className="max-w-xl">
            <DrawerHeader>
              <DrawerTitle>
                Favorite {sections.find((entry) => entry.section === pickerType)?.title}
              </DrawerTitle>
            </DrawerHeader>
            <SearchField
              accessibilityLabel="Search titles"
              value={favoriteSearch}
              onChangeText={setFavoriteSearch}
              placeholder="Search titles"
              containerStyle={s.pickerSearch}
            />
            {/* A list of fixed height under a pinned search field, so the sheet (and the field
                being typed in) stays put however many titles match. */}
            <DrawerScrollView
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              style={{ height: pickerListHeight }}
              contentContainerStyle={s.pickerContent}
            >
              {currentFavorites.length > 0 && (
                <>
                  <Text style={s.pickerGroup}>Your favorites</Text>
                  {currentFavorites.map((favorite) => (
                    <View key={favorite._id} style={s.pickerRow}>
                      <PosterImage
                        path={favorite.posterPath}
                        title={favorite.title}
                        style={s.pickerPoster}
                      />
                      <Text numberOfLines={2} style={s.pickerTitle}>
                        {favorite.title}
                      </Text>
                      <NativePressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${favorite.title} from favorites`}
                        disabled={pendingId === favorite._id}
                        onPress={() => void removeFavorite(favorite)}
                        // A 48dp target around the 32dp mark, like the whole add row.
                        hitSlop={8}
                        style={s.pickerAction}
                        pressedStyle={s.addPressed}
                      >
                        <Minus size={20} color={colors.text} strokeWidth={2} />
                      </NativePressable>
                    </View>
                  ))}
                  {/* A search that only matches favorites doesn't leave an empty section. */}
                  {!noWatchedMatches && (
                    <Text style={[s.pickerGroup, s.pickerGroupNext]}>Add from watched</Text>
                  )}
                </>
              )}
              {eligible === undefined ? (
                <ActivityIndicator color={colors.muted} style={s.loader} />
              ) : pickerItems?.length ? (
                pickerItems.map((item) => (
                  <NativePressable
                    key={item._id}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${item.title} to favorites`}
                    disabled={pendingId === item._id}
                    onPress={() => void addFavorite(item._id)}
                    style={s.pickerRow}
                    pressedStyle={s.pressed}
                  >
                    <PosterImage path={item.posterPath} title={item.title} style={s.pickerPoster} />
                    <Text numberOfLines={2} style={s.pickerTitle}>
                      {item.title}
                    </Text>
                    <View style={s.pickerAction}>
                      <Plus size={20} color={colors.text} strokeWidth={2} />
                    </View>
                  </NativePressable>
                ))
              ) : !noWatchedMatches ? (
                <Text style={s.emptyText}>
                  {`No more watched ${pickerType === 'tv' ? 'TV shows' : pickerType === 'movie' ? 'movies' : 'anime'} are available.`}
                </Text>
              ) : (
                currentFavorites.length === 0 && (
                  <Text style={s.emptyText}>No matching titles.</Text>
                )
              )}
            </DrawerScrollView>
          </DrawerContent>
        )}
      </Drawer>
    </View>
  );
}

const s = createAppStyles(
  {
    favorites: { gap: 16 },
    section: { gap: 12 },
    shelfHead: {
      minHeight: 28,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    shelfTitle: { ...typeRamp.label, color: colors.secondary, flexShrink: 1 },
    shelfCount: { color: colors.muted, fontWeight: '500' },

    addPressed: { backgroundColor: colors.borderStrong },
    railShell: { marginHorizontal: -20 },
    rail: { gap: 12, paddingHorizontal: 20 },
    card: { width: 112, position: 'relative' },
    cardActive: { opacity: 0.72, transform: [{ scale: 1.025 }] },
    cardButton: { width: 112, gap: 8 },
    posterWrap: { width: 112, height: 168, position: 'relative' },
    poster: { width: 112, height: 168, borderRadius: radius.sm },
    title: { color: colors.text, fontSize: 13, lineHeight: 17, fontWeight: '600' },
    pressed: { opacity: 0.64 },

    emptyText: { ...typeRamp.meta },
    pickerSearch: { flex: 0 },
    pickerContent: { gap: 2 },
    pickerRow: {
      minHeight: 60,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      // Flush with the search field and section labels, like other sheets' rows.
      paddingVertical: 6,
      borderRadius: radius.md,
    },
    pickerPoster: { width: 32, height: 48, borderRadius: radius.xs },
    pickerTitle: { ...typeRamp.rowTitle, flex: 1 },
    pickerGroup: {
      ...typeRamp.sectionTitle,
      fontSize: 15,
      paddingVertical: 6,
    },
    pickerGroupNext: { marginTop: 12 },
    // A transparent glyph, like other icon buttons; the target stays 48dp (remove) or the
    // whole row (add).
    pickerAction: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    loader: { minHeight: 120 },
  },
  ['title', 'emptyText', 'pickerTitle', 'pickerGroup', 'shelfTitle'] as const,
);

// Two caption lines (at the rendered line height), so every card in a shelf is the same height.
const captionBox = { minHeight: 2 * (StyleSheet.flatten(s.title).lineHeight ?? 18) };
