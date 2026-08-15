import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  type DimensionValue,
  type LayoutRectangle,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  Easing,
  LinearTransition,
  ReduceMotion,
  runOnJS,
  type SharedValue,
  useSharedValue,
} from 'react-native-reanimated';
import type { NativePosterDragMotion } from '@/components/NativePosterDragPreview';

export type NativeGridDragMotion = NativePosterDragMotion & {
  horizontalTranslate: SharedValue<number>;
};

type DragSession<T> = {
  autoScrollFrame?: number;
  from: number;
  itemKey: string;
  lastAutoScrollTime?: number;
  order: T[];
  over: number;
  pointer?: { x: number; y: number };
  scrollStart: number;
  slots: Map<number, DragLayout>;
};

type DragLayout = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type NativeGridAutoScroll = {
  getBounds: () => { bottom: number; top: number };
  getMaxOffset: () => number;
  getOffset: () => number;
  scrollTo: (offset: number) => void;
};

const AUTO_SCROLL_EDGE_SIZE = 88;
const AUTO_SCROLL_MAX_SPEED = 760;

export function nativeGridAutoScrollVelocity(
  pointerY: number,
  bounds: { bottom: number; top: number },
) {
  const edgeSize = Math.min(AUTO_SCROLL_EDGE_SIZE, Math.max(0, bounds.bottom - bounds.top) * 0.2);
  const topDistance = pointerY - bounds.top;
  const bottomDistance = bounds.bottom - pointerY;
  if (topDistance < edgeSize)
    return -AUTO_SCROLL_MAX_SPEED * Math.max(0, 1 - Math.max(0, topDistance) / edgeSize);
  if (bottomDistance < edgeSize)
    return AUTO_SCROLL_MAX_SPEED * Math.max(0, 1 - Math.max(0, bottomDistance) / edgeSize);
  return 0;
}

export function moveGridItem<T>(items: readonly T[], from: number, to: number) {
  if (from === to) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return [...items];
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}

export function nearestGridSlot(
  layouts: ReadonlyMap<number, DragLayout>,
  point: { x: number; y: number },
  fallback: number,
) {
  let target = fallback;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const [index, layout] of layouts) {
    const distance = Math.hypot(
      point.x - (layout.x + layout.width / 2),
      point.y - (layout.y + layout.height / 2),
    );
    if (distance < nearestDistance) {
      target = index;
      nearestDistance = distance;
    }
  }
  return target;
}

export function NativeDraggableGrid<T>({
  autoScroll,
  contentContainerStyle,
  data,
  disabled,
  itemWidth,
  keyExtractor,
  onDragBegin,
  onDragCancel,
  onDragEnd,
  onDragLayout,
  onDragMove,
  onMotionInit,
  onTouchStateChange,
  renderItem,
}: {
  autoScroll?: NativeGridAutoScroll;
  contentContainerStyle?: StyleProp<ViewStyle>;
  data: T[];
  disabled: boolean;
  itemWidth: DimensionValue;
  keyExtractor: (item: T) => string;
  onDragBegin: (event: { index: number; item: T }) => void;
  onDragCancel?: () => void;
  onDragEnd: (event: { data: T[]; from: number; to: number }) => void;
  onDragLayout?: (layout: DragLayout) => void;
  onDragMove?: (event: { absoluteX: number; absoluteY: number }) => void;
  onMotionInit?: (motion: NativeGridDragMotion) => void;
  onTouchStateChange?: (touching: boolean) => void;
  renderItem: (event: { index: number; isActive: boolean; item: T }) => ReactNode;
}) {
  const horizontalTranslate = useSharedValue(0);
  const touchTranslate = useSharedValue(0);
  const isTouchActiveNative = useSharedValue(false);
  const motion = useMemo<NativeGridDragMotion>(
    () => ({ horizontalTranslate, isTouchActiveNative, touchTranslate }),
    [horizontalTranslate, isTouchActiveNative, touchTranslate],
  );
  const dataRef = useRef(data);
  const gridRef = useRef<View>(null);
  const gridOrigin = useRef({ x: 0, y: 0 });
  const measureGridOrigin = useCallback(() => {
    gridRef.current?.measureInWindow((x, y) => {
      gridOrigin.current = { x, y };
    });
  }, []);
  const cellRefs = useRef(new Map<string, View>());
  const slotLayouts = useRef(new Map<number, LayoutRectangle>());
  const slotOwners = useRef(new Map<number, string>());
  const session = useRef<DragSession<T> | undefined>(undefined);
  const onMotionInitRef = useRef(onMotionInit);
  const autoScrollRef = useRef(autoScroll);
  const [dragOrder, setDragOrder] = useState<T[]>();
  const [activeKey, setActiveKey] = useState<string>();

  dataRef.current = data;
  autoScrollRef.current = autoScroll;
  onMotionInitRef.current = onMotionInit;

  useEffect(() => {
    onMotionInitRef.current?.(motion);
  }, [motion]);

  useEffect(
    () => () => {
      const activeFrame = session.current?.autoScrollFrame;
      if (activeFrame !== undefined) cancelAnimationFrame(activeFrame);
    },
    [],
  );

  const clearDrag = useCallback(() => {
    const activeFrame = session.current?.autoScrollFrame;
    if (activeFrame !== undefined) cancelAnimationFrame(activeFrame);
    session.current = undefined;
    setActiveKey(undefined);
    setDragOrder(undefined);
    horizontalTranslate.value = 0;
    touchTranslate.value = 0;
    isTouchActiveNative.value = false;
  }, [horizontalTranslate, isTouchActiveNative, touchTranslate]);

  const beginDrag = useCallback(
    (item: T, index: number) => {
      if (disabled) return;
      const itemKey = keyExtractor(item);
      const order = [...dataRef.current];
      session.current = {
        from: index,
        itemKey,
        order,
        over: index,
        scrollStart: autoScrollRef.current?.getOffset() ?? 0,
        // Keep hit targets fixed for the duration of this drag. Reading layouts
        // while neighboring cells animate can make the nearest slot oscillate.
        slots: new Map(slotLayouts.current),
      };
      setDragOrder(order);
      setActiveKey(itemKey);
      horizontalTranslate.value = 0;
      touchTranslate.value = 0;
      isTouchActiveNative.value = true;
      onDragBegin({ item, index });
      measureGridOrigin();
      cellRefs.current.get(itemKey)?.measureInWindow((x, y, width, height) => {
        if (session.current?.itemKey === itemKey) onDragLayout?.({ x, y, width, height });
      });
    },
    [
      disabled,
      horizontalTranslate,
      isTouchActiveNative,
      keyExtractor,
      measureGridOrigin,
      onDragBegin,
      onDragLayout,
      touchTranslate,
    ],
  );

  const moveDrag = useCallback(
    (absoluteX: number, absoluteY: number) => {
      const current = session.current;
      if (!current) return;
      current.pointer = { x: absoluteX, y: absoluteY };
      onDragMove?.({ absoluteX, absoluteY });
      const localX = absoluteX - gridOrigin.current.x;
      const scrollDelta =
        (autoScrollRef.current?.getOffset() ?? current.scrollStart) - current.scrollStart;
      const localY = absoluteY - gridOrigin.current.y + scrollDelta;
      const target = nearestGridSlot(current.slots, { x: localX, y: localY }, current.over);
      if (target === current.over) return;
      const currentIndex = current.order.findIndex(
        (candidate) => keyExtractor(candidate) === current.itemKey,
      );
      if (currentIndex < 0) return;
      const next = moveGridItem(current.order, currentIndex, target);
      current.order = next;
      current.over = target;
      setDragOrder(next);
    },
    [keyExtractor, onDragMove],
  );

  const runAutoScroll = useCallback(
    (timestamp: number) => {
      const current = session.current;
      const config = autoScrollRef.current;
      if (!current || !config || !current.pointer) return;
      current.autoScrollFrame = undefined;
      const velocity = nativeGridAutoScrollVelocity(current.pointer.y, config.getBounds());
      if (!velocity) {
        current.lastAutoScrollTime = undefined;
        return;
      }
      const elapsed = current.lastAutoScrollTime
        ? Math.min(32, timestamp - current.lastAutoScrollTime)
        : 16;
      current.lastAutoScrollTime = timestamp;
      const before = config.getOffset();
      const next = Math.max(
        0,
        Math.min(config.getMaxOffset(), before + (velocity * elapsed) / 1000),
      );
      if (Math.abs(next - before) < 0.1) {
        current.lastAutoScrollTime = undefined;
        return;
      }
      config.scrollTo(next);
      moveDrag(current.pointer.x, current.pointer.y);
      current.autoScrollFrame = requestAnimationFrame(runAutoScroll);
    },
    [moveDrag],
  );

  const moveDragWithAutoScroll = useCallback(
    (absoluteX: number, absoluteY: number) => {
      moveDrag(absoluteX, absoluteY);
      const current = session.current;
      const config = autoScrollRef.current;
      if (!current || !config) return;
      const velocity = nativeGridAutoScrollVelocity(absoluteY, config.getBounds());
      if (!velocity) {
        if (current.autoScrollFrame !== undefined) cancelAnimationFrame(current.autoScrollFrame);
        current.autoScrollFrame = undefined;
        current.lastAutoScrollTime = undefined;
        return;
      }
      if (current.autoScrollFrame === undefined)
        current.autoScrollFrame = requestAnimationFrame(runAutoScroll);
    },
    [moveDrag, runAutoScroll],
  );

  const finishDrag = useCallback(() => {
    const current = session.current;
    if (!current) return;
    const result = { data: current.order, from: current.from, to: current.over };
    clearDrag();
    onDragEnd(result);
  }, [clearDrag, onDragEnd]);

  const cancelDrag = useCallback(() => {
    if (!session.current) return;
    clearDrag();
    onDragCancel?.();
  }, [clearDrag, onDragCancel]);

  const displayed = dragOrder ?? data;
  return (
    <View ref={gridRef} onLayout={measureGridOrigin} style={[styles.grid, contentContainerStyle]}>
      {displayed.map((item, index) => {
        const itemKey = keyExtractor(item);
        return (
          <NativeGridCell
            key={itemKey}
            active={itemKey === activeKey}
            cellRefs={cellRefs}
            disabled={disabled}
            index={index}
            item={item}
            itemKey={itemKey}
            itemWidth={itemWidth}
            horizontalTranslate={horizontalTranslate}
            touchTranslate={touchTranslate}
            onBegin={beginDrag}
            onCancel={cancelDrag}
            onFinish={finishDrag}
            onMove={moveDragWithAutoScroll}
            onTouchStateChange={onTouchStateChange}
            renderItem={renderItem}
            slotLayouts={slotLayouts}
            slotOwners={slotOwners}
          />
        );
      })}
    </View>
  );
}

function NativeGridCellImpl<T>({
  active,
  cellRefs,
  disabled,
  horizontalTranslate,
  index,
  item,
  itemKey,
  itemWidth,
  onBegin,
  onCancel,
  onFinish,
  onMove,
  onTouchStateChange,
  renderItem,
  slotLayouts,
  slotOwners,
  touchTranslate,
}: {
  active: boolean;
  cellRefs: { current: Map<string, View> };
  disabled: boolean;
  horizontalTranslate: SharedValue<number>;
  index: number;
  item: T;
  itemKey: string;
  itemWidth: DimensionValue;
  onBegin: (item: T, index: number) => void;
  onCancel: () => void;
  onFinish: () => void;
  onMove: (absoluteX: number, absoluteY: number) => void;
  onTouchStateChange?: (touching: boolean) => void;
  renderItem: (event: { index: number; isActive: boolean; item: T }) => ReactNode;
  slotLayouts: { current: Map<number, LayoutRectangle> };
  slotOwners: { current: Map<number, string> };
  touchTranslate: SharedValue<number>;
}) {
  const cellMap = cellRefs.current;
  const slotMap = slotLayouts.current;
  const ownerMap = slotOwners.current;
  const setCellRef = useCallback(
    (node: View | null) => {
      if (node) cellMap.set(itemKey, node);
      else cellMap.delete(itemKey);
    },
    [cellMap, itemKey],
  );
  const saveSlotLayout = useCallback(
    (layout: LayoutRectangle) => {
      slotMap.set(index, layout);
      ownerMap.set(index, itemKey);
    },
    [index, itemKey, ownerMap, slotMap],
  );
  useEffect(
    () => () => {
      if (ownerMap.get(index) === itemKey) {
        ownerMap.delete(index);
        slotMap.delete(index);
      }
    },
    [index, itemKey, ownerMap, slotMap],
  );
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled)
        .maxPointers(1)
        .activateAfterLongPress(260)
        .shouldCancelWhenOutside(false)
        .onBegin(() => {
          if (onTouchStateChange) runOnJS(onTouchStateChange)(true);
        })
        .onStart(() => runOnJS(onBegin)(item, index))
        .onUpdate((event) => {
          horizontalTranslate.value = event.translationX;
          touchTranslate.value = event.translationY;
          runOnJS(onMove)(event.absoluteX, event.absoluteY);
        })
        .onEnd(() => runOnJS(onFinish)())
        .onFinalize((_event, success) => {
          if (onTouchStateChange) runOnJS(onTouchStateChange)(false);
          if (!success) runOnJS(onCancel)();
        }),
    [
      disabled,
      horizontalTranslate,
      index,
      item,
      onBegin,
      onCancel,
      onFinish,
      onMove,
      onTouchStateChange,
      touchTranslate,
    ],
  );

  return (
    <Reanimated.View
      layout={LinearTransition.duration(140)
        .easing(Easing.out(Easing.cubic))
        .reduceMotion(ReduceMotion.System)}
      onLayout={(event) => saveSlotLayout(event.nativeEvent.layout)}
      style={[styles.cell, { width: itemWidth }]}
    >
      <GestureDetector gesture={gesture}>
        <View
          ref={setCellRef}
          testID={`native-grid-item-${itemKey}`}
          style={[styles.cellContent, active && styles.placeholder]}
        >
          {renderItem({ item, index, isActive: active })}
        </View>
      </GestureDetector>
    </Reanimated.View>
  );
}

const NativeGridCell = memo(NativeGridCellImpl) as typeof NativeGridCellImpl;

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: '3.5%',
    rowGap: 12,
  },
  cell: { minWidth: 0, flexGrow: 0, flexShrink: 0 },
  cellContent: { width: '100%' },
  placeholder: { opacity: 0 },
});
