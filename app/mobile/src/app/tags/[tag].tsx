import {
  createElement,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { router, type Href, useLocalSearchParams } from 'expo-router';
import { useAction, useMutation, useQuery } from 'convex/react';
import {
  NestableDraggableFlatList,
  NestableScrollContainer,
  type RenderItemParams,
  ScaleDecorator,
  ShadowDecorator,
} from 'react-native-draggable-flatlist';
import { ReduceMotion, runOnJS, useAnimatedReaction } from 'react-native-reanimated';
import { EllipsisVertical, Globe2, LockKeyhole, Plus } from 'lucide-react-native';
import { NativePressable } from '@/components/ui/NativePressable';
import { api } from '../../../convex/_generated/api';
import { SecondaryHeader } from '@/components/BackButton';
import { LibraryFiltersDrawer } from '@/components/LibraryFiltersDrawer';
import { PinchDensity } from '@/components/PinchDensity';
import { SkeletonShimmer } from '@/components/SkeletonShimmer';
import { Button, EmptyState, Input } from '@/components/ui/primitives';
import { PosterImage } from '@/components/ui/PosterImage';
import {
  NativeDraggableGrid,
  type NativeGridAutoScroll,
  type NativeGridDragMotion,
} from '@/components/NativeDraggableGrid';
import {
  NativePosterDragPreview,
  type NativePosterDragLayout,
  type NativePosterDragMotion,
} from '@/components/NativePosterDragPreview';
import { useToast } from '@/components/ui/Toast';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { colors } from '@/constants/colors';
import { createStyles } from '@/lib/typography';
import {
  activateWebReorderSession,
  clearWebReorderSession,
  getWebReorderSession,
  positionWebReorder,
  scheduleWebReorder,
  updateWebReorderAutoScroll,
  webReorderIndexAtPoint,
  webStatusDropZoneProps,
} from '@/lib/webReorder';
import {
  DEFAULT_DISPLAY_PREFERENCES,
  gridItemWidth,
  listItemWidth,
  listTypography,
  type GridColumns,
  type ListTextSize,
} from '@/lib/displayPreferences';
import type { LibraryItem, Status } from '@/types';
import {
  LIBRARY_STATUSES,
  matchesMediaType,
  type MediaTypeFilter,
  type StatusFilter,
} from '@/lib/libraryFilters';

type RankedItem = LibraryItem & { tagRank?: number };
type OptimisticTagOrders = {
  tagKey: string;
  orders: Partial<Record<Status, string[]>>;
};

const NATIVE_DRAG_ANIMATION = {
  damping: 26,
  stiffness: 260,
  mass: 0.7,
  overshootClamping: true,
  reduceMotion: ReduceMotion.System,
};
const TAG_DRAG_LONG_PRESS_MS = 1000;
const TAG_HEADER_HEIGHT = 116;
const WEB_ROW_STYLE: CSSProperties = { width: '100%', minWidth: 0, overflow: 'hidden' };
const categoryAccessibilityActions = LIBRARY_STATUSES.map(([status, label]) => ({
  name: `moveTo:${status}`,
  label: `Move to ${label}`,
}));
const libraryStatusKeys = new Set<Status>(LIBRARY_STATUSES.map(([status]) => status));
const statusFromAccessibilityAction = (name: string) => {
  if (!name.startsWith('moveTo:')) return undefined;
  const target = name.slice('moveTo:'.length) as Status;
  return libraryStatusKeys.has(target) ? target : undefined;
};

export default function TagDetailScreen() {
  const params = useLocalSearchParams<{ tag?: string | string[] }>();
  const tag = Array.isArray(params.tag) ? params.tag[0] : (params.tag ?? '');
  const tagKey = tag.trim().toLocaleLowerCase();
  const library = useQuery(api.library.listItems);
  const ranks = useQuery(api.library.listTagRanks, tag ? { tag } : 'skip');
  const settings = useQuery(api.settings.getSettings);
  const setSettings = useMutation(api.settings.setSettings);
  const reorderItem = useMutation(api.library.reorderItem);
  const reorderTagItem = useMutation(api.library.reorderTagItem);
  const moveItemToWatched = useAction(api.library.moveItemToWatched);
  const tagVisibility = useQuery(api.tags.visibility, tag ? { tag } : 'skip');
  const setTagVisibility = useMutation(api.tags.setVisibility);
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [type, setType] = useState<MediaTypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [minimumRating, setMinimumRating] = useState(0);
  const [visibilityPending, setVisibilityPending] = useState(false);
  const [statusMovePending, setStatusMovePending] = useState(false);
  const statusMovePendingRef = useRef(false);
  const [pendingWatchedMove, setPendingWatchedMove] = useState<RankedItem>();
  const [optimisticStatuses, setOptimisticStatuses] = useState<Record<string, Status>>({});
  useEffect(() => {
    if (!library) return;
    const timer = setTimeout(
      () =>
        setOptimisticStatuses((current) => {
          let changed = false;
          const next = { ...current };
          for (const [itemId, status] of Object.entries(current)) {
            if (library.find((item) => String(item._id) === itemId)?.status === status) {
              delete next[itemId];
              changed = true;
            }
          }
          return changed ? next : current;
        }),
      0,
    );
    return () => clearTimeout(timer);
  }, [library]);
  const [nativeTargetStatus, setNativeTargetStatus] = useState<Status>();
  const [nativeListTops, setNativeListTops] = useState<Partial<Record<Status, number>>>({});
  const [sectionLayouts, setSectionLayouts] = useState<
    Partial<Record<Status, { height: number; top: number }>>
  >({});
  const [nativeDragPreview, setNativeDragPreview] = useState<{
    item: RankedItem;
    layout: NativePosterDragLayout;
    status: Status;
  }>();
  const [nativeDragMotion, setNativeDragMotion] = useState<
    Partial<Record<Status, NativeDragValues>>
  >({});
  const [nativePosterMotion, setNativePosterMotion] = useState<
    Partial<Record<Status, NativeGridDragMotion>>
  >({});
  const [nativePosterDragActive, setNativePosterDragActive] = useState(false);
  const [rootHeight, setRootHeight] = useState(0);
  const [optimisticState, setOptimisticState] = useState<OptimisticTagOrders>({
    tagKey,
    orders: {},
  });
  const reorderVersions = useRef<Record<string, number>>({});
  const rootRef = useRef<View>(null);
  const nativePosterScrollRef = useRef<ScrollView>(null);
  const nativeScrollContentHeight = useRef(0);
  const nativeScrollViewportHeight = useRef(0);
  const rootWindowY = useRef(0);
  const lastScrollY = useRef(0);
  const nativeDragRef = useRef<{ item: RankedItem; rank?: number; status: Status } | undefined>(
    undefined,
  );
  const nativeTargetRef = useRef<Status | undefined>(undefined);
  const optimisticOrders = optimisticState.tagKey === tagKey ? optimisticState.orders : {};
  const view = settings?.defaultView ?? 'list';
  const [gridOverride, setGridOverride] = useState<{
    base: GridColumns | undefined;
    value: GridColumns;
  }>();
  const gridColumns =
    gridOverride && settings?.gridColumns === gridOverride.base
      ? gridOverride.value
      : (settings?.gridColumns ?? DEFAULT_DISPLAY_PREFERENCES.gridColumns);
  const listColumns = settings?.listColumns ?? DEFAULT_DISPLAY_PREFERENCES.listColumns;
  const listTextSize = settings?.listTextSize ?? DEFAULT_DISPLAY_PREFERENCES.listTextSize;
  const rankByItem = useMemo(
    () => new Map((ranks ?? []).map((rank) => [String(rank.itemId), rank.rank])),
    [ranks],
  );
  const members = useMemo<RankedItem[]>(
    () =>
      (library ?? [])
        .filter((item) =>
          item.tags.some((itemTag) => itemTag.trim().toLocaleLowerCase() === tagKey),
        )
        .map((item) => ({
          ...item,
          status: optimisticStatuses[String(item._id)] ?? item.status,
          tagRank: rankByItem.get(String(item._id)),
        }))
        .sort((left, right) => {
          if (left.tagRank !== undefined && right.tagRank !== undefined)
            return left.tagRank - right.tagRank;
          if (left.tagRank !== undefined) return -1;
          if (right.tagRank !== undefined) return 1;
          return left.rank - right.rank;
        }),
    [library, optimisticStatuses, rankByItem, tagKey],
  );
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return members.filter(
      (item) =>
        (!query || item.title.toLocaleLowerCase().includes(query)) &&
        matchesMediaType(item, type) &&
        (statusFilter === 'all' || item.status === statusFilter) &&
        (!minimumRating || (item.rating ?? -1) >= minimumRating),
    );
  }, [members, minimumRating, search, statusFilter, type]);
  const visibleStatuses =
    statusFilter === 'all'
      ? LIBRARY_STATUSES
      : LIBRARY_STATUSES.filter(([status]) => status === statusFilter);
  const filtersActive =
    !!search.trim() || type !== 'all' || statusFilter !== 'all' || minimumRating > 0;

  const sectionItems = (status: Status) => {
    const items = filtered.filter((item) => item.status === status);
    const expected = optimisticOrders[status];
    const persisted = members
      .filter((item) => item.status === status)
      .map((item) => String(item._id));
    const order =
      expected &&
      !(
        persisted.length === expected.length &&
        persisted.every((id, index) => id === expected[index])
      )
        ? expected
        : undefined;
    if (!order) return items;
    return [...items].sort((left, right) => {
      const leftIndex = order.indexOf(String(left._id));
      const rightIndex = order.indexOf(String(right._id));
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    });
  };

  const clearFilters = () => {
    setSearch('');
    setType('all');
    setStatusFilter('all');
    setMinimumRating(0);
  };
  const updateGridColumns = (next: GridColumns) => {
    setGridOverride({ base: settings?.gridColumns, value: next });
    void setSettings({ gridColumns: next }).catch(() => {
      setGridOverride(undefined);
      toast.show('Couldn’t save grid scale');
    });
  };

  const updateVisibility = async (isPublic: boolean) => {
    if (visibilityPending || tagVisibility?.isPublic === isPublic) return;
    setVisibilityPending(true);
    try {
      await setTagVisibility({ tag, isPublic });
      toast.show(isPublic ? 'Tag added to Explore and your profile' : 'Tag is now private');
    } catch {
      toast.show('Couldn’t update tag visibility');
    }
    setVisibilityPending(false);
  };

  const reorder = async (status: Status, items: RankedItem[], from: number, to: number) => {
    if (filtersActive || from === to) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    const versionKey = `${tagKey}:${status}`;
    const version = (reorderVersions.current[versionKey] ?? 0) + 1;
    reorderVersions.current[versionKey] = version;
    setOptimisticState((current) => ({
      tagKey,
      orders: {
        ...(current.tagKey === tagKey ? current.orders : {}),
        [status]: next.map((item) => String(item._id)),
      },
    }));
    try {
      await reorderTagItem({
        tag,
        itemId: moved._id,
        ...(next[to - 1] && { beforeId: next[to - 1]._id }),
        ...(next[to + 1] && { afterId: next[to + 1]._id }),
      });
    } catch {
      if (reorderVersions.current[versionKey] === version)
        setOptimisticState((current) =>
          current.tagKey === tagKey
            ? { tagKey, orders: { ...current.orders, [status]: undefined } }
            : current,
        );
      toast.show('Couldn’t save this tag order');
    }
  };
  const performCategoryMove = async (item: RankedItem, targetStatus: Status) => {
    if (filtersActive || statusMovePendingRef.current || item.status === targetStatus) return;
    const sourceStatus = item.status;
    const sourceItems = sectionItems(sourceStatus).filter((entry) => entry._id !== item._id);
    const targetItems = sectionItems(targetStatus).filter((entry) => entry._id !== item._id);
    const targetLibraryItems = (library ?? [])
      .filter((entry) => entry.status === targetStatus && entry._id !== item._id)
      .sort((left, right) => left.rank - right.rank);
    const nextTarget = [...targetItems, { ...item, status: targetStatus }];

    statusMovePendingRef.current = true;
    setStatusMovePending(true);
    setOptimisticStatuses((current) => ({ ...current, [String(item._id)]: targetStatus }));
    setOptimisticState((current) => ({
      tagKey,
      orders: {
        ...(current.tagKey === tagKey ? current.orders : {}),
        [sourceStatus]: sourceItems.map((entry) => String(entry._id)),
        [targetStatus]: nextTarget.map((entry) => String(entry._id)),
      },
    }));

    try {
      const placement = {
        itemId: item._id,
        ...(targetLibraryItems.at(-1) && { beforeId: targetLibraryItems.at(-1)!._id }),
      };
      if (targetStatus === 'watched') await moveItemToWatched(placement);
      else await reorderItem({ ...placement, status: targetStatus });
    } catch {
      setOptimisticStatuses((current) => {
        const next = { ...current };
        delete next[String(item._id)];
        return next;
      });
      setOptimisticState((current) =>
        current.tagKey === tagKey
          ? {
              tagKey,
              orders: {
                ...current.orders,
                [sourceStatus]: undefined,
                [targetStatus]: undefined,
              },
            }
          : current,
      );
      toast.show(
        targetStatus === 'watched'
          ? 'Couldn’t mark every episode watched'
          : 'Couldn’t move this title',
      );
      statusMovePendingRef.current = false;
      setStatusMovePending(false);
      return;
    }

    try {
      await reorderTagItem({
        tag,
        itemId: item._id,
        ...(targetItems.at(-1) && { beforeId: targetItems.at(-1)!._id }),
      });
    } catch {
      setOptimisticState((current) =>
        current.tagKey === tagKey
          ? { tagKey, orders: { ...current.orders, [targetStatus]: undefined } }
          : current,
      );
      toast.show('Title moved, but its tag order couldn’t be saved');
    }
    statusMovePendingRef.current = false;
    setStatusMovePending(false);
  };
  const requestCategoryMove = (itemId: string, targetStatus: Status) => {
    if (filtersActive || statusMovePendingRef.current) return;
    const item = members.find((entry) => String(entry._id) === itemId);
    if (!item || item.status === targetStatus) return;
    if (targetStatus === 'watched') {
      setPendingWatchedMove(item);
      return;
    }
    void performCategoryMove(item, targetStatus);
  };
  const updateNativeDragTarget = useCallback(
    (_sourceStatus: Status, contentY: number) => {
      if (!nativeDragRef.current) return;
      let target: Status | undefined;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const [status] of LIBRARY_STATUSES) {
        const layout = sectionLayouts[status];
        if (!layout) continue;
        const bottom = layout.top + layout.height;
        const distance =
          contentY < layout.top ? layout.top - contentY : contentY > bottom ? contentY - bottom : 0;
        if (distance < nearestDistance) {
          nearestDistance = distance;
          target = status;
        }
      }
      if (target === nativeTargetRef.current) return;
      nativeTargetRef.current = target;
      setNativeTargetStatus(target);
    },
    [sectionLayouts],
  );
  const finishNativeDrag = (status: Status, _data: RankedItem[], from: number, to: number) => {
    const dragged = nativeDragRef.current;
    const target = nativeTargetRef.current;
    nativeDragRef.current = undefined;
    nativeTargetRef.current = undefined;
    setNativePosterDragActive(false);
    setNativeDragPreview(undefined);
    setNativeTargetStatus(undefined);
    if (dragged && target && target !== status) {
      requestCategoryMove(String(dragged.item._id), target);
      return;
    }
    if (from !== to) void reorder(status, sectionItems(status), from, to);
  };
  const beginNativePosterDrag = (
    item: RankedItem,
    index: number,
    ranked: boolean,
    status: Status,
  ) => {
    nativeDragRef.current = { item, rank: ranked ? index + 1 : undefined, status };
    nativeTargetRef.current = status;
    setNativePosterDragActive(true);
    setNativeTargetStatus(status);
    rootRef.current?.measureInWindow((_rootX, rootY) => {
      rootWindowY.current = rootY;
    });
  };
  const positionNativePosterDrag = (layout: {
    height: number;
    width: number;
    x: number;
    y: number;
  }) => {
    const dragged = nativeDragRef.current;
    const root = rootRef.current;
    if (!dragged || !root) return;
    root.measureInWindow((rootX, rootY) => {
      if (nativeDragRef.current?.item._id === dragged.item._id)
        setNativeDragPreview({
          item: dragged.item,
          status: dragged.status,
          layout: {
            height: layout.height,
            left: layout.x - rootX,
            rank: dragged.rank,
            top: layout.y - rootY,
            width: layout.width,
          },
        });
    });
  };
  const cancelNativePosterDrag = () => {
    nativeDragRef.current = undefined;
    nativeTargetRef.current = undefined;
    setNativePosterDragActive(false);
    setNativeDragPreview(undefined);
    setNativeTargetStatus(undefined);
  };
  const captureScrollOffset = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    lastScrollY.current = Math.max(0, event.nativeEvent.contentOffset.y);
  };
  const nativePosterAutoScroll = useMemo<NativeGridAutoScroll>(
    () => ({
      getBounds: () => ({
        top: rootWindowY.current + TAG_HEADER_HEIGHT,
        bottom: rootWindowY.current + Math.max(TAG_HEADER_HEIGHT, rootHeight),
      }),
      getMaxOffset: () =>
        Math.max(0, nativeScrollContentHeight.current - nativeScrollViewportHeight.current),
      getOffset: () => lastScrollY.current,
      scrollTo: (offset) => {
        lastScrollY.current = offset;
        nativePosterScrollRef.current?.scrollTo({ y: offset, animated: false });
      },
    }),
    [rootHeight],
  );
  const TagScrollComponent = (
    Platform.OS === 'web'
      ? ScrollView
      : view === 'posters'
        ? Animated.ScrollView
        : NestableScrollContainer
  ) as typeof ScrollView;

  return (
    <View
      ref={rootRef}
      onLayout={(event) => setRootHeight(event.nativeEvent.layout.height)}
      style={s.root}
    >
      <SecondaryHeader
        title={tag || 'Tag'}
        backLabel="Back to tags"
        fallback="/tags"
        maxWidth={880}
        right={
          <Drawer>
            <DrawerTrigger asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Tag visibility"
                hitSlop={4}
                style={s.headerAction}
              >
                <EllipsisVertical size={20} color={colors.text} strokeWidth={1.8} />
              </Pressable>
            </DrawerTrigger>
            <DrawerContent className="max-w-md gap-6 rounded-2xl border-border bg-background p-6">
              <DrawerHeader>
                <DrawerTitle>Tag visibility</DrawerTitle>
              </DrawerHeader>
              <View style={s.visibilityOptions}>
                <VisibilityOption
                  label="Public"
                  detail="Show this collection on your profile and in global tags."
                  selected={tagVisibility?.isPublic === true}
                  disabled={visibilityPending}
                  icon={<Globe2 size={19} color={colors.text} strokeWidth={1.7} />}
                  onPress={() => void updateVisibility(true)}
                />
                <VisibilityOption
                  label="Private"
                  detail="Keep this collection visible only to you."
                  selected={tagVisibility?.isPublic !== true}
                  disabled={visibilityPending}
                  icon={<LockKeyhole size={19} color={colors.text} strokeWidth={1.7} />}
                  onPress={() => void updateVisibility(false)}
                />
              </View>
            </DrawerContent>
          </Drawer>
        }
      />
      <View style={s.toolbar}>
        <Input
          accessibilityLabel={`Search titles in ${tag}`}
          testID="tag-title-search"
          value={search}
          onChangeText={setSearch}
          placeholder={`Search ${tag}`}
          returnKeyType="search"
          compact
          style={s.searchInput}
        />
        <LibraryFiltersDrawer
          active={filtersActive}
          mediaType={type}
          status={statusFilter}
          minimumRating={minimumRating}
          onMediaTypeChange={setType}
          onStatusChange={setStatusFilter}
          onMinimumRatingChange={setMinimumRating}
          onClear={clearFilters}
        />
      </View>

      {library === undefined || ranks === undefined ? (
        <TagSkeleton />
      ) : (
        <TagScrollComponent
          ref={Platform.OS !== 'web' && view === 'posters' ? nativePosterScrollRef : undefined}
          testID="tag-scroll"
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={(_width, height) => {
            nativeScrollContentHeight.current = height;
          }}
          onLayout={(event) => {
            nativeScrollViewportHeight.current = event.nativeEvent.layout.height;
          }}
          onScroll={captureScrollOffset}
          onScrollEndDrag={captureScrollOffset}
          onMomentumScrollEnd={captureScrollOffset}
          scrollEnabled={Platform.OS === 'web' || view !== 'posters' || !nativePosterDragActive}
          scrollEventThrottle={16}
        >
          <PinchDensity
            columns={gridColumns}
            onChange={(next) => {
              if (view === 'posters') updateGridColumns(next);
            }}
          >
            {visibleStatuses.map(([status, label]) => {
              const items = sectionItems(status);
              return (
                <TagStatusDropZone
                  key={status}
                  status={status}
                  disabled={filtersActive || statusMovePending}
                  onCrossDrop={requestCategoryMove}
                  onLayout={(event) => {
                    const { height, y } = event.nativeEvent.layout;
                    setSectionLayouts((current) => ({
                      ...current,
                      [status]: { height, top: y },
                    }));
                  }}
                  style={[
                    s.section,
                    Platform.OS !== 'web' &&
                      nativeDragRef.current &&
                      nativeTargetStatus === status &&
                      nativeDragRef.current.status !== status &&
                      s.categoryDropActive,
                  ]}
                >
                  <View style={s.sectionHead}>
                    <Text style={s.sectionTitle}>{label}</Text>
                    <Text style={s.count}>{items.length.toString().padStart(2, '0')}</Text>
                  </View>
                  {!items.length ? (
                    <EmptyState
                      title={filtersActive ? 'No matches' : 'Nothing here yet'}
                      detail={
                        filtersActive
                          ? 'Try a broader filter.'
                          : 'Add a tagged title when you’re ready.'
                      }
                    />
                  ) : Platform.OS === 'web' ? (
                    <View
                      style={[
                        view === 'posters' ? s.webGrid : s.webList,
                        view === 'list' && listColumns === 2 && s.webTwoColumnList,
                      ]}
                    >
                      {items.map((item, index) => (
                        <WebTagDraggable
                          key={item._id}
                          disabled={filtersActive || statusMovePending}
                          index={index}
                          itemId={String(item._id)}
                          itemCount={items.length}
                          status={status}
                          style={
                            view === 'posters'
                              ? {
                                  width: gridItemWidth(gridColumns),
                                  minWidth: 0,
                                  flexGrow: 0,
                                  flexShrink: 0,
                                  flexBasis: gridItemWidth(gridColumns),
                                }
                              : {
                                  ...WEB_ROW_STYLE,
                                  width: listItemWidth(listColumns),
                                  flexBasis: listItemWidth(listColumns),
                                  flexGrow: 0,
                                  flexShrink: 0,
                                }
                          }
                          onDrop={(from, to) => reorder(status, items, from, to)}
                        >
                          {view === 'posters' ? (
                            <TagPoster
                              item={item}
                              index={index}
                              ranked={status === 'watched'}
                              disabled={filtersActive || statusMovePending}
                              onCategoryMove={(target) =>
                                requestCategoryMove(String(item._id), target)
                              }
                            />
                          ) : (
                            <TagRow
                              item={item}
                              index={index}
                              ranked={status === 'watched'}
                              disabled={filtersActive || statusMovePending}
                              textSize={listTextSize}
                              contained={listColumns === 2}
                              onCategoryMove={(target) =>
                                requestCategoryMove(String(item._id), target)
                              }
                            />
                          )}
                        </WebTagDraggable>
                      ))}
                    </View>
                  ) : view === 'posters' ? (
                    <NativeDraggableGrid
                      key={`poster-grid-${gridColumns}`}
                      autoScroll={nativePosterAutoScroll}
                      contentContainerStyle={s.grid}
                      data={items}
                      disabled={filtersActive || statusMovePending}
                      itemWidth={gridItemWidth(gridColumns)}
                      keyExtractor={(item) => String(item._id)}
                      onMotionInit={(motion) =>
                        setNativePosterMotion((current) => ({ ...current, [status]: motion }))
                      }
                      onDragBegin={({ item, index }) =>
                        beginNativePosterDrag(item, index, status === 'watched', status)
                      }
                      onDragLayout={positionNativePosterDrag}
                      onDragMove={({ absoluteY }) =>
                        updateNativeDragTarget(
                          status,
                          absoluteY - rootWindowY.current + lastScrollY.current,
                        )
                      }
                      onDragCancel={cancelNativePosterDrag}
                      onDragEnd={({ data, from, to }) => finishNativeDrag(status, data, from, to)}
                      renderItem={({ item, index }) => (
                        <TagPoster
                          item={item}
                          index={index}
                          ranked={status === 'watched'}
                          disabled={filtersActive || statusMovePending}
                          onCategoryMove={(target) => requestCategoryMove(String(item._id), target)}
                        />
                      )}
                    />
                  ) : (
                    <View
                      onLayout={(event) => {
                        const { y } = event.nativeEvent.layout;
                        setNativeListTops((current) => ({ ...current, [status]: y }));
                      }}
                    >
                      <NestableDraggableFlatList
                        key={`list-${listColumns}`}
                        data={items}
                        scrollEnabled={false}
                        numColumns={listColumns}
                        keyExtractor={(item) => String(item._id)}
                        columnWrapperStyle={listColumns === 2 ? s.gridRow : undefined}
                        activationDistance={8}
                        autoscrollThreshold={80}
                        autoscrollSpeed={140}
                        dragItemOverflow
                        animationConfig={NATIVE_DRAG_ANIMATION}
                        onAnimValInit={(values) =>
                          setNativeDragMotion((current) => ({
                            ...current,
                            [status]: values as NativeDragValues,
                          }))
                        }
                        onDragBegin={(index) => {
                          const item = items[index];
                          if (!item) return;
                          nativeDragRef.current = { item, status };
                          nativeTargetRef.current = status;
                          setNativeTargetStatus(status);
                        }}
                        onDragEnd={({ data, from, to }) => finishNativeDrag(status, data, from, to)}
                        renderItem={(params) => (
                          <NativeTagItem
                            {...params}
                            ranked={status === 'watched'}
                            disabled={filtersActive || statusMovePending}
                            listTextSize={listTextSize}
                            listColumns={listColumns}
                            onCategoryMove={(target) =>
                              requestCategoryMove(String(params.item._id), target)
                            }
                          />
                        )}
                      />
                      {nativeDragMotion[status] && (
                        <NativeDragMonitor
                          values={nativeDragMotion[status]!}
                          status={status}
                          listTop={
                            (sectionLayouts[status]?.top ?? 0) + (nativeListTops[status] ?? 0)
                          }
                          onHover={updateNativeDragTarget}
                        />
                      )}
                    </View>
                  )}
                </TagStatusDropZone>
              );
            })}
          </PinchDensity>
        </TagScrollComponent>
      )}
      <Drawer
        open={!!pendingWatchedMove}
        onOpenChange={(open) => {
          if (!open && !statusMovePending) setPendingWatchedMove(undefined);
        }}
      >
        {!!pendingWatchedMove && (
          <DrawerContent className="max-w-md gap-6 rounded-2xl border-border bg-background p-6">
            <DrawerHeader>
              <DrawerTitle>Mark as watched?</DrawerTitle>
            </DrawerHeader>
            <Text style={s.confirmMessage}>
              {pendingWatchedMove.mediaType === 'tv'
                ? `${pendingWatchedMove.title} will move to Watched and every episode will be marked watched. Times Watched will be set to at least 1.`
                : `${pendingWatchedMove.title} will move to Watched. Times Watched will be set to at least 1.`}
            </Text>
            <Button
              title={statusMovePending ? 'Marking watched…' : 'Mark watched'}
              disabled={statusMovePending}
              onPress={() => {
                if (!pendingWatchedMove || statusMovePending) return;
                const item = pendingWatchedMove;
                void performCategoryMove(item, 'watched').finally(() =>
                  setPendingWatchedMove(undefined),
                );
              }}
            />
          </DrawerContent>
        )}
      </Drawer>
      {!!nativeDragPreview && !!nativePosterMotion[nativeDragPreview.status] && (
        <NativePosterDragPreview
          bounds={{ top: TAG_HEADER_HEIGHT, bottom: rootHeight }}
          layout={nativeDragPreview.layout}
          motion={nativePosterMotion[nativeDragPreview.status]!}
          posterPath={nativeDragPreview.item.posterPath}
          title={nativeDragPreview.item.title}
        />
      )}
      <NativePressable
        accessibilityRole="button"
        accessibilityLabel={`Add titles to ${tag}`}
        accessibilityHint="Opens your library for multi-select"
        onPress={() =>
          router.push({
            pathname: '/tags/add/[tag]',
            params: { tag },
          } as Href)
        }
        style={s.addButton}
        pressedStyle={s.addButtonPressed}
      >
        <Plus size={23} color={colors.bg} strokeWidth={1.9} />
      </NativePressable>
    </View>
  );
}

function VisibilityOption({
  label,
  detail,
  selected,
  disabled,
  icon,
  onPress,
}: {
  label: string;
  detail: string;
  selected: boolean;
  disabled: boolean;
  icon: ReactNode;
  onPress: () => void;
}) {
  return (
    <NativePressable
      accessibilityRole="radio"
      accessibilityLabel={`${label} tag`}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[s.visibilityOption, selected && s.visibilityOptionSelected]}
      pressedStyle={s.pressed}
    >
      <View style={s.visibilityIcon}>{icon}</View>
      <View style={s.visibilityCopy}>
        <Text style={s.visibilityLabel}>{label}</Text>
        <Text style={s.visibilityDetail}>{detail}</Text>
      </View>
      <View style={[s.radio, selected && s.radioSelected]} />
    </NativePressable>
  );
}

function NativeTagItem({
  item,
  drag,
  getIndex,
  ranked,
  disabled,
  listTextSize,
  listColumns,
  onCategoryMove,
}: RenderItemParams<RankedItem> & {
  ranked: boolean;
  disabled: boolean;
  listTextSize: ListTextSize;
  listColumns: 1 | 2;
  onCategoryMove: (status: Status) => void;
}) {
  const index = getIndex() ?? 0;
  return (
    <ScaleDecorator activeScale={1.015}>
      <ShadowDecorator color="#000" opacity={0.4} radius={14} elevation={8}>
        <TagRow
          item={item}
          index={index}
          ranked={ranked}
          drag={drag}
          disabled={disabled}
          textSize={listTextSize}
          contained={listColumns === 2}
          onCategoryMove={onCategoryMove}
        />
      </ShadowDecorator>
    </ScaleDecorator>
  );
}

function TagPoster({
  item,
  index,
  ranked,
  disabled,
  onCategoryMove,
}: {
  item: RankedItem;
  index: number;
  ranked: boolean;
  disabled: boolean;
  onCategoryMove: (status: Status) => void;
}) {
  return (
    <NativePressable
      accessibilityRole="button"
      accessibilityLabel={`${ranked ? `${index + 1}. ` : ''}${item.title}`}
      accessibilityHint={disabled ? undefined : 'Long press and drag to reorder'}
      accessibilityActions={disabled ? undefined : categoryAccessibilityActions}
      onAccessibilityAction={(event) => {
        const target = statusFromAccessibilityAction(event.nativeEvent.actionName);
        if (target && target !== item.status) onCategoryMove(target);
      }}
      onPress={() => router.push(`/item/${item._id}`)}
      style={[s.card, Platform.OS === 'web' && s.webCardInner]}
      pressedStyle={s.pressed}
    >
      <PosterImage path={item.posterPath} title={item.title} style={s.poster} />
      <Text numberOfLines={2} style={s.cardTitle}>
        {ranked && <Text style={s.rank}>{index + 1}. </Text>}
        {item.title}
      </Text>
    </NativePressable>
  );
}

function TagRow({
  item,
  index,
  ranked,
  drag,
  disabled,
  textSize,
  contained = false,
  onCategoryMove,
}: {
  item: RankedItem;
  index: number;
  ranked: boolean;
  drag?: () => void;
  disabled: boolean;
  textSize: ListTextSize;
  contained?: boolean;
  onCategoryMove: (status: Status) => void;
}) {
  const typography = listTypography(textSize);
  return (
    <NativePressable
      accessibilityRole="button"
      accessibilityLabel={`${ranked ? `${index + 1}. ` : ''}${item.title}`}
      accessibilityHint={disabled ? undefined : 'Long press and drag to reorder'}
      accessibilityActions={disabled ? undefined : categoryAccessibilityActions}
      onAccessibilityAction={(event) => {
        const target = statusFromAccessibilityAction(event.nativeEvent.actionName);
        if (target && target !== item.status) onCategoryMove(target);
      }}
      onPress={() => router.push(`/item/${item._id}`)}
      onLongPress={Platform.OS === 'web' || disabled ? undefined : drag}
      delayLongPress={TAG_DRAG_LONG_PRESS_MS}
      style={[s.row, { minHeight: typography.minHeight }, contained && s.rowContained]}
      pressedStyle={s.pressed}
    >
      {ranked && <Text style={s.rowRank}>{index + 1}.</Text>}
      <View style={s.rowTitleShell}>
        <Text
          numberOfLines={contained ? 2 : 1}
          ellipsizeMode="tail"
          style={[s.rowTitle, { fontSize: typography.fontSize, lineHeight: typography.lineHeight }]}
        >
          {item.title}
        </Text>
      </View>
      {item.rating !== undefined && (
        <Text
          style={[s.rating, { fontSize: typography.fontSize, lineHeight: typography.lineHeight }]}
        >
          {item.rating.toFixed(1)}
        </Text>
      )}
    </NativePressable>
  );
}

function TagSkeleton() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading tag" style={s.loading}>
      {[0, 1, 2, 3].map((index) => (
        <View key={index} style={s.skeletonRow}>
          <View style={s.skeletonTitle}>
            <SkeletonShimmer />
          </View>
          <View style={s.skeletonRating}>
            <SkeletonShimmer />
          </View>
        </View>
      ))}
    </View>
  );
}

function TagStatusDropZone({
  children,
  disabled,
  onCrossDrop,
  onLayout,
  status,
  style,
}: {
  children: ReactNode;
  disabled: boolean;
  onCrossDrop: (itemId: string, status: Status) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  status: Status;
  style: StyleProp<ViewStyle>;
}) {
  if (Platform.OS !== 'web')
    return (
      <View onLayout={onLayout} style={style}>
        {children}
      </View>
    );
  return createElement(
    'div',
    {
      ...webStatusDropZoneProps(disabled, status, onCrossDrop, {
        backgroundColor: colors.surface,
        borderColor: colors.text,
      }),
      'data-tag-status-drop-zone': status,
      style: StyleSheet.flatten(style) as CSSProperties,
    },
    children,
  );
}

type NativeDragValues = NativePosterDragMotion & {
  activeCellSize: { value: number };
  hoverOffset: { value: number };
};

function NativeDragMonitor({
  listTop,
  onHover,
  status,
  values,
}: {
  listTop: number;
  onHover: (status: Status, contentY: number) => void;
  status: Status;
  values: NativeDragValues;
}) {
  useAnimatedReaction(
    () => ({
      active: values.isTouchActiveNative.value,
      center: values.hoverOffset.value + values.activeCellSize.value / 2,
    }),
    (current) => {
      if (current.active) runOnJS(onHover)(status, listTop + current.center);
    },
    [listTop, onHover, status, values],
  );
  return null;
}
const createWebSession = ({
  currentTarget,
  index,
  itemId,
  status,
  x,
  y,
}: {
  currentTarget: HTMLElement;
  index: number;
  itemId: string;
  status: Status;
  x: number;
  y: number;
}) => {
  const container = currentTarget.parentElement;
  if (!container) return;
  const nodes = Array.from(container.children).filter(
    (node): node is HTMLElement =>
      node instanceof HTMLElement && node.dataset.tagReorderStatus === status,
  );
  const scrollElement =
    (container.closest('[data-testid="tag-scroll"]') as HTMLElement | null) ??
    (document.scrollingElement as HTMLElement | null);
  if (!scrollElement) return;
  activateWebReorderSession({
    dropped: false,
    from: index,
    itemId,
    nodes,
    over: index,
    pendingOver: index,
    pointerX: x,
    pointerY: y,
    rects: nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { height: rect.height, left: rect.left, top: rect.top, width: rect.width };
    }),
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    scrollElement,
    status,
  });
  return getWebReorderSession<Status>();
};

function WebTagDraggable({
  children,
  disabled,
  index,
  itemId,
  itemCount,
  status,
  onDrop,
  style,
}: {
  children: ReactNode;
  disabled: boolean;
  index: number;
  itemId: string;
  itemCount: number;
  status: Status;
  onDrop: (from: number, to: number) => void | Promise<void>;
  style: CSSProperties;
}) {
  return createElement(
    'div',
    {
      draggable: !disabled,
      tabIndex: disabled ? -1 : 0,
      role: 'listitem',
      'aria-label': `Reorder item ${index + 1} of ${itemCount}`,
      'aria-description': 'Hold Alt and press Arrow Up or Arrow Down to move this title',
      'aria-keyshortcuts': 'Alt+ArrowUp Alt+ArrowDown',
      'data-tag-reorder-index': String(index),
      'data-tag-reorder-status': status,
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        if (disabled || !event.altKey) return;
        const direction = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
        if (!direction) return;
        event.preventDefault();
        const nextIndex = index + direction;
        if (nextIndex >= 0 && nextIndex < itemCount) void onDrop(index, nextIndex);
      },
      onDragStart: (event: DragEvent<HTMLDivElement>) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(index));
        createWebSession({
          currentTarget: event.currentTarget,
          index,
          itemId,
          status,
          x: event.clientX,
          y: event.clientY,
        });
        const ghost = document.createElement('canvas');
        ghost.width = 1;
        ghost.height = 1;
        event.dataTransfer.setDragImage(ghost, 0, 0);
        positionWebReorder(index);
      },
      onDragEnter: (event: DragEvent<HTMLDivElement>) => {
        if (disabled || getWebReorderSession<Status>()?.status !== status) return;
        event.preventDefault();
        updateWebReorderAutoScroll(event.clientX, event.clientY);
        const over = webReorderIndexAtPoint(event.clientX, event.clientY);
        if (over !== undefined) scheduleWebReorder(over);
      },
      onDragOver: (event: DragEvent<HTMLDivElement>) => {
        if (disabled || getWebReorderSession<Status>()?.status !== status) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        updateWebReorderAutoScroll(event.clientX, event.clientY);
        const over = webReorderIndexAtPoint(event.clientX, event.clientY);
        if (over !== undefined) scheduleWebReorder(over);
      },
      onDrop: (event: DragEvent<HTMLDivElement>) => {
        if (disabled) return;
        event.preventDefault();
        const session = getWebReorderSession<Status>();
        if (!session || session.status !== status) return;
        session.dropped = true;
        const pointed = webReorderIndexAtPoint(event.clientX, event.clientY);
        if (pointed !== undefined && pointed !== session.over) positionWebReorder(pointed);
        const { from, over } = session;
        clearWebReorderSession();
        if (from !== over) void onDrop(from, over);
      },
      onDragEnd: () => {
        if (!getWebReorderSession<Status>()?.dropped) clearWebReorderSession();
      },
      style: {
        ...style,
        cursor: disabled ? 'default' : 'grab',
      },
    },
    children,
  );
}

const s = createStyles({
  root: { flex: 1, backgroundColor: colors.bg },
  toolbar: {
    position: 'absolute',
    top: 72,
    left: 0,
    right: 0,
    zIndex: 9,
    width: '100%',
    maxWidth: 880,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: colors.bg,
  },
  searchInput: {
    flex: 1,
    height: 36,
    minWidth: 0,
    borderWidth: 0,
    backgroundColor: colors.surface,
    fontSize: 14,
  },
  headerAction: {
    width: 40,
    height: 40,
    flexShrink: 0,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visibilityOptions: { gap: 10 },
  visibilityOption: {
    minHeight: 76,
    padding: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  visibilityOptionSelected: { backgroundColor: colors.surface, borderColor: colors.text },
  visibilityIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visibilityCopy: { flex: 1, minWidth: 0 },
  visibilityLabel: { color: colors.text, fontSize: 13, fontWeight: '700' },
  visibilityDetail: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3 },
  radio: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.muted,
  },
  radioSelected: { borderWidth: 5, borderColor: colors.text },
  content: {
    width: '100%',
    maxWidth: 880,
    alignSelf: 'center',
    padding: 20,
    paddingTop: 116,
    paddingBottom: 112,
  },
  confirmMessage: { color: colors.text, fontSize: 14, lineHeight: 20 },
  section: { marginTop: 24 },
  categoryDropActive: { backgroundColor: colors.surface, borderRadius: 12 },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 11,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: { color: colors.muted, fontSize: 12, letterSpacing: 0.2, fontWeight: '600' },
  count: { color: colors.muted, fontSize: 11, fontVariant: ['tabular-nums'] },
  webList: { width: '100%' },
  webTwoColumnList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: '3.5%',
  },
  webGrid: {
    paddingTop: 16,
    paddingBottom: 4,
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: '3.5%',
    rowGap: 12,
  },
  grid: { paddingTop: 16, paddingBottom: 4 },
  gridRow: { gap: '3.5%', marginBottom: 12 },
  card: {
    flex: 1,
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    backgroundColor: colors.bg,
  },
  webCardInner: { width: '100%', maxWidth: '100%', flexGrow: 0, flexShrink: 0 },
  poster: { width: '100%', aspectRatio: 2 / 3, borderRadius: 12 },
  cardTitle: { color: colors.text, fontSize: 12, lineHeight: 16, marginTop: 6, fontWeight: '600' },
  rank: { color: colors.muted },
  row: {
    minHeight: 30,
    width: '100%',
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderRadius: 8,
    gap: 8,
    overflow: 'hidden',
  },
  rowContained: { flex: 1, width: '100%' },
  rowRank: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    width: 36,
  },
  rowTitleShell: { flex: 1, minWidth: 0, overflow: 'hidden' },
  rowTitle: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
    flexShrink: 1,
  },
  rating: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontVariant: ['tabular-nums'],
    width: 34,
    textAlign: 'right',
  },
  pressed: { opacity: 0.72 },
  addButton: {
    position: 'absolute',
    right: 24,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5,
    zIndex: 10,
  },
  addButtonPressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
  loading: {
    width: '100%',
    maxWidth: 880,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 136,
    gap: 12,
  },
  skeletonRow: {
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  skeletonTitle: {
    width: '58%',
    height: 14,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: colors.elevated,
  },
  skeletonRating: {
    width: 30,
    height: 14,
    borderRadius: 7,
    overflow: 'hidden',
    backgroundColor: colors.elevated,
  },
});
