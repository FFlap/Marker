import { useCrossSectionDrop } from '@/hooks/use-cross-section-drop';
import { useTaskState } from '@/hooks/use-task-state';
import { localDateKey, useLocalToday } from '@/hooks/use-local-today';
import { ScreenView } from '@/components/ScreenLayout';
import { useCallback, useMemo, useRef, useState } from 'react';
import * as Effect from 'effect/Effect';
import { saveLibrary } from '@marker/shared/clientEffects';
import { useOperation } from '@/hooks/use-operation';
import { PixelRatio, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import Reanimated, { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import { useLocalSearchParams } from 'expo-router';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '@marker/shared/api';
import { PinchDensity } from '@/components/PinchDensity';
import { useGridColumns } from '@/hooks/use-grid-columns';
import { SectionHeading } from '@/components/ui/primitives';
import { WatchedConfirmSheet } from '@/components/WatchedConfirmSheet';
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
import { DEFAULT_DISPLAY_PREFERENCES, gridMetrics } from '@/lib/displayPreferences';
import type { LibraryItem, Status } from '@/types';
import { isAlsoWatching, LIBRARY_STATUSES } from '@/lib/libraryFilters';
import { isOrderAcknowledged } from '@/lib/optimisticOrder';
import { tagDetailStyles as s } from '@/features/tags/screens/TagDetailScreen.styles';
import { TagHeader } from '@/features/tags/components/TagHeader';
import {
  AlsoWatchingCard,
  twoColumnPairHeight,
  useTitleLines,
} from '@/features/library/components/LibraryItemCards';
import { useTagCollection } from '@/features/tags/hooks/useTagCollection';
import { useTagVisibility } from '@/features/tags/hooks/useTagVisibility';
import { TAG_HEADER_HEIGHT, type OptimisticTagOrders } from '@/features/tags/tagDragConfig';
import {
  TagRow,
  type RankedItem,
  TagPoster,
  TagSkeleton,
} from '@/features/tags/components/TagScreenParts';

export default function TagDetailScreen() {
  const insertion = useCrossSectionDrop();
  const runOperation = useOperation();
  const params = useLocalSearchParams<{ tag?: string | string[] }>();
  const tag = Array.isArray(params.tag) ? params.tag[0] : (params.tag ?? '');
  const tagKey = tag.trim().toLocaleLowerCase();
  const library = useQuery(api.library.items.listItems);
  const ranks = useQuery(api.library.items.listTagRanks, tag ? { tag } : 'skip');
  const settings = useQuery(api.settings.getSettings);
  const today = useLocalToday();
  const automaticAiring = settings?.airingInWatching !== false;
  const titleLines = useTitleLines();
  const alsoWatchingFor = useCallback(
    (item: LibraryItem) => isAlsoWatching(item, automaticAiring, today),
    [automaticAiring, today],
  );
  const setSettings = useMutation(api.settings.setSettings);
  const reorderItem = useMutation(api.library.ordering.reorderItem);
  const reorderTagItem = useMutation(api.library.ordering.reorderTagItem);
  const moveItemToWatched = useAction(api.library.seasonWatched.moveItemToWatched);
  const toast = useToast();
  const tagVisibility = useTagVisibility(tag);
  const { pending: statusMovePending, setPending: setStatusMovePending } = useTaskState();
  const statusMovePendingRef = useRef(false);
  const [pendingWatchedMove, setPendingWatchedMove] = useState<RankedItem>();
  const [optimisticStatuses, setOptimisticStatuses] = useState<Record<string, Status>>({});
  const [nativeTargetStatus, setNativeTargetStatus] = useState<Status>();
  const [sectionLayouts, setSectionLayouts] = useState<
    Partial<Record<Status, { height: number; top: number }>>
  >({});
  const [nativeDragPreview, setNativeDragPreview] = useState<{
    item: RankedItem;
    layout: NativePosterDragLayout;
    status: Status;
  }>();
  const [nativePosterMotion, setNativePosterMotion] = useState<
    Partial<Record<Status, NativeGridDragMotion>>
  >({});
  const [nativePosterDragActive, setNativePosterDragActive] = useState(false);
  const { width: windowWidth } = useWindowDimensions();
  const listCellWidth = gridMetrics(Math.min(windowWidth, 880) - 40, 2, PixelRatio.get()).itemWidth;
  const [rootHeight, setRootHeight] = useState(0);
  const [optimisticState, setOptimisticState] = useState<OptimisticTagOrders>({
    tagKey,
    orders: {},
  });
  const reorderVersions = useRef<Record<string, number>>({});
  const [pendingReorders, setPendingReorders] = useState<Record<string, number>>({});
  const rootRef = useRef<View>(null);
  const nativePosterScrollRef = useAnimatedRef<ScrollView>();
  const nativeScrollOffset = useScrollOffset(nativePosterScrollRef);
  const nativeScrollContentHeight = useRef(0);
  const nativeScrollViewportHeight = useRef(0);
  const rootWindowY = useRef(0);
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
    alsoWatching: alsoWatchingFor,
  });
  const {
    active: filtersActive,
    itemsForStatus: sectionItems,
    savedRanks,
    resultCount,
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
  const unacknowledgedStatuses = Object.entries(optimisticStatuses).filter(([id, status]) => {
    const saved = library?.find((item) => String(item._id) === id);
    return saved && saved.status !== status;
  });
  const awaitingStatusQuery = unacknowledgedStatuses.length > 0;
  if (
    library &&
    !statusMovePending &&
    unacknowledgedStatuses.length !== Object.keys(optimisticStatuses).length
  )
    setOptimisticStatuses(Object.fromEntries(unacknowledgedStatuses));
  const acknowledgedOrders = useMemo(
    () =>
      optimisticState.tagKey !== tagKey || statusMovePending || awaitingStatusQuery
        ? []
        : LIBRARY_STATUSES.map(([status]) => status).filter((status) => {
            const order = optimisticState.orders[status];
            if (!order || pendingReorders[`${tagKey}:${status}`] !== undefined) return false;
            const saved = members.filter((item) => item.status === status);
            return isOrderAcknowledged(
              order,
              saved.map((item) => String(item._id)),
            );
          }),
    [awaitingStatusQuery, members, optimisticState, pendingReorders, statusMovePending, tagKey],
  );
  if (acknowledgedOrders.length) {
    const orders = { ...optimisticState.orders };
    for (const status of acknowledgedOrders) delete orders[status];
    setOptimisticState({ tagKey, orders });
  }

  const view = settings?.defaultView ?? 'list';
  const { gridColumns, updateGridColumns } = useGridColumns(settings?.gridColumns);
  const listColumns = settings?.listColumns ?? DEFAULT_DISPLAY_PREFERENCES.listColumns;
  const listTextSize = settings?.listTextSize ?? DEFAULT_DISPLAY_PREFERENCES.listTextSize;

  const reorder = async (status: Status, items: RankedItem[], from: number, to: number) => {
    if (filtersActive || from === to) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    const versionKey = `${tagKey}:${status}`;
    const version = (reorderVersions.current[versionKey] ?? 0) + 1;
    reorderVersions.current[versionKey] = version;
    setPendingReorders((current) => ({ ...current, [versionKey]: version }));
    setOptimisticState((current) => {
      const orders = current.tagKey === tagKey ? current.orders : {};
      return {
        tagKey,
        orders: { ...orders, [status]: next.map((item) => String(item._id)) },
      };
    });
    await runOperation.write(
      Effect.gen(function* () {
        yield* saveLibrary(() =>
          reorderTagItem({
            tag,
            itemId: moved._id,
            beforeId: next[to - 1]?._id,
            afterId: next[to + 1]?._id,
          }),
        );
      }),
      {
        failure: () => {
          toast.show('Couldn’t save this tag order');
          if (reorderVersions.current[versionKey] === version)
            setOptimisticState((current) =>
              current.tagKey === tagKey
                ? { tagKey, orders: { ...current.orders, [status]: undefined } }
                : current,
            );
        },
        settled: () => {
          setPendingReorders((current) => {
            if (current[versionKey] !== version) return current;
            const next = { ...current };
            delete next[versionKey];
            return next;
          });
        },
      },
    );
  };
  /** Resolves to whether the status change was saved. */
  const performCategoryMove = async (
    item: RankedItem,
    targetStatus: Status,
    targetIndex?: number,
  ): Promise<boolean> => {
    if (filtersActive || statusMovePendingRef.current || item.status === targetStatus) return false;
    let saved = false;
    const sourceStatus = item.status;
    const sourceItems = sectionItems(sourceStatus).filter((entry) => entry._id !== item._id);
    const targetItems = sectionItems(targetStatus).filter((entry) => entry._id !== item._id);
    const targetLibraryItems = (library ?? [])
      .filter((entry) => entry.status === targetStatus && entry._id !== item._id)
      .sort((left, right) => left.rank - right.rank);
    const index = Math.min(targetIndex ?? targetItems.length, targetItems.length);
    const nextTarget = [...targetItems];
    nextTarget.splice(index, 0, { ...item, status: targetStatus });
    const clearMoveOrder = () =>
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

    statusMovePendingRef.current = true;
    setStatusMovePending(true);
    setOptimisticStatuses((current) => ({ ...current, [String(item._id)]: targetStatus }));
    setOptimisticState((current) => {
      const orders = current.tagKey === tagKey ? current.orders : {};
      return {
        tagKey,
        orders: {
          ...orders,
          [sourceStatus]: sourceItems.map((entry) => String(entry._id)),
          [targetStatus]: nextTarget.map((entry) => String(entry._id)),
        },
      };
    });

    await runOperation.write(
      Effect.gen(function* () {
        const placement = {
          itemId: item._id,
          beforeId: targetLibraryItems.at(-1)?._id,
        };
        if (targetStatus === 'watched')
          yield* saveLibrary(() =>
            moveItemToWatched({
              ...placement,
              activityDate: localDateKey(),
            }),
          );
        else yield* saveLibrary(() => reorderItem({ ...placement, status: targetStatus }));
        return yield* saveLibrary(() =>
          reorderTagItem({
            tag,
            itemId: item._id,
            beforeId: targetItems[index - 1]?._id,
            afterId: targetItems[index]?._id,
          }),
        ).pipe(
          Effect.as(true),
          Effect.catchTag('LibraryError', () => Effect.succeed(false)),
        );
      }),
      {
        success: (ordered) => {
          saved = true;
          if (!ordered) {
            clearMoveOrder();
            toast.show('Title moved, but its tag order couldn’t be saved');
          }
        },
        failure: () => {
          toast.show(
            targetStatus === 'watched'
              ? 'Couldn’t mark every episode watched'
              : 'Couldn’t move this title',
          );
          setOptimisticStatuses((current) => {
            const next = { ...current };
            delete next[String(item._id)];
            return next;
          });
          clearMoveOrder();
        },
        settled: () => {
          statusMovePendingRef.current = false;
          setStatusMovePending(false);
        },
      },
    );
    return saved;
  };
  const requestCategoryMove = (itemId: string, targetStatus: Status, index?: number) => {
    if (filtersActive || statusMovePendingRef.current) return;
    const item = members.find((entry) => String(entry._id) === itemId);
    if (!item || item.status === targetStatus) return;
    if (targetStatus === 'watched' && settings?.confirmWatchedMove !== false) {
      insertion.pendingIndex.current = index;
      setPendingWatchedMove(item);
      return;
    }
    void performCategoryMove(item, targetStatus, index);
  };
  const updateNativeDragTarget = useCallback(
    (sourceStatus: Status, contentY: number, x: number, y: number, offset: number) => {
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
      target = insertion.update(target, x, y, offset);
      const sourceLayout = sectionLayouts[sourceStatus];
      if (
        target === sourceStatus &&
        sourceLayout &&
        (contentY < sourceLayout.top || contentY > sourceLayout.top + sourceLayout.height)
      )
        target = undefined;
      if (target !== nativeTargetRef.current) {
        nativeTargetRef.current = target;
        setNativeTargetStatus(target);
      }
      return target === sourceStatus;
    },
    [sectionLayouts, insertion],
  );
  const finishNativeDrag = (status: Status, _data: RankedItem[], from: number, to: number) => {
    const dragged = nativeDragRef.current;
    const target = nativeTargetRef.current;
    const index = insertion.indexRef.current;
    insertion.clear();
    nativeDragRef.current = undefined;
    nativeTargetRef.current = undefined;
    setNativePosterDragActive(false);
    setNativeDragPreview(undefined);
    setNativeTargetStatus(undefined);
    if (dragged && !target) return;
    if (dragged && target && target !== status) {
      requestCategoryMove(String(dragged.item._id), target, index);
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
    insertion.clear();
    nativeDragRef.current = undefined;
    nativeTargetRef.current = undefined;
    setNativePosterDragActive(false);
    setNativeDragPreview(undefined);
    setNativeTargetStatus(undefined);
  };
  const nativePosterAutoScroll = useMemo<NativeGridAutoScroll>(
    () => ({
      getBounds: () => ({
        top: rootWindowY.current + TAG_HEADER_HEIGHT,
        bottom: rootWindowY.current + Math.max(TAG_HEADER_HEIGHT, rootHeight),
      }),
      getMaxOffset: () =>
        Math.max(0, nativeScrollContentHeight.current - nativeScrollViewportHeight.current),
      offset: nativeScrollOffset,
      scrollRef: nativePosterScrollRef,
    }),
    [nativePosterScrollRef, nativeScrollOffset, rootHeight],
  );
  return (
    <ScreenView
      ref={rootRef}
      onLayout={(event) => {
        setRootHeight(event.nativeEvent.layout.height);
      }}
      style={s.root}
    >
      <TagHeader
        tag={tag}
        resultCount={resultCount}
        isPublic={tagVisibility.isPublic}
        visibilityPending={tagVisibility.loading || tagVisibility.pending}
        onVisibilityChange={(isPublic) => void tagVisibility.update(isPublic)}
        filters={{
          mediaType: type,
          minimumRating,
          search,
          status: statusFilter,
        }}
        setFilters={{
          minimumRating: setMinimumRating,
          search: setSearch,
          status: setStatusFilter,
          type: setType,
        }}
      />

      {/* The scroll view stays mounted while loading so its animated ref is always attached. */}
      <Reanimated.ScrollView
        ref={nativePosterScrollRef}
        testID="tag-scroll"
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={(_width, height) => {
          nativeScrollContentHeight.current = height;
        }}
        onLayout={(event) => {
          nativeScrollViewportHeight.current = event.nativeEvent.layout.height;
        }}
        scrollEnabled={!nativePosterDragActive}
        scrollEventThrottle={16}
      >
        {library === undefined || (tagKey && ranks === undefined) ? (
          <TagSkeleton
            list={view === 'list'}
            columns={gridColumns}
            listColumns={listColumns}
            textSize={listTextSize}
          />
        ) : (
          <PinchDensity
            columns={gridColumns}
            enabled={view === 'posters'}
            onChange={updateGridColumns}
          >
            {visibleStatuses.map(([status, label]) => {
              let items = sectionItems(status);
              // While a drop into Watched awaits confirmation, ranks follow the proposed order.
              const previewing = !!pendingWatchedMove && !statusMovePending && !filtersActive;
              const ranks = status === 'watched' && !previewing ? savedRanks('watched') : undefined;
              const alsoWatching =
                status === 'watching' ? sectionItems('watched').filter(alsoWatchingFor) : [];
              if (pendingWatchedMove && !statusMovePending && !filtersActive) {
                items = items.filter((item) => item._id !== pendingWatchedMove._id);
                if (status === 'watched')
                  items.splice(
                    insertion.pendingIndex.current ?? items.length,
                    0,
                    pendingWatchedMove,
                  );
              }
              return (
                <View
                  key={status}
                  onLayout={(event) => {
                    const { height, y } = event.nativeEvent.layout;
                    setSectionLayouts((current) => ({
                      ...current,
                      [status]: { height, top: y + TAG_HEADER_HEIGHT },
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
                  <SectionHeading
                    title={label}
                    count={items.length + alsoWatching.length}
                    style={s.sectionHead}
                    large={view === 'list' && listTextSize === 'large'}
                  />
                  {!items.length &&
                  !alsoWatching.length &&
                  !(
                    nativeDragRef.current &&
                    nativeTargetStatus === status &&
                    nativeDragRef.current.status !== status
                  ) ? (
                    nativePosterDragActive ? (
                      <View style={s.emptySection}>
                        <Text style={s.emptySectionText}>Drop here</Text>
                      </View>
                    ) : (
                      <Text style={s.emptyLine}>
                        {filtersActive ? 'No matches' : 'Drag a title here to move it'}
                      </Text>
                    )
                  ) : (
                    <NativeDraggableGrid
                      key={`${view}-${view === 'posters' ? gridColumns : listColumns}`}
                      autoScroll={nativePosterAutoScroll}
                      sectionTop={sectionLayouts[status]?.top}
                      contentContainerStyle={view === 'posters' ? s.grid : { rowGap: 0 }}
                      onDropTarget={(target) => {
                        insertion.targets.current[status] = target;
                      }}
                      externalPlaceholder={
                        nativeDragRef.current &&
                        nativeTargetStatus === status &&
                        nativeDragRef.current.status !== status
                          ? {
                              index: insertion.index ?? 0,
                              height: nativeDragPreview?.layout.height ?? 48,
                            }
                          : undefined
                      }
                      leading={alsoWatching.map((item, index) => ({
                        key: String(item._id),
                        element: (
                          <AlsoWatchingCard
                            item={item}
                            view={view}
                            textSize={listTextSize}
                            compact={gridColumns === 5}
                            contained={listColumns === 2}
                            pairHeight={
                              view === 'list' && listColumns === 2
                                ? twoColumnPairHeight(
                                    [...alsoWatching, ...items],
                                    index,
                                    listCellWidth,
                                    listTextSize,
                                    titleLines.measured,
                                    false,
                                  )
                                : undefined
                            }
                            onTitleLines={titleLines.report}
                          />
                        ),
                      }))}
                      data={items}
                      disabled={filtersActive || statusMovePending}
                      columns={view === 'posters' ? gridColumns : listColumns}
                      keyExtractor={(item) => String(item._id)}
                      onMotionInit={(motion) =>
                        setNativePosterMotion((current) => ({ ...current, [status]: motion }))
                      }
                      onDragBegin={({ item, index }) =>
                        beginNativePosterDrag(item, index, status === 'watched', status)
                      }
                      onDragLayout={positionNativePosterDrag}
                      onDragMove={({ absoluteX, absoluteY, scrollOffset }) =>
                        updateNativeDragTarget(
                          status,
                          absoluteY - rootWindowY.current + scrollOffset,
                          absoluteX,
                          absoluteY,
                          scrollOffset,
                        )
                      }
                      onDragCancel={cancelNativePosterDrag}
                      onDragEnd={({ data, from, to }) => finishNativeDrag(status, data, from, to)}
                      renderItem={({ item, index }) => {
                        const Card = view === 'posters' ? TagPoster : TagRow;
                        return (
                          <Card
                            textSize={listTextSize}
                            contained={listColumns === 2}
                            pairHeight={
                              view === 'list' && listColumns === 2
                                ? twoColumnPairHeight(
                                    [...alsoWatching, ...items],
                                    alsoWatching.length + index,
                                    listCellWidth,
                                    listTextSize,
                                    titleLines.measured,
                                    status === 'watched',
                                  )
                                : undefined
                            }
                            onTitleLines={titleLines.report}
                            compact={gridColumns === 5}
                            item={item}
                            index={index}
                            rank={ranks?.get(String(item._id))}
                            ranked={status === 'watched'}
                            disabled={filtersActive || statusMovePending}
                            onCategoryMove={(target) =>
                              requestCategoryMove(String(item._id), target)
                            }
                          />
                        );
                      }}
                    />
                  )}
                </View>
              );
            })}
          </PinchDensity>
        )}
      </Reanimated.ScrollView>
      <WatchedConfirmSheet
        item={pendingWatchedMove}
        pending={statusMovePending}
        onClose={() => setPendingWatchedMove(undefined)}
        onConfirm={(item, { dontAskAgain }) => {
          void performCategoryMove(item, 'watched', insertion.pendingIndex.current)
            .then((saved) => {
              if (saved && dontAskAgain)
                return setSettings({ confirmWatchedMove: false }).catch(() =>
                  toast.show('Couldn’t save that preference'),
                );
            })
            .catch(() => undefined)
            .finally(() => setPendingWatchedMove(undefined));
        }}
      />
      {!!nativeDragPreview && !!nativePosterMotion[nativeDragPreview.status] && (
        <NativePosterDragPreview
          bounds={{ top: TAG_HEADER_HEIGHT, bottom: rootHeight }}
          layout={nativeDragPreview.layout}
          motion={nativePosterMotion[nativeDragPreview.status]!}
          posterPath={nativeDragPreview.item.posterPath}
          title={nativeDragPreview.item.title}
        >
          {view === 'list' && (
            <TagRow
              item={nativeDragPreview.item}
              index={(nativeDragPreview.layout.rank ?? 1) - 1}
              ranked={nativeDragPreview.status === 'watched'}
              disabled
              textSize={listTextSize}
              contained={listColumns === 2}
              onCategoryMove={() => undefined}
            />
          )}
        </NativePosterDragPreview>
      )}
    </ScreenView>
  );
}
