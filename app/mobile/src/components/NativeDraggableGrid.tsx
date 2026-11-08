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
  default as Animated,
  runOnJS,
  scrollTo,
  type AnimatedRef,
  type FrameInfo,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { NativePosterDragMotion } from '@/components/NativePosterDragPreview';

export type NativeGridDragMotion = NativePosterDragMotion & {
  horizontalTranslate: SharedValue<number>;
};

type DragSession<T> = {
  state: 'awaitingPreview' | 'dragging';
  bounds: { bottom: number; top: number };
  from: number;
  itemKey: string;
  maxOffset: number;
  order: T[];
  over: number;
  origin?: { x: number; y: number; scrollOffset: number };
  slots: Map<number, DragLayout>;
};

export type NativeGridDropTarget = (
  x: number,
  y: number,
  offset: number,
) => { index: number; distance: number };

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

/** One grid-local coordinate system for rendering, hit testing, and section height. */
export function nativeGridGeometry(
  heights: readonly (number | undefined)[],
  columns: number,
  width: number,
  gap: number,
  rowGap: number,
  paddingTop = 0,
  paddingBottom = 0,
  fallbackHeight = 1,
) {
  const slots = new Map<number, DragLayout>();
  let y = paddingTop;
  let readyThrough = 0;
  let ready = width > 0;
  for (let start = 0; start < heights.length; start += columns) {
    const row = heights.slice(start, start + columns);
    const rowHeight = Math.max(...row.map((height) => height ?? fallbackHeight));
    ready = ready && row.every((height) => height !== undefined && height > 0);
    for (let column = 0; column < row.length; column++) {
      slots.set(start + column, {
        x: column * (width + gap),
        y,
        width,
        height: row[column] ?? fallbackHeight,
      });
    }
    if (ready) readyThrough = start + row.length;
    y += rowHeight + (start + columns < heights.length ? rowGap : 0);
  }
  return { slots, readyThrough, height: y + paddingBottom };
}

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

/** Keep one viewport of rows on either side, without mounting the entire library. */
export function nativeRowWindow(count: number, height: number, top: number, bottom: number) {
  const overscan = Math.max(4, Math.ceil((bottom - top) / height));
  const start = Math.min(count, Math.max(0, Math.floor(top / height) - overscan));
  const end = Math.max(start, Math.min(count, Math.ceil(bottom / height) + overscan));
  return { start, end };
}

export function NativeDraggableGrid<T>({
  autoScroll,
  contentContainerStyle,
  data,
  disabled,
  externalPlaceholder,
  onDropTarget,
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
  rowHeight,
  sectionTop,
}: {
  autoScroll?: NativeGridAutoScroll;
  contentContainerStyle?: StyleProp<ViewStyle>;
  data: T[];
  disabled: boolean;
  externalPlaceholder?: { index: number; height: number };
  onDropTarget?: (target: NativeGridDropTarget | undefined) => void;
  columns: number;
  keyExtractor: (item: T) => string;
  onDragBegin: (event: { index: number; item: T }) => void;
  onDragCancel?: () => void;
  onDragEnd: (event: { data: T[]; from: number; to: number }) => void;
  onDragLayout?: (layout: DragLayout) => void;
  onDragMove?: (event: {
    absoluteX: number;
    absoluteY: number;
    scrollOffset: number;
  }) => boolean | void;
  onMotionInit?: (motion: NativeGridDragMotion) => void;
  onTouchStateChange?: (touching: boolean) => void;
  renderItem: (event: { index: number; isActive: boolean; item: T }) => ReactNode;
  /** Uniform single-column rows can be windowed within the existing parent scroll view. */
  rowHeight?: number;
  /** Remeasure when an earlier section changes height without relaying out this grid. */
  sectionTop?: number;
}) {
  const horizontalTranslate = useSharedValue(0);
  const touchTranslate = useSharedValue(0);
  const isTouchActiveNative = useSharedValue(false);
  const [previewReady, setPreviewReady] = useState(false);
  const pointer = useSharedValue({ x: 0, y: 0 });
  const scrollPosition = useSharedValue(0);
  const scrollBounds = useSharedValue({ top: 0, bottom: 0 });
  const maxScrollOffset = useSharedValue(0);
  const nativeScrollOffset = autoScroll?.offset;
  const scrollRef = autoScroll?.scrollRef;
  const dataRef = useRef(data);
  const gridRef = useRef<View>(null);
  const gridOrigin = useRef({ x: 0, y: 0 });
  const externalPlaceholderRef = useRef(externalPlaceholder);
  externalPlaceholderRef.current = externalPlaceholder;
  const contentTop = useRef<number | null>(null);
  const windowed = !!autoScroll && columns === 1 && !!rowHeight && data.length > 40;
  // Measure the full-height container before mounting rows, including distant sections.
  const [rowWindow, setRowWindow] = useState<{ start: number; end: number } | null>(null);
  const updateRowWindow = useCallback(
    (offset: number) => {
      if (!windowed || !rowHeight || !autoScroll || contentTop.current === null) return;
      const bounds = autoScroll.getBounds();
      if (bounds.bottom <= bounds.top) return;
      const next = nativeRowWindow(
        data.length,
        rowHeight,
        offset + bounds.top - contentTop.current,
        offset + bounds.bottom - contentTop.current,
      );
      setRowWindow((current) =>
        current?.start === next.start && current?.end === next.end ? current : next,
      );
    },
    [autoScroll, data.length, rowHeight, windowed],
  );
  const measureGridOrigin = useCallback(() => {
    gridRef.current?.measureInWindow((x, y, width, height) => {
      if (width <= 0 || height <= 0) return;
      const offset = nativeScrollOffset?.value ?? 0;
      gridOrigin.current = { x, y: y + offset };
      contentTop.current = y + offset;
      updateRowWindow(offset);
    });
  }, [nativeScrollOffset, updateRowWindow]);
  useAnimatedReaction(
    () => (windowed ? (nativeScrollOffset?.value ?? 0) : 0),
    (offset, previous) => {
      if (windowed && offset !== previous) runOnJS(updateRowWindow)(offset);
    },
    [windowed, updateRowWindow],
  );
  useEffect(measureGridOrigin, [measureGridOrigin, sectionTop]);
  const cellRefs = useRef(new Map<string, View>());
  const slotLayouts = useRef(new Map<number, LayoutRectangle>());
  const session = useRef<DragSession<T> | undefined>(undefined);
  const onDragMoveRef = useRef(onDragMove);
  const autoScrollRef = useRef(autoScroll);
  const [dragOrder, setDragOrder] = useState<T[]>();
  const [activeKey, setActiveKey] = useState<string>();
  const measuredHeights = useRef(new Map<string, number>());
  const measuredWidth = useRef(0);
  const [measurement, setMeasurement] = useState<LayoutRectangle>();
  const measureCard = useCallback((key: string, layout: LayoutRectangle) => {
    if (layout.width <= 0 || layout.height <= 0) return;
    if (
      measuredHeights.current.get(key) === layout.height &&
      measuredWidth.current === layout.width
    )
      return;
    measuredHeights.current.set(key, layout.height);
    measuredWidth.current = layout.width;
    setMeasurement({ ...layout });
  }, []);
  const { onLayout: onGridLayout, gap, itemWidth } = useGridMetrics(columns);
  const displayed = dragOrder ?? data;
  const placeholderIndex = externalPlaceholder?.index;
  const gridStyle = StyleSheet.flatten(contentContainerStyle);
  const rowGap = rowHeight ? 0 : typeof gridStyle?.rowGap === 'number' ? gridStyle.rowGap : 12;
  const paddingTop = typeof gridStyle?.paddingTop === 'number' ? gridStyle.paddingTop : 0;
  const paddingBottom = typeof gridStyle?.paddingBottom === 'number' ? gridStyle.paddingBottom : 0;
  const geometry = useMemo(() => {
    const heights = displayed.map(
      (item) => rowHeight ?? measuredHeights.current.get(keyExtractor(item)),
    );
    if (externalPlaceholder)
      heights.splice(externalPlaceholder.index, 0, rowHeight ?? externalPlaceholder.height);
    return nativeGridGeometry(
      heights,
      columns,
      typeof itemWidth === 'number' ? itemWidth : (measurement?.width ?? 0),
      typeof gap === 'number' ? gap : 0,
      rowGap,
      paddingTop,
      paddingBottom,
      rowHeight ?? Math.max(1, ...measuredHeights.current.values()),
    );
  }, [
    columns,
    displayed,
    externalPlaceholder,
    gap,
    itemWidth,
    keyExtractor,
    measurement,
    paddingBottom,
    paddingTop,
    rowGap,
    rowHeight,
  ]);
  slotLayouts.current = new Map(
    [...geometry.slots].filter(([index]) => index < geometry.readyThrough),
  );

  useEffect(() => {
    // Empty groups use their section bounds and the only valid insertion index, zero.
    if (!data.length) {
      onDropTarget?.(undefined);
      return;
    }
    onDropTarget?.((x, y, offset) => {
      const point = { x: x - gridOrigin.current.x, y: y + offset - gridOrigin.current.y };
      const placeholder = externalPlaceholderRef.current;
      if (windowed && rowHeight) {
        if (contentTop.current === null) return { index: 0, distance: Number.POSITIVE_INFINITY };
        const height = (dataRef.current.length + (placeholder ? 1 : 0)) * rowHeight;
        return {
          index: Math.max(0, Math.min(dataRef.current.length, Math.floor(point.y / rowHeight))),
          distance: Math.max(-point.y, point.y - height, 0),
        };
      }
      const slots = slotLayouts.current;
      const index = nearestGridSlot(slots, point, 0);
      const slot = slots.get(index);
      if (!slot) return { index: 0, distance: Number.POSITIVE_INFINITY };
      // Match same-section reordering: hovering a card opens its slot.
      // Advance beyond the final slot only when the pointer passes its edge.
      const after =
        !placeholder &&
        index === dataRef.current.length - 1 &&
        (point.y > slot.y + slot.height || (columns > 1 && point.x > slot.x + slot.width));
      const top = Math.min(...Array.from(slots.values(), (layout) => layout.y));
      const bottom = Math.max(...Array.from(slots.values(), (layout) => layout.y + layout.height));
      return {
        index: Math.min(dataRef.current.length, index + (after ? 1 : 0)),
        distance: Math.max(top - point.y, point.y - bottom, 0),
      };
    });
    return () => onDropTarget?.(undefined);
  }, [columns, data.length, onDropTarget, rowHeight, windowed]);

  const onPreviewReady = useCallback(() => {
    const current = session.current;
    if (!current || current.state === 'dragging') return;
    current.state = 'dragging';
    setPreviewReady(true);
    setDragOrder(moveGridItem(current.order, current.from, current.over));
  }, []);
  const motion = useMemo<NativeGridDragMotion>(
    () => ({ horizontalTranslate, isTouchActiveNative, touchTranslate, onPreviewReady }),
    [horizontalTranslate, isTouchActiveNative, touchTranslate, onPreviewReady],
  );

  dataRef.current = data;
  autoScrollRef.current = autoScroll;
  onDragMoveRef.current = onDragMove;

  const clearDrag = useCallback(() => {
    session.current = undefined;
    setActiveKey(undefined);
    setDragOrder(undefined);
    // The cards already occupy the preview order. Reveal the dragged card in
    // the same commit that removes the floating preview; no offsets to reset.
    isTouchActiveNative.value = false;
  }, [isTouchActiveNative]);

  const beginDrag = useCallback(
    (item: T, index: number) => {
      if (disabled) return;
      const itemKey = keyExtractor(item);
      const order = [...dataRef.current];
      const bounds = autoScrollRef.current?.getBounds() ?? { top: 0, bottom: 0 };
      const maxOffset = autoScrollRef.current?.getMaxOffset() ?? 0;
      const current: DragSession<T> = {
        state: onMotionInit ? 'awaitingPreview' : 'dragging',
        bounds,
        from: index,
        itemKey,
        maxOffset,
        order,
        over: index,
        // Hit-test against the original slots as the keyed cards change order.
        slots:
          windowed && rowHeight
            ? new Map(
                order.map((_, slot) => [
                  slot,
                  {
                    x: 0,
                    y: slot * rowHeight,
                    width: slotLayouts.current.get(index)?.width ?? 0,
                    height: rowHeight,
                  },
                ]),
              )
            : new Map(slotLayouts.current),
      };
      session.current = current;
      setPreviewReady(false);
      setDragOrder(order);
      setActiveKey(itemKey);
      scrollBounds.value = bounds;
      maxScrollOffset.value = maxOffset;
      // Publish motion together with the drag so the preview receives both in
      // the same render, without notifying the parent for every idle grid.
      onMotionInit?.(motion);
      onDragBegin({ item, index });
      // Measurements are async. Ignore hit tests until this drag has its own origin,
      // and ignore late callbacks from a completed or cancelled drag.
      gridRef.current?.measureInWindow((x, y, width, height) => {
        if (session.current !== current || width <= 0 || height <= 0) return;
        current.origin = { x, y, scrollOffset: scrollPosition.value };
      });
      cellRefs.current.get(itemKey)?.measureInWindow((x, y, width, height) => {
        if (session.current === current) onDragLayout?.({ x, y, width, height });
      });
    },
    [
      disabled,
      keyExtractor,
      maxScrollOffset,
      scrollBounds,
      scrollPosition,
      onDragBegin,
      onDragLayout,
      onMotionInit,
      motion,
      rowHeight,
      windowed,
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
      const reorderHere = onDragMoveRef.current?.({ absoluteX, absoluteY, scrollOffset });
      // Crossing a section must not shuffle the source toward its nearest edge.
      if (reorderHere === false) {
        if (current.over !== current.from) {
          current.over = current.from;
          if (current.state === 'dragging') setDragOrder(current.order);
        }
        return;
      }
      if (!current.origin) return;
      const localX = absoluteX - current.origin.x;
      const scrollDelta = scrollOffset - current.origin.scrollOffset;
      const localY = absoluteY - current.origin.y + scrollDelta;
      const target = nearestGridSlot(current.slots, { x: localX, y: localY }, current.over);
      if (target === current.over) return;
      current.over = target;
      if (current.state === 'dragging')
        setDragOrder(moveGridItem(current.order, current.from, target));
    },
    [maxScrollOffset, scrollBounds],
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

  const placeholder = externalPlaceholder ? (
    <View
      key="drop-placeholder"
      testID="native-grid-drop-placeholder"
      accessibilityLabel="Drop title here"
      pointerEvents="none"
      style={{
        opacity: 0,
        position: 'absolute',
        left: 0,
        top: 0,
        width: itemWidth,
        height: externalPlaceholder.height,
      }}
    />
  ) : null;
  const visible = windowed
    ? displayed.flatMap((item, index) =>
        (rowWindow && index >= rowWindow.start && index < rowWindow.end) ||
        keyExtractor(item) === activeKey
          ? [{ item, index }]
          : [],
      )
    : displayed.map((item, index) => ({ item, index }));

  return (
    <View
      ref={gridRef}
      testID="native-grid"
      onLayout={(event) => {
        onGridLayout(event);
        measureGridOrigin();
      }}
      style={[
        styles.grid,
        { columnGap: gap },
        contentContainerStyle,
        { height: Math.max(1, geometry.height), overflow: 'hidden' },
      ]}
    >
      {visible.flatMap(({ item, index }) => {
        const itemKey = keyExtractor(item);
        return [
          index === placeholderIndex ? placeholder : null,
          <NativeGridCell
            key={itemKey}
            active={itemKey === activeKey}
            cellRefs={cellRefs}
            disabled={disabled}
            previewReady={itemKey === activeKey && previewReady}
            index={index}
            item={item}
            itemKey={itemKey}
            itemWidth={itemWidth}
            fixedHeight={rowHeight}
            targetX={
              geometry.slots.get(
                index + (placeholderIndex !== undefined && index >= placeholderIndex ? 1 : 0),
              )?.x ?? 0
            }
            targetY={
              geometry.slots.get(
                index + (placeholderIndex !== undefined && index >= placeholderIndex ? 1 : 0),
              )?.y ?? 0
            }
            positionReady={
              index + (placeholderIndex !== undefined && index >= placeholderIndex ? 1 : 0) <
              geometry.readyThrough
            }
            onMeasure={measureCard}
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
          />,
        ];
      })}
      {placeholderIndex === displayed.length && placeholder}
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
  fixedHeight,
  targetX,
  targetY,
  positionReady,
  onMeasure,
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
  fixedHeight?: number;
  targetX: number;
  targetY: number;
  positionReady: boolean;
  onMeasure: (key: string, layout: LayoutRectangle) => void;
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
  touchTranslate: SharedValue<number>;
}) {
  const cellMap = cellRefs.current;
  const setCellRef = useCallback(
    (node: View | null) => {
      if (node) cellMap.set(itemKey, node);
      else cellMap.delete(itemKey);
    },
    [cellMap, itemKey],
  );
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const positioned = useSharedValue(false);
  const hasPosition = useRef(false);
  useEffect(() => {
    if (!positionReady) return;
    x.value = hasPosition.current ? withTiming(targetX, { duration: 160 }) : targetX;
    y.value = hasPosition.current ? withTiming(targetY, { duration: 160 }) : targetY;
    positioned.value = true;
    hasPosition.current = true;
  }, [positionReady, positioned, targetX, targetY, x, y]);
  const positionStyle = useAnimatedStyle(() => ({
    opacity: positioned.value ? 1 : 0,
    transform: [{ translateX: x.value }, { translateY: y.value }],
  }));
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
    <Animated.View
      onLayout={(event) => onMeasure(itemKey, event.nativeEvent.layout)}
      pointerEvents={positionReady ? 'auto' : 'none'}
      style={[styles.cell, { width: itemWidth, height: fixedHeight }, positionStyle]}
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
    </Animated.View>
  );
}

const NativeGridCell = memo(NativeGridCellImpl) as typeof NativeGridCellImpl;

const styles = StyleSheet.create({
  grid: {
    overflow: 'hidden',
  },
  cell: { position: 'absolute', left: 0, top: 0, minWidth: 0 },
  cellContent: { width: '100%' },
  placeholder: { opacity: 0 },
});
