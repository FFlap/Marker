import { useCallback, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useAction, useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import type { NativeGridAutoScroll, NativeGridDragMotion } from '@/components/NativeDraggableGrid';
import type {
  NativePosterDragLayout,
  NativePosterDragMotion,
} from '@/components/NativePosterDragPreview';
import { useToast } from '@/components/ui/Toast';
import { LIBRARY_STATUSES } from '@/lib/libraryFilters';
import type { LibraryItem, Status } from '@/types';
import { MOBILE_NAV_HEIGHT, TOOLBAR_HEIGHT } from '../screens/LibraryScreen.styles';

export type NativeDragValues = NativePosterDragMotion & {
  activeCellSize: { value: number };
  hoverOffset: { value: number };
};

export function useLibraryReordering(items: LibraryItem[], filtersActive: boolean) {
  const reorderItem = useMutation(api.library.ordering.reorderItem);
  const moveItemToWatched = useAction(api.library.seasonWatched.moveItemToWatched);
  const toast = useToast();
  const [optimisticOrders, setOptimisticOrders] = useState<Partial<Record<Status, string[]>>>({});
  const [optimisticStatuses, setOptimisticStatuses] = useState<Record<string, Status>>({});
  const [pendingWatchedMove, setPendingWatchedMove] = useState<LibraryItem>();
  const [statusMovePending, setStatusMovePending] = useState(false);
  const [draggedItem, setDraggedItem] = useState<{
    item: LibraryItem;
    rank?: number;
    status: Status;
  }>();
  const [dragPreviewLayout, setDragPreviewLayout] = useState<NativePosterDragLayout>();
  const [targetStatus, setTargetStatus] = useState<Status>();
  const [listTops, setListTops] = useState<Partial<Record<Status, number>>>({});
  const [sectionLayouts, setSectionLayouts] = useState<
    Partial<Record<Status, { height: number; top: number }>>
  >({});
  const [dragValues, setDragValues] = useState<Partial<Record<Status, NativeDragValues>>>({});
  const [posterMotion, setPosterMotion] = useState<Partial<Record<Status, NativeGridDragMotion>>>(
    {},
  );
  const [rootHeight, setRootHeight] = useState(0);
  const statusMovePendingRef = useRef(false);
  const rootRef = useRef<View>(null);
  const posterScrollRef = useRef<ScrollView>(null);
  const scrollContentHeight = useRef(0);
  const scrollViewportHeight = useRef(0);
  const rootWindowY = useRef(0);
  const scrollOffset = useRef(0);
  const posterTouchActive = useRef(false);
  const reorderVersions = useRef<Partial<Record<Status, number>>>({});
  const draggedItemRef = useRef<typeof draggedItem>(undefined);
  const targetStatusRef = useRef<Status | undefined>(undefined);

  const persistedOrders = useMemo(
    () =>
      LIBRARY_STATUSES.reduce(
        (orders, [status]) => {
          orders[status] = items
            .filter((item) => item.status === status)
            .sort((left, right) => left.rank - right.rank)
            .map((item) => item._id);
          return orders;
        },
        {} as Record<Status, string[]>,
      ),
    [items],
  );

  const activeOptimisticOrder = (status: Status) => {
    const expected = optimisticOrders[status];
    if (!expected) return undefined;
    const persisted = persistedOrders[status];
    return persisted.length === expected.length &&
      persisted.every((id, index) => id === expected[index])
      ? undefined
      : expected;
  };

  function effectiveStatus(item: LibraryItem) {
    const optimistic = optimisticStatuses[item._id];
    return optimistic && optimistic !== item.status ? optimistic : item.status;
  }

  const orderedForStatus = (status: Status) => {
    const order = activeOptimisticOrder(status);
    return items
      .filter((item) => effectiveStatus(item) === status)
      .sort((left, right) => {
        if (!order) return left.rank - right.rank;
        const leftIndex = order.indexOf(left._id);
        const rightIndex = order.indexOf(right._id);
        if (leftIndex === -1) return rightIndex === -1 ? left.rank - right.rank : 1;
        if (rightIndex === -1) return -1;
        return leftIndex - rightIndex;
      });
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
    setOptimisticOrders((current) => ({
      ...current,
      [status]: data.map((item) => item._id),
    }));
    try {
      await reorderItem({
        itemId: moved._id,
        beforeId: data[to - 1]?._id,
        afterId: data[to + 1]?._id,
      });
    } catch {
      if (reorderVersions.current[status] === version) {
        setOptimisticOrders((current) => {
          const next = { ...current };
          delete next[status];
          return next;
        });
      }
      toast.show('Couldn’t save order');
    }
  };

  const moveToStatus = async (item: LibraryItem, target: Status) => {
    if (statusMovePendingRef.current || effectiveStatus(item) === target) return;
    statusMovePendingRef.current = true;
    const source = effectiveStatus(item);
    const sourceItems = orderedForStatus(source).filter((entry) => entry._id !== item._id);
    const targetItems = orderedForStatus(target).filter((entry) => entry._id !== item._id);
    setStatusMovePending(true);
    setOptimisticStatuses((current) => ({ ...current, [item._id]: target }));
    setOptimisticOrders((current) => ({
      ...current,
      [source]: sourceItems.map((entry) => entry._id),
      [target]: [...targetItems, item].map((entry) => entry._id),
    }));
    try {
      const placement = { itemId: item._id, beforeId: targetItems.at(-1)?._id };
      if (target === 'watched') await moveItemToWatched(placement);
      else await reorderItem({ ...placement, status: target });
      setOptimisticStatuses((current) => {
        const next = { ...current };
        delete next[item._id];
        return next;
      });
    } catch {
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
      toast.show(
        target === 'watched' ? 'Couldn’t mark every episode watched' : 'Couldn’t move this title',
      );
    } finally {
      statusMovePendingRef.current = false;
      setStatusMovePending(false);
    }
  };

  const requestStatusMove = (itemId: string, target: Status) => {
    if (filtersActive || statusMovePendingRef.current) return;
    const item = items.find((entry) => entry._id === itemId);
    if (!item || effectiveStatus(item) === target) return;
    if (target === 'watched') setPendingWatchedMove(item);
    else void moveToStatus(item, target);
  };

  const updateDragTarget = useCallback(
    (_sourceStatus: Status, contentY: number) => {
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
      if (nearest === targetStatusRef.current) return;
      targetStatusRef.current = nearest;
      setTargetStatus(nearest);
    },
    [sectionLayouts],
  );

  const finishDrag = (source: Status, data: LibraryItem[], from: number, to: number) => {
    const dragged = draggedItemRef.current;
    const target = targetStatusRef.current;
    cancelDrag();
    if (dragged && target && target !== source) requestStatusMove(dragged.item._id, target);
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

  const beginListDrag = (item: LibraryItem, status: Status) => {
    const next = { item, status };
    targetStatusRef.current = status;
    setTargetStatus(status);
    draggedItemRef.current = next;
    setDraggedItem(next);
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
      getOffset: () => scrollOffset.current,
      scrollTo: (offset) => {
        scrollOffset.current = offset;
        posterScrollRef.current?.scrollTo({ y: offset, animated: false });
      },
    }),
    [rootHeight],
  );

  return {
    orderedForStatus,
    effectiveStatus,
    saveOrder,
    moveToStatus,
    requestStatusMove,
    confirmation: {
      item: pendingWatchedMove,
      pending: statusMovePending,
      close: () => setPendingWatchedMove(undefined),
    },
    drag: {
      autoScroll,
      begin: beginDrag,
      beginList: beginListDrag,
      cancel: cancelDrag,
      contentYFromWindow: (absoluteY: number) =>
        absoluteY - rootWindowY.current + scrollOffset.current,
      draggedItem,
      dragPreviewLayout,
      dragValues,
      finish: finishDrag,
      listTops,
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
      setDragValues,
      setListTops,
      setPosterMotion,
      setRootHeight,
      setSectionLayouts,
      targetStatus,
      updateTarget: updateDragTarget,
    },
  };
}
