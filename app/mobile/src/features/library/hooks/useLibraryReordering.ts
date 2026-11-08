import { useCrossSectionDrop } from '@/hooks/use-cross-section-drop';
import { localDateKey } from '@/hooks/use-local-today';
import * as Effect from 'effect/Effect';
import { saveLibrary } from '@marker/shared/clientEffects';
import { useOperation } from '@/hooks/use-operation';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useAnimatedRef, useScrollOffset } from 'react-native-reanimated';
import { useAction, useMutation } from 'convex/react';
import { api } from '@marker/shared/api';
import type { NativeGridAutoScroll, NativeGridDragMotion } from '@/components/NativeDraggableGrid';
import type { NativePosterDragLayout } from '@/components/NativePosterDragPreview';
import { useToast } from '@/components/ui/Toast';
import { LIBRARY_STATUSES } from '@/lib/libraryFilters';
import { isOrderAcknowledged } from '@/lib/optimisticOrder';
import type { LibraryItem, Status } from '@/types';
import { MOBILE_NAV_HEIGHT, TOOLBAR_HEIGHT } from '../screens/LibraryScreen.styles';

export function useLibraryReordering(items: LibraryItem[], filtersActive: boolean) {
  const insertion = useCrossSectionDrop();
  const runOperation = useOperation();
  const reorderItem = useMutation(api.library.ordering.reorderItem);
  const moveItemToWatched = useAction(api.library.seasonWatched.moveItemToWatched);
  const toast = useToast();
  const [optimisticOrders, setOptimisticOrders] = useState<Partial<Record<Status, string[]>>>({});
  const [pendingReorders, setPendingReorders] = useState<Partial<Record<Status, number>>>({});
  const [optimisticStatuses, setOptimisticStatuses] = useState<Record<string, Status>>({});
  type StatusMove =
    | { state: 'idle' }
    | { state: 'confirming'; item: LibraryItem }
    | { state: 'saving'; item: LibraryItem; target: Status };
  const [statusMove, setStatusMove] = useState<StatusMove>({ state: 'idle' });
  const statusMoveRef = useRef<StatusMove>({ state: 'idle' });
  const publishMove = (next: StatusMove) => {
    statusMoveRef.current = next;
    setStatusMove(next);
  };
  const pendingWatchedMove =
    statusMove.state === 'confirming' ||
    (statusMove.state === 'saving' && statusMove.target === 'watched')
      ? statusMove.item
      : undefined;
  const statusMovePending = statusMove.state === 'saving';
  const [draggedItem, setDraggedItem] = useState<{
    item: LibraryItem;
    rank?: number;
    status: Status;
  }>();
  const [dragPreviewLayout, setDragPreviewLayout] = useState<NativePosterDragLayout>();
  const [targetStatus, setTargetStatus] = useState<Status>();
  const [sectionLayouts, setSectionLayouts] = useState<
    Partial<Record<Status, { height: number; top: number }>>
  >({});
  const [posterMotion, setPosterMotion] = useState<Partial<Record<Status, NativeGridDragMotion>>>(
    {},
  );
  const [rootHeight, setRootHeight] = useState(0);
  const rootRef = useRef<View>(null);
  const posterScrollRef = useAnimatedRef<ScrollView>();
  const nativeScrollOffset = useScrollOffset(posterScrollRef);
  const scrollContentHeight = useRef(0);
  const scrollViewportHeight = useRef(0);
  const rootWindowY = useRef(0);
  const scrollOffset = useRef(0);
  const posterTouchActive = useRef(false);
  const reorderVersions = useRef<Partial<Record<Status, number>>>({});
  const draggedItemRef = useRef<typeof draggedItem>(undefined);
  const targetStatusRef = useRef<Status | undefined>(undefined);

  const unacknowledgedStatuses = Object.entries(optimisticStatuses).filter(([id, status]) => {
    const saved = items.find((item) => item._id === id);
    return saved && saved.status !== status;
  });
  const awaitingStatusQuery = unacknowledgedStatuses.length > 0;
  if (
    !statusMovePending &&
    unacknowledgedStatuses.length !== Object.keys(optimisticStatuses).length
  )
    setOptimisticStatuses(Object.fromEntries(unacknowledgedStatuses));

  // Wait for the latest save and its query render. A rapid reverse move can
  // match a stale query while an earlier save is still in flight.
  const acknowledgedOrders = useMemo(
    () =>
      statusMovePending || awaitingStatusQuery
        ? []
        : LIBRARY_STATUSES.map(([status]) => status).filter((status) => {
            const order = optimisticOrders[status];
            if (!order) return false;
            const saved = items
              .filter((item) => item.status === status)
              .sort((a, b) => a.rank - b.rank);
            return isOrderAcknowledged(
              order,
              saved.map((item) => item._id),
              pendingReorders[status],
            );
          }),
    [awaitingStatusQuery, items, optimisticOrders, pendingReorders, statusMovePending],
  );
  if (acknowledgedOrders.length) {
    const next = { ...optimisticOrders };
    for (const status of acknowledgedOrders) delete next[status];
    setOptimisticOrders(next);
  }

  function effectiveStatus(item: LibraryItem) {
    const optimistic = optimisticStatuses[item._id];
    return optimistic && optimistic !== item.status ? optimistic : item.status;
  }

  const orderedForStatus = (status: Status) => {
    const order = optimisticOrders[status];
    const orderIndex = new Map(order?.map((id, index) => [id, index]));
    const ordered = items
      .filter((item) => effectiveStatus(item) === status)
      .sort((left, right) => {
        if (!order) return left.rank - right.rank;
        const leftIndex = orderIndex.get(left._id) ?? -1;
        const rightIndex = orderIndex.get(right._id) ?? -1;
        if (leftIndex === -1) return rightIndex === -1 ? left.rank - right.rank : 1;
        if (rightIndex === -1) return -1;
        return leftIndex - rightIndex;
      });
    if (statusMove.state !== 'confirming') return ordered;
    const preview = ordered.filter((item) => item._id !== statusMove.item._id);
    if (status === 'watched')
      preview.splice(insertion.pendingIndex.current ?? preview.length, 0, statusMove.item);
    return preview;
  };

  const saveOrder = async (data: LibraryItem[], to: number) => {
    if (filtersActive) {
      toast.show('Clear filters to reorder your library');
      return;
    }
    const moved = data[to];
    if (!moved) return;
    const status = effectiveStatus(moved);
    const version = (reorderVersions.current[status] ?? 0) + 1;
    reorderVersions.current[status] = version;
    setPendingReorders((current) => ({ ...current, [status]: version }));
    setOptimisticOrders((current) => ({
      ...current,
      [status]: data.map((item) => item._id),
    }));
    await runOperation.write(
      Effect.gen(function* () {
        yield* saveLibrary(() =>
          reorderItem({
            itemId: moved._id,
            beforeId: data[to - 1]?._id,
            afterId: data[to + 1]?._id,
          }),
        );
      }),
      {
        failure: () => {
          toast.show('Couldn’t save order');
          if (reorderVersions.current[status] === version) {
            setOptimisticOrders((current) => {
              const next = { ...current };
              delete next[status];
              return next;
            });
          }
        },
        settled: () => {
          setPendingReorders((current) => {
            if (current[status] !== version) return current;
            const next = { ...current };
            delete next[status];
            return next;
          });
        },
      },
    );
  };

  const moveToStatus = async (item: LibraryItem, target: Status, targetIndex?: number) => {
    if (statusMoveRef.current.state === 'saving' || effectiveStatus(item) === target) return;
    publishMove({ state: 'saving', item, target });
    const source = effectiveStatus(item);
    const sourceItems = orderedForStatus(source).filter((entry) => entry._id !== item._id);
    const targetItems = orderedForStatus(target).filter((entry) => entry._id !== item._id);
    const index = Math.min(targetIndex ?? targetItems.length, targetItems.length);
    const nextTarget = [...targetItems];
    nextTarget.splice(index, 0, item);
    setOptimisticStatuses((current) => ({ ...current, [item._id]: target }));
    setOptimisticOrders((current) => ({
      ...current,
      [source]: sourceItems.map((entry) => entry._id),
      [target]: nextTarget.map((entry) => entry._id),
    }));
    await runOperation.write(
      Effect.gen(function* () {
        const placement = {
          itemId: item._id,
          beforeId: targetItems[index - 1]?._id,
          afterId: targetItems[index]?._id,
        };
        if (target === 'watched')
          yield* saveLibrary(() =>
            moveItemToWatched({
              ...placement,
              activityDate: localDateKey(),
            }),
          );
        else yield* saveLibrary(() => reorderItem({ ...placement, status: target }));
      }),
      {
        failure: () => {
          toast.show(
            target === 'watched'
              ? 'Couldn’t mark every episode watched'
              : 'Couldn’t move this title',
          );
          setOptimisticStatuses((current) => {
            const next = { ...current };
            delete next[item._id];
            return next;
          });
          setOptimisticOrders((current) => {
            const next = { ...current };
            delete next[source];
            delete next[target];
            return next;
          });
        },
        settled: () => {
          publishMove({ state: 'idle' });
        },
      },
    );
  };

  const requestStatusMove = (itemId: string, target: Status, index?: number) => {
    if (filtersActive || statusMoveRef.current.state === 'saving') return;
    const item = items.find((entry) => entry._id === itemId);
    if (!item || effectiveStatus(item) === target) return;
    if (target === 'watched') {
      insertion.pendingIndex.current = index;
      publishMove({ state: 'confirming', item });
    } else void moveToStatus(item, target, index);
  };

  const updateDragTarget = useCallback(
    (sourceStatus: Status, contentY: number, x: number, y: number, offset: number) => {
      if (!draggedItemRef.current) return;
      let nearest: Status | undefined;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const [status] of LIBRARY_STATUSES) {
        const layout = sectionLayouts[status];
        if (!layout) continue;
        const bottom = layout.top + layout.height;
        const distance =
          contentY < layout.top ? layout.top - contentY : contentY > bottom ? contentY - bottom : 0;
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = status;
        }
      }
      nearest = insertion.update(nearest, x, y, offset);
      const sourceLayout = sectionLayouts[sourceStatus];
      if (
        nearest === sourceStatus &&
        sourceLayout &&
        (contentY < sourceLayout.top || contentY > sourceLayout.top + sourceLayout.height)
      )
        nearest = undefined;
      if (nearest !== targetStatusRef.current) {
        targetStatusRef.current = nearest;
        setTargetStatus(nearest);
      }
      return nearest === sourceStatus;
    },
    [sectionLayouts, insertion],
  );

  const finishDrag = (source: Status, data: LibraryItem[], from: number, to: number) => {
    const dragged = draggedItemRef.current;
    const target = targetStatusRef.current;
    const index = insertion.indexRef.current;
    cancelDrag();
    if (dragged && !target) return;
    if (dragged && target && target !== source) requestStatusMove(dragged.item._id, target, index);
    else if (from !== to) void saveOrder(data, to);
  };

  const beginDrag = (item: LibraryItem, status: Status, index: number, ranked: boolean) => {
    const next = { item, status, rank: ranked ? index + 1 : undefined };
    targetStatusRef.current = status;
    setTargetStatus(status);
    draggedItemRef.current = next;
    setDraggedItem(next);
    rootRef.current?.measureInWindow((_rootX, rootY) => {
      rootWindowY.current = rootY;
    });
  };

  const positionDrag = (layout: { height: number; width: number; x: number; y: number }) => {
    const dragged = draggedItemRef.current;
    if (!dragged) return;
    rootRef.current?.measureInWindow((rootX, rootY) => {
      if (draggedItemRef.current?.item._id === dragged.item._id) {
        setDragPreviewLayout({
          height: layout.height,
          left: layout.x - rootX,
          rank: dragged.rank,
          top: layout.y - rootY,
          width: layout.width,
        });
      }
    });
  };

  function cancelDrag() {
    insertion.clear();
    setDraggedItem(undefined);
    setDragPreviewLayout(undefined);
    setTargetStatus(undefined);
    draggedItemRef.current = undefined;
    targetStatusRef.current = undefined;
    posterTouchActive.current = false;
  }

  const autoScroll = useMemo<NativeGridAutoScroll>(
    () => ({
      getBounds: () => ({
        top: rootWindowY.current + TOOLBAR_HEIGHT,
        bottom: rootWindowY.current + Math.max(TOOLBAR_HEIGHT, rootHeight - MOBILE_NAV_HEIGHT),
      }),
      getMaxOffset: () => Math.max(0, scrollContentHeight.current - scrollViewportHeight.current),
      offset: nativeScrollOffset,
      scrollRef: posterScrollRef,
    }),
    [nativeScrollOffset, posterScrollRef, rootHeight],
  );

  return {
    orderedForStatus,
    saveOrder,
    moveToStatus,
    requestStatusMove,
    confirmation: {
      index: insertion.pendingIndex.current,
      item: pendingWatchedMove,
      pending: statusMovePending,
      close: () => publishMove({ state: 'idle' }),
    },
    drag: {
      insertion,
      autoScroll,
      begin: beginDrag,
      cancel: cancelDrag,
      contentYFromWindow: (absoluteY: number, offset: number) =>
        absoluteY - rootWindowY.current + offset,
      draggedItem,
      dragPreviewLayout,
      finish: finishDrag,
      posterMotion,
      position: positionDrag,
      posterScrollRef,
      posterTouchActive,
      rootHeight,
      rootRef,
      sectionLayouts,
      scrollContentHeight,
      scrollOffset,
      scrollViewportHeight,
      setPosterMotion,
      setRootHeight,
      setSectionLayouts,
      targetStatus,
      updateTarget: updateDragTarget,
    },
  };
}
