import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  type DimensionValue,
  type LayoutRectangle,
  type ScrollView,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { useGridMetrics } from '@/hooks/use-grid-metrics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  runOnJS,
  scrollTo,
  type AnimatedRef,
  type FrameInfo,
  type SharedValue,
  useFrameCallback,
  useSharedValue,
} from 'react-native-reanimated';
import type { NativePosterDragMotion } from '@/components/NativePosterDragPreview';

export type NativeGridDragMotion = NativePosterDragMotion & {
  horizontalTranslate: SharedValue<number>;
};

type DragSession<T> = {
  bounds: { bottom: number; top: number };
  from: number;
  itemKey: string;
  maxOffset: number;
  order: T[];
  over: number;
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
  offset: SharedValue<number>;
  scrollRef: AnimatedRef<ScrollView>;
};

const AUTO_SCROLL_EDGE_SIZE = 88;
const AUTO_SCROLL_MAX_SPEED = 760;

export function nativeGridAutoScrollVelocity(
  pointerY: number,
  bounds: { bottom: number; top: number },
) {
  'worklet';
  const edgeSize = Math.min(AUTO_SCROLL_EDGE_SIZE, Math.max(0, bounds.bottom - bounds.top) * 0.2);
  if (edgeSize <= 0) return 0;
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
  columns,
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
  columns: number;
  keyExtractor: (item: T) => string;
  onDragBegin: (event: { index: number; item: T }) => void;
  onDragCancel?: () => void;
  onDragEnd: (event: { data: T[]; from: number; to: number }) => void;
  onDragLayout?: (layout: DragLayout) => void;
  onDragMove?: (event: { absoluteX: number; absoluteY: number; scrollOffset: number }) => void;
  onMotionInit?: (motion: NativeGridDragMotion) => void;
  onTouchStateChange?: (touching: boolean) => void;
  renderItem: (event: { index: number; isActive: boolean; item: T }) => ReactNode;
}) {
  const horizontalTranslate = useSharedValue(0);
  const touchTranslate = useSharedValue(0);
  const isTouchActiveNative = useSharedValue(false);
  const [previewReady, setPreviewReady] = useState(false);
  const previewReadyRef = useRef(false);
  const pointer = useSharedValue({ x: 0, y: 0 });
  const scrollPosition = useSharedValue(0);
  const scrollBounds = useSharedValue({ top: 0, bottom: 0 });
  const maxScrollOffset = useSharedValue(0);
  const nativeScrollOffset = autoScroll?.offset;
  const scrollRef = autoScroll?.scrollRef;
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

  const onPreviewReady = useCallback(() => {
    const current = session.current;
    if (!current) return;
    previewReadyRef.current = true;
    setPreviewReady(true);
    setDragOrder(moveGridItem(current.order, current.from, current.over));
  }, []);
  const motion = useMemo<NativeGridDragMotion>(
    () => ({ horizontalTranslate, isTouchActiveNative, touchTranslate, onPreviewReady }),
    [horizontalTranslate, isTouchActiveNative, touchTranslate, onPreviewReady],
  );

  dataRef.current = data;
  autoScrollRef.current = autoScroll;
  onMotionInitRef.current = onMotionInit;

  useEffect(() => {
    onMotionInitRef.current?.(motion);
  }, [motion]);

  const clearDrag = useCallback(() => {
    session.current = undefined;
    setActiveKey(undefined);
    setDragOrder(undefined);
    // The cards already occupy the preview order. Reveal the dragged card in
    // the same commit that removes the floating preview; no offsets to reset.
    isTouchActiveNative.value = false;
  }, [isTouchActiveNative]);

  const beginDrag = useCallback(
    (item: T, index: number, scrollOffset: number) => {
      if (disabled) return;
      const itemKey = keyExtractor(item);
      const order = [...dataRef.current];
      const bounds = autoScrollRef.current?.getBounds() ?? { top: 0, bottom: 0 };
      const maxOffset = autoScrollRef.current?.getMaxOffset() ?? 0;
      session.current = {
        bounds,
        from: index,
        itemKey,
        maxOffset,
        order,
        over: index,
        scrollStart: scrollOffset,
        // Hit-test against the original slots as the keyed cards change order.
        slots: new Map(slotLayouts.current),
      };
      previewReadyRef.current = !onMotionInitRef.current;
      setPreviewReady(false);
      setDragOrder(order);
      setActiveKey(itemKey);
      scrollBounds.value = bounds;
      maxScrollOffset.value = maxOffset;
      onDragBegin({ item, index });
      measureGridOrigin();
      cellRefs.current.get(itemKey)?.measureInWindow((x, y, width, height) => {
        if (session.current?.itemKey === itemKey) onDragLayout?.({ x, y, width, height });
      });
    },
    [
      disabled,
      keyExtractor,
      maxScrollOffset,
      scrollBounds,
      measureGridOrigin,
      onDragBegin,
      onDragLayout,
    ],
  );

  const moveDrag = useCallback(
    (absoluteX: number, absoluteY: number, scrollOffset: number) => {
      const current = session.current;
      if (!current) return;
      const config = autoScrollRef.current;
      if (config) {
        const bounds = config.getBounds();
        if (bounds.top !== current.bounds.top || bounds.bottom !== current.bounds.bottom) {
          current.bounds = bounds;
          scrollBounds.value = bounds;
        }
        const maxOffset = config.getMaxOffset();
        if (maxOffset !== current.maxOffset) {
          current.maxOffset = maxOffset;
          maxScrollOffset.value = maxOffset;
        }
      }
      onDragMove?.({ absoluteX, absoluteY, scrollOffset });
      const localX = absoluteX - gridOrigin.current.x;
      const scrollDelta = scrollOffset - current.scrollStart;
      const localY = absoluteY - gridOrigin.current.y + scrollDelta;
      const target = nearestGridSlot(current.slots, { x: localX, y: localY }, current.over);
      if (target === current.over) return;
      current.over = target;
      if (previewReadyRef.current) setDragOrder(moveGridItem(current.order, current.from, target));
    },
    [maxScrollOffset, onDragMove, scrollBounds],
  );

  const autoScrollFrame = useFrameCallback(
    useCallback(
      ({ timeSincePreviousFrame }: FrameInfo) => {
        'worklet';
        if (!isTouchActiveNative.value || !scrollRef) return;
        const velocity = nativeGridAutoScrollVelocity(pointer.value.y, scrollBounds.value);
        if (!velocity) return;
        const elapsed = Math.min(32, timeSincePreviousFrame ?? 0);
        const before = scrollPosition.value;
        const next = Math.max(
          0,
          Math.min(maxScrollOffset.value, before + (velocity * elapsed) / 1000),
        );
        if (next === before) return;
        // Keep the commanded offset on the UI thread. Delayed scroll events must
        // not rewind the next frame, and JS reorders must not pause scrolling.
        scrollPosition.value = next;
        scrollTo(scrollRef, 0, next, false);
        runOnJS(moveDrag)(pointer.value.x, pointer.value.y, next);
      },
      [
        isTouchActiveNative,
        maxScrollOffset,
        moveDrag,
        pointer,
        scrollBounds,
        scrollPosition,
        scrollRef,
      ],
    ),
    false,
  );
  useEffect(() => {
    autoScrollFrame.setActive(activeKey !== undefined);
    return () => autoScrollFrame.setActive(false);
  }, [activeKey, autoScrollFrame]);

  const finishDrag = useCallback(() => {
    const current = session.current;
    if (!current) return;
    const result = {
      data: moveGridItem(current.order, current.from, current.over),
      from: current.from,
      to: current.over,
    };
    clearDrag();
    onDragEnd(result);
  }, [clearDrag, onDragEnd]);

  const cancelDrag = useCallback(() => {
    if (!session.current) return;
    clearDrag();
    onDragCancel?.();
  }, [clearDrag, onDragCancel]);

  const displayed = dragOrder ?? data;
  const { onLayout: onGridLayout, gap, itemWidth } = useGridMetrics(columns);
  return (
    <View
      ref={gridRef}
      onLayout={(event) => {
        onGridLayout(event);
        measureGridOrigin();
      }}
      style={[styles.grid, { columnGap: gap }, contentContainerStyle]}
    >
      {displayed.map((item, index) => {
        const itemKey = keyExtractor(item);
        return (
          <NativeGridCell
            key={itemKey}
            active={itemKey === activeKey}
            cellRefs={cellRefs}
            disabled={disabled}
            previewReady={previewReady}
            index={index}
            item={item}
            itemKey={itemKey}
            itemWidth={itemWidth}
            horizontalTranslate={horizontalTranslate}
            touchTranslate={touchTranslate}
            isTouchActiveNative={isTouchActiveNative}
            pointer={pointer}
            scrollPosition={scrollPosition}
            nativeScrollOffset={nativeScrollOffset}
            onBegin={beginDrag}
            onCancel={cancelDrag}
            onFinish={finishDrag}
            onMove={moveDrag}
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
  previewReady,
  horizontalTranslate,
  index,
  item,
  itemKey,
  itemWidth,
  isTouchActiveNative,
  pointer,
  scrollPosition,
  nativeScrollOffset,
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
  previewReady: boolean;
  horizontalTranslate: SharedValue<number>;
  index: number;
  item: T;
  itemKey: string;
  itemWidth: DimensionValue;
  isTouchActiveNative: SharedValue<boolean>;
  pointer: SharedValue<{ x: number; y: number }>;
  scrollPosition: SharedValue<number>;
  nativeScrollOffset?: SharedValue<number>;
  onBegin: (item: T, index: number, scrollOffset: number) => void;
  onCancel: () => void;
  onFinish: () => void;
  onMove: (absoluteX: number, absoluteY: number, scrollOffset: number) => void;
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
        .onStart((event) => {
          horizontalTranslate.value = 0;
          touchTranslate.value = 0;
          isTouchActiveNative.value = true;
          pointer.value = { x: event.absoluteX, y: event.absoluteY };
          scrollPosition.value = nativeScrollOffset?.value ?? 0;
          runOnJS(onBegin)(item, index, scrollPosition.value);
        })
        .onUpdate((event) => {
          horizontalTranslate.value = event.translationX;
          touchTranslate.value = event.translationY;
          pointer.value = { x: event.absoluteX, y: event.absoluteY };
          runOnJS(onMove)(event.absoluteX, event.absoluteY, scrollPosition.value);
        })
        .onEnd((event, success) => {
          isTouchActiveNative.value = false;
          if (!success) return;
          runOnJS(onMove)(event.absoluteX, event.absoluteY, scrollPosition.value);
          runOnJS(onFinish)();
        })
        .onFinalize((_event, success) => {
          isTouchActiveNative.value = false;
          if (onTouchStateChange) runOnJS(onTouchStateChange)(false);
          if (!success) runOnJS(onCancel)();
        }),
    [
      disabled,
      horizontalTranslate,
      index,
      item,
      isTouchActiveNative,
      nativeScrollOffset,
      pointer,
      scrollPosition,
      onBegin,
      onCancel,
      onFinish,
      onMove,
      onTouchStateChange,
      touchTranslate,
    ],
  );

  return (
    <View
      onLayout={(event) => saveSlotLayout(event.nativeEvent.layout)}
      style={[styles.cell, { width: itemWidth }]}
    >
      <GestureDetector gesture={gesture}>
        <View
          ref={setCellRef}
          testID={`native-grid-item-${itemKey}`}
          style={[styles.cellContent, active && previewReady && styles.placeholder]}
        >
          {renderItem({ item, index, isActive: active })}
        </View>
      </GestureDetector>
    </View>
  );
}

const NativeGridCell = memo(NativeGridCellImpl) as typeof NativeGridCellImpl;

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 12,
  },
  cell: { minWidth: 0, flexGrow: 0, flexShrink: 0 },
  cellContent: { width: '100%' },
  placeholder: { opacity: 0 },
});
