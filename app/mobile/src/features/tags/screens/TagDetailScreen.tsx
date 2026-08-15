import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AccessibilityInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAction, useMutation, useQuery } from 'convex/react';
import {
  NestableDraggableFlatList,
  NestableScrollContainer,
} from 'react-native-draggable-flatlist';
import { api } from '@convex/_generated/api';
import { PinchDensity } from '@/components/PinchDensity';
import { EmptyState } from '@/components/ui/primitives';
import {
  NativeDraggableGrid,
  type NativeGridAutoScroll,
  type NativeGridDragMotion,
} from '@/components/NativeDraggableGrid';
import {
  NativePosterDragPreview,
  type NativePosterDragLayout,
} from '@/components/NativePosterDragPreview';
import { useToast } from '@/components/ui/Toast';
import {
  DEFAULT_DISPLAY_PREFERENCES,
  gridItemWidth,
  type GridColumns,
} from '@/lib/displayPreferences';
import type { Status } from '@/types';
import { LIBRARY_STATUSES } from '@/lib/libraryFilters';
import { tagDetailStyles as s } from './TagDetailScreen.styles';
import { TagHeader } from '../components/TagHeader';
import { AddTagTitlesButton, ConfirmWatchedMove } from '../components/TagScreenActions';
import { useTagCollection } from '../hooks/useTagCollection';
import { useTagVisibility } from '../hooks/useTagVisibility';
import { TAG_HEADER_HEIGHT, tagDragAnimation, type OptimisticTagOrders } from '../tagDragConfig';
import {
  NativeDragMonitor,
  type NativeDragValues,
  NativeTagItem,
  type RankedItem,
  TagPoster,
  TagSkeleton,
  TagStatusDropZone,
} from '../components/TagScreenParts';

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
  const toast = useToast();
  const tagVisibility = useTagVisibility(tag);
  const [statusMovePending, setStatusMovePending] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);
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
  const collection = useTagCollection({
    items: library,
    optimisticOrders,
    optimisticStatuses,
    ranks,
    tagKey,
  });
  const {
    active: filtersActive,
    clear: clearFilters,
    itemsForStatus: sectionItems,
    members,
    minimumRating,
    search,
    setMinimumRating,
    setSearch,
    setStatus: setStatusFilter,
    setType,
    status: statusFilter,
    type,
    visibleStatuses,
  } = collection;
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
  const updateGridColumns = (next: GridColumns) => {
    setGridOverride({ base: settings?.gridColumns, value: next });
    void setSettings({ gridColumns: next }).catch(() => {
      setGridOverride(undefined);
      toast.show('Couldn’t save grid scale');
    });
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
  const TagScrollComponent = (view === 'posters'
    ? Animated.ScrollView
    : NestableScrollContainer) as unknown as typeof ScrollView;

  return (
    <View
      ref={rootRef}
      onLayout={(event) => setRootHeight(event.nativeEvent.layout.height)}
      style={s.root}
    >
      <TagHeader
        tag={tag}
        isPublic={tagVisibility.isPublic}
        visibilityPending={tagVisibility.pending}
        onVisibilityChange={(isPublic) => void tagVisibility.update(isPublic)}
        filters={{
          active: filtersActive,
          mediaType: type,
          minimumRating,
          search,
          status: statusFilter,
        }}
        setFilters={{
          clear: clearFilters,
          minimumRating: setMinimumRating,
          search: setSearch,
          status: setStatusFilter,
          type: setType,
        }}
      />

      {library === undefined || (tagKey && ranks === undefined) ? (
        <TagSkeleton />
      ) : (
        <TagScrollComponent
          ref={view === 'posters' ? nativePosterScrollRef : undefined}
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
          scrollEnabled={view !== 'posters' || !nativePosterDragActive}
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
                  onLayout={(event) => {
                    const { height, y } = event.nativeEvent.layout;
                    setSectionLayouts((current) => ({
                      ...current,
                      [status]: { height, top: y },
                    }));
                  }}
                  style={[
                    s.section,
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
                        animationConfig={tagDragAnimation}
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
                            reduceMotion={reduceMotion}
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
      <ConfirmWatchedMove
        item={pendingWatchedMove}
        pending={statusMovePending}
        onClose={() => setPendingWatchedMove(undefined)}
        onConfirm={(item) => performCategoryMove(item, 'watched')}
      />
      {!!nativeDragPreview && !!nativePosterMotion[nativeDragPreview.status] && (
        <NativePosterDragPreview
          bounds={{ top: TAG_HEADER_HEIGHT, bottom: rootHeight }}
          layout={nativeDragPreview.layout}
          motion={nativePosterMotion[nativeDragPreview.status]!}
          posterPath={nativeDragPreview.item.posterPath}
          title={nativeDragPreview.item.title}
        />
      )}
      <AddTagTitlesButton tag={tag} />
    </View>
  );
}
