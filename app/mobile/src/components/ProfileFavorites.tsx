import { createElement, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery } from 'convex/react';
import { Plus, X } from 'lucide-react-native';
import DraggableFlatList, { type RenderItemParams } from 'react-native-draggable-flatlist';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { PosterImage } from '@/components/ui/PosterImage';
import { NativePressable } from '@/components/ui/NativePressable';
import { useToast } from '@/components/ui/Toast';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Input } from '@/components/ui/primitives';
import { colors } from '@/constants/colors';
import { createStyles } from '@/lib/typography';

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
  { section: 'tv', title: 'TV Shows', singular: 'TV show' },
  { section: 'anime', title: 'Anime', singular: 'anime' },
  { section: 'movie', title: 'Movies', singular: 'movie' },
];

const favoriteSection = (favorite: Pick<ProfileFavorite, 'isAnime' | 'mediaType'>) =>
  favorite.isAnime ? 'anime' : favorite.mediaType;

const sectionLabel = (section: FavoriteSection) =>
  section === 'tv' ? 'TV show' : section === 'anime' ? 'anime' : 'movie';

function WebDraggable({
  children,
  index,
  section,
  enabled,
  onDrop,
}: {
  children: ReactNode;
  index: number;
  section: FavoriteSection;
  enabled: boolean;
  onDrop: (from: number, to: number) => void;
}) {
  return createElement(
    'div',
    {
      draggable: enabled,
      onDragStart: (event: DragEvent<HTMLDivElement>) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(`text/profile-favorite-${section}-index`, String(index));
      },
      onDragOver: (event: DragEvent<HTMLDivElement>) => enabled && event.preventDefault(),
      onDrop: (event: DragEvent<HTMLDivElement>) => {
        if (!enabled) return;
        event.preventDefault();
        const raw = event.dataTransfer.getData(`text/profile-favorite-${section}-index`);
        if (raw === '') return;
        const from = Number(raw);
        if (Number.isInteger(from)) onDrop(from, index);
      },
      style: { flexShrink: 0 },
    },
    children,
  );
}

export function ProfileFavorites({
  favorites,
  interactive = true,
}: {
  favorites: ProfileFavorite[];
  interactive?: boolean;
}) {
  const [favoriteSearch, setFavoriteSearch] = useState('');
  const [pickerType, setPickerType] = useState<FavoriteSection>();
  const eligible = useQuery(
    api.profileFavorites.eligible,
    interactive && pickerType !== undefined
      ? { search: favoriteSearch.trim() || undefined }
      : 'skip',
  ) as EligibleFavorite[] | undefined;
  const add = useMutation(api.profileFavorites.add);
  const remove = useMutation(api.profileFavorites.remove);
  const reorder = useMutation(api.profileFavorites.reorder);
  const toast = useToast();
  const [pendingId, setPendingId] = useState<string>();
  const [orders, setOrders] = useState<Partial<Record<FavoriteSection, string[]>>>({});
  const reorderPending = useRef(false);
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
    if (reorderPending.current || from === to || !displayed[from]) return;
    const next = [...displayed];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    reorderPending.current = true;
    setOrders((current) => ({ ...current, [section]: next.map((favorite) => favorite._id) }));
    try {
      await reorder({
        itemId: moved!._id,
        beforeId: next[to - 1]?._id,
        afterId: next[to + 1]?._id,
      });
      setOrders((current) => ({ ...current, [section]: undefined }));
    } catch {
      setOrders((current) => ({ ...current, [section]: undefined }));
      toast.show(`Couldn’t save the ${sectionLabel(section)} order`);
    } finally {
      reorderPending.current = false;
    }
  };

  const removeFavorite = async (favorite: ProfileFavorite) => {
    setPendingId(favorite._id);
    try {
      await remove({ itemId: favorite._id });
      setOrders((current) => ({ ...current, [favoriteSection(favorite)]: undefined }));
    } catch {
      toast.show('Couldn’t remove this favorite');
    }
    setPendingId(undefined);
  };

  const addFavorite = async (itemId: Id<'items'>) => {
    if (!pickerType) return;
    setPendingId(itemId);
    try {
      await add({ itemId });
      setOrders((current) => ({ ...current, [pickerType]: undefined }));
      setPickerType(undefined);
    } catch {
      toast.show('Couldn’t add this favorite');
    }
    setPendingId(undefined);
  };

  const card = (favorite: ProfileFavorite, drag?: () => void, active = false) => (
    <View style={[s.card, active && s.cardActive]}>
      <NativePressable
        accessibilityRole="button"
        accessibilityLabel={favorite.title}
        accessibilityHint={
          interactive
            ? Platform.OS === 'web'
              ? 'Drag to reorder this favorite'
              : 'Long press and drag to reorder this favorite'
            : undefined
        }
        onPress={() => router.push(`/item/${favorite._id}`)}
        onLongPress={Platform.OS === 'web' || !interactive ? undefined : drag}
        delayLongPress={220}
        style={s.cardButton}
        pressedStyle={s.pressed}
      >
        <View pointerEvents="none" style={s.posterWrap}>
          <PosterImage path={favorite.posterPath} title={favorite.title} style={s.poster} />
        </View>
        <Text numberOfLines={1} style={s.title}>
          {favorite.title}
        </Text>
      </NativePressable>
      <View pointerEvents="box-none" style={s.cardOverlay}>
        {interactive && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${favorite.title} from favorites`}
            disabled={pendingId === favorite._id}
            onPress={() => void removeFavorite(favorite)}
            hitSlop={8}
            style={s.remove}
          >
            <X size={13} color={colors.text} strokeWidth={2} />
          </Pressable>
        )}
      </View>
    </View>
  );

  const pickerItems = eligible?.filter((item) => favoriteSection(item) === pickerType);

  return (
    <View style={s.favorites}>
      {sections.map(({ section, title, singular }) => {
        const displayed = displayedFor(section);
        return (
          <View key={section} style={s.section}>
            <View style={s.sectionHeader}>
              <View style={s.sectionTitleRow}>
                <Text style={s.sectionTitle}>{title}</Text>
                <Text style={s.count}>{displayed.length}</Text>
              </View>
              {interactive && (
                <NativePressable
                  accessibilityRole="button"
                  accessibilityLabel={`Add favorite ${singular}`}
                  onPress={() => {
                    setFavoriteSearch('');
                    setPickerType(section);
                  }}
                  hitSlop={6}
                  style={s.addButton}
                  pressedStyle={s.pressed}
                >
                  <Plus size={14} color={colors.text} strokeWidth={2} />
                  <Text style={s.addText}>Add</Text>
                </NativePressable>
              )}
            </View>

            {displayed.length ? (
              Platform.OS === 'web' ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={s.rail}
                >
                  {displayed.map((favorite, index) => (
                    <WebDraggable
                      key={favorite._id}
                      index={index}
                      section={section}
                      enabled={interactive && !pendingId}
                      onDrop={(from, to) => void move(section, from, to)}
                    >
                      {card(favorite)}
                    </WebDraggable>
                  ))}
                </ScrollView>
              ) : (
                <DraggableFlatList
                  horizontal
                  data={displayed}
                  keyExtractor={(favorite) => favorite._id}
                  onDragEnd={({ data, from, to }) => {
                    setOrders((current) => ({
                      ...current,
                      [section]: data.map((favorite) => favorite._id),
                    }));
                    void move(section, from, to);
                  }}
                  renderItem={({ item, drag, isActive }: RenderItemParams<ProfileFavorite>) =>
                    card(item, drag, isActive)
                  }
                  contentContainerStyle={s.rail}
                  showsHorizontalScrollIndicator={false}
                />
              )
            ) : (
              <View style={s.empty}>
                <Text style={s.emptyText}>No favorite {title.toLowerCase()} yet.</Text>
              </View>
            )}
          </View>
        );
      })}

      <Drawer
        open={pickerType !== undefined}
        onOpenChange={(open) => !open && setPickerType(undefined)}
      >
        {pickerType !== undefined && (
          <DrawerContent className="max-w-xl gap-5 rounded-2xl border-border bg-background p-6">
            <DrawerHeader>
              <DrawerTitle>Add {sectionLabel(pickerType)}</DrawerTitle>
            </DrawerHeader>
            <Input
              accessibilityLabel="Search watched titles"
              value={favoriteSearch}
              onChangeText={setFavoriteSearch}
              placeholder="Search watched titles"
              returnKeyType="search"
            />
            <ScrollView style={s.picker} contentContainerStyle={s.pickerContent}>
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
                    <Plus size={17} color={colors.text} />
                  </NativePressable>
                ))
              ) : (
                <Text style={s.emptyText}>
                  {favoriteSearch.trim()
                    ? 'No matching watched titles are available.'
                    : `No more watched ${pickerType === 'tv' ? 'TV shows' : pickerType} are available.`}
                </Text>
              )}
            </ScrollView>
          </DrawerContent>
        )}
      </Drawer>
    </View>
  );
}

const s = createStyles({
  favorites: { gap: 38 },
  section: { gap: 16 },
  sectionHeader: {
    minHeight: 38,
    borderBottomWidth: 1,
    borderColor: colors.border,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, minWidth: 0 },
  sectionTitle: { color: colors.text, fontSize: 13, fontWeight: '700', letterSpacing: 0.1 },
  count: { color: colors.muted, fontSize: 11, fontVariant: ['tabular-nums'] },
  addButton: {
    minHeight: 32,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  addText: { color: colors.text, fontSize: 11, fontWeight: '700' },
  rail: { gap: 14, paddingRight: 20 },
  card: { width: 124, position: 'relative' },
  cardActive: { opacity: 0.72, transform: [{ scale: 1.025 }] },
  cardButton: { width: 124, gap: 8 },
  cardOverlay: { position: 'absolute', inset: 0 },
  posterWrap: { width: 124, height: 186, position: 'relative' },
  poster: { width: 124, height: 186, borderRadius: 8 },
  remove: {
    position: 'absolute',
    right: 7,
    top: 7,
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: 'rgba(10,10,11,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  pressed: { opacity: 0.64 },
  empty: {
    minHeight: 92,
    borderBottomWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    flexDirection: 'row',
  },
  emptyText: { flexShrink: 1, color: colors.muted, fontSize: 12, lineHeight: 18 },
  picker: { maxHeight: 440 },
  pickerContent: { gap: 4 },
  pickerRow: {
    minHeight: 76,
    borderBottomWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 8,
  },
  pickerPoster: { width: 40, height: 60, borderRadius: 4 },
  pickerTitle: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '700' },
  loader: { minHeight: 120 },
});
