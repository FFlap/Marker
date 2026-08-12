import {
  createElement,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { router } from 'expo-router';
import {
  NestableDraggableFlatList,
  NestableScrollContainer,
  RenderItemParams,
  ScaleDecorator,
  ShadowDecorator,
} from 'react-native-draggable-flatlist';
import { ReduceMotion, runOnJS, useAnimatedReaction } from 'react-native-reanimated';
import { Button, Chip, EmptyState } from '@/components/ui/primitives';
import { NativePressable } from '@/components/ui/NativePressable';
import { PosterImage } from '@/components/ui/PosterImage';
import { useToast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import type { LibraryItem, Status } from '@/types';
import { ScreenErrorBoundary } from '@/components/ScreenErrorBoundary';
import { PinchDensity } from '@/components/PinchDensity';
import { LibraryPageSkeleton } from '@/components/PageSkeletons';
import type { AppDrawerHandle } from '@/components/AppDrawer';
import { TabHeader } from '@/components/TabHeader';
import { MobileNav } from '@/components/MobileNav';
import {
  NativePosterDragPreview,
  type NativePosterDragLayout,
  type NativePosterDragMotion,
} from '@/components/NativePosterDragPreview';
import {
  NativeDraggableGrid,
  type NativeGridAutoScroll,
  type NativeGridDragMotion,
} from '@/components/NativeDraggableGrid';
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { LayoutGrid, List, Plus, SlidersHorizontal } from 'lucide-react-native';
import { createStyles } from '@/lib/typography';
import {
  DEFAULT_DISPLAY_PREFERENCES,
  gridItemWidth,
  listItemWidth,
  listTypography,
  type GridColumns,
  type ListTextSize,
} from '@/lib/displayPreferences';
import {
  LIBRARY_STATUSES,
  matchesMediaType,
  type MediaTypeFilter,
  type StatusFilter,
} from '@/lib/libraryFilters';

const categoryAccessibilityActions = LIBRARY_STATUSES.map(([status, label]) => ({
  name: `moveTo:${status}`,
  label: `Move to ${label}`,
}));
const EMPTY_ITEMS: LibraryItem[] = [];
const TOOLBAR_HEIGHT = 60;
const MOBILE_NAV_HEIGHT = 66;
const WEB_ROW_DRAG_STYLE: CSSProperties = {
  width: '100%',
  minWidth: 0,
  overflow: 'hidden',
};
const NATIVE_DRAG_ANIMATION = {
  damping: 26,
  stiffness: 260,
  mass: 0.7,
  overshootClamping: true,
  reduceMotion: ReduceMotion.System,
};
type WebDragRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};
type ActiveWebDrag = {
  autoScrollFrame?: number;
  dropped: boolean;
  frame?: number;
  from: number;
  itemId: string;
  nodes: HTMLElement[];
  over: number;
  pendingOver: number;
  pointerX: number;
  pointerY: number;
  rects: WebDragRect[];
  reducedMotion: boolean;
  scrollElement: HTMLElement;
  status: Status;
  dropZone?: HTMLElement;
};
let activeWebDrag: ActiveWebDrag | undefined;
const clearWebDragStyles = () => {
  const session = activeWebDrag;
  if (!session) return;
  if (session.autoScrollFrame !== undefined) window.cancelAnimationFrame(session.autoScrollFrame);
  if (session.frame !== undefined) window.cancelAnimationFrame(session.frame);
  if (session.dropZone) {
    session.dropZone.style.backgroundColor = '';
    session.dropZone.style.boxShadow = '';
    session.dropZone.style.borderRadius = '';
  }
  for (const node of session.nodes) {
    node.style.backgroundColor = '';
    node.style.borderRadius = '';
    node.style.boxShadow = '';
    node.style.opacity = '';
    node.style.transform = '';
    node.style.transition = '';
    node.style.willChange = '';
    node.style.zIndex = '';
    node.removeAttribute('aria-grabbed');
  }
  activeWebDrag = undefined;
};
const runWebAutoScroll = () => {
  const session = activeWebDrag;
  if (!session) return;
  session.autoScrollFrame = undefined;
  const bounds = session.scrollElement.getBoundingClientRect();
  const edgeSize = Math.min(84, bounds.height * 0.18);
  const topDistance = session.pointerY - bounds.top;
  const bottomDistance = bounds.bottom - session.pointerY;
  let speed = 0;
  if (topDistance < edgeSize) speed = -20 * Math.max(0, 1 - Math.max(0, topDistance) / edgeSize);
  else if (bottomDistance < edgeSize)
    speed = 20 * Math.max(0, 1 - Math.max(0, bottomDistance) / edgeSize);
  if (!speed) return;
  const before = session.scrollElement.scrollTop;
  session.scrollElement.scrollTop += speed;
  const delta = session.scrollElement.scrollTop - before;
  if (!delta) return;
  session.rects = session.rects.map((rect) => ({
    ...rect,
    top: rect.top - delta,
  }));
  const over = webDragIndexAtPoint(session.pointerX, session.pointerY);
  if (over !== undefined) scheduleWebDrag(over);
  session.autoScrollFrame = window.requestAnimationFrame(runWebAutoScroll);
};
const updateWebAutoScroll = (clientX: number, clientY: number) => {
  const session = activeWebDrag;
  if (!session) return;
  session.pointerX = clientX;
  session.pointerY = clientY;
  if (session.autoScrollFrame === undefined)
    session.autoScrollFrame = window.requestAnimationFrame(runWebAutoScroll);
};
const webDragIndexAtPoint = (clientX: number, clientY: number) => {
  const session = activeWebDrag;
  if (!session) return;
  const columns = new Set(session.rects.map((rect) => Math.round(rect.left))).size;
  let nearestIndex = session.over;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const [index, rect] of session.rects.entries()) {
    const xDistance =
      columns > 1 ? (clientX - (rect.left + rect.width / 2)) / Math.max(rect.width, 1) : 0;
    const yDistance = (clientY - (rect.top + rect.height / 2)) / Math.max(rect.height, 1);
    const distance = xDistance * xDistance + yDistance * yDistance;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }
  return nearestIndex;
};
const positionWebDrag = (over: number) => {
  const session = activeWebDrag;
  if (!session) return;
  session.over = over;
  for (const [index, node] of session.nodes.entries()) {
    let destination = index;
    if (index === session.from) destination = over;
    else if (session.from < over && index > session.from && index <= over) destination = index - 1;
    else if (session.from > over && index >= over && index < session.from) destination = index + 1;
    const fromRect = session.rects[index];
    const toRect = session.rects[destination];
    if (!fromRect || !toRect) continue;
    const x = toRect.left - fromRect.left;
    const y = toRect.top - fromRect.top;
    node.style.transition = session.reducedMotion
      ? 'none'
      : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), opacity 140ms ease-out, box-shadow 140ms ease-out';
    node.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    node.style.willChange = 'transform';
    if (index === session.from) {
      node.style.opacity = '0';
      node.setAttribute('aria-grabbed', 'true');
    }
  }
};
const scheduleWebDrag = (over: number) => {
  const session = activeWebDrag;
  if (!session) return;
  session.pendingOver = over;
  if (session.frame !== undefined) return;
  session.frame = window.requestAnimationFrame(() => {
    const current = activeWebDrag;
    if (!current) return;
    current.frame = undefined;
    if (current.over !== current.pendingOver) positionWebDrag(current.pendingOver);
  });
};
const statusDropZoneProps = (
  disabled: boolean,
  status: Status,
  onCrossDrop: (itemId: string, status: Status) => void,
) => ({
  'data-status-drop-zone': status,
  onDragEnter: (event: DragEvent<HTMLDivElement>) => {
    const session = activeWebDrag;
    if (disabled || !session) return;
    if (session.status === status) {
      if (session.dropZone) {
        session.dropZone.style.backgroundColor = '';
        session.dropZone.style.boxShadow = '';
        session.dropZone.style.borderRadius = '';
        session.dropZone = undefined;
      }
      return;
    }
    event.preventDefault();
    if (session.dropZone && session.dropZone !== event.currentTarget) {
      session.dropZone.style.backgroundColor = '';
      session.dropZone.style.boxShadow = '';
      session.dropZone.style.borderRadius = '';
    }
    session.dropZone = event.currentTarget;
    event.currentTarget.style.backgroundColor = colors.surface;
    event.currentTarget.style.borderRadius = '12px';
    event.currentTarget.style.boxShadow = `inset 0 0 0 1px ${colors.text}`;
  },
  onDragOver: (event: DragEvent<HTMLDivElement>) => {
    if (disabled || !activeWebDrag || activeWebDrag.status === status) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  },
  onDragLeave: (event: DragEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    const session = activeWebDrag;
    if (session?.dropZone !== event.currentTarget) return;
    event.currentTarget.style.backgroundColor = '';
    event.currentTarget.style.boxShadow = '';
    event.currentTarget.style.borderRadius = '';
    session.dropZone = undefined;
  },
  onDrop: (event: DragEvent<HTMLDivElement>) => {
    const session = activeWebDrag;
    if (disabled || !session || session.status === status) return;
    event.preventDefault();
    session.dropped = true;
    const itemId = session.itemId;
    clearWebDragStyles();
    onCrossDrop(itemId, status);
  },
});
const createDrawerEdgeSwipe = (drawer: AppDrawerHandle | null, isBlocked: () => boolean) =>
  PanResponder.create({
    // Let poster gestures claim the touch before considering the drawer edge.
    // Capturing here could cancel a long-press drag as soon as it moved sideways.
    onMoveShouldSetPanResponder: (_, gesture) =>
      Platform.OS !== 'web' &&
      !isBlocked() &&
      gesture.x0 <= 28 &&
      gesture.dx > 10 &&
      Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.25,
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dx >= 52 || gesture.vx >= 0.55) drawer?.open();
    },
    onPanResponderTerminate: (_, gesture) => {
      if (gesture.dx >= 72) drawer?.open();
    },
  });
function WebDraggable({
  children,
  itemId,
  index,
  status,
  disabled,
  onDrop,
  style,
}: {
  children: ReactNode;
  itemId: string;
  index: number;
  status: Status;
  disabled: boolean;
  onDrop: (from: number, to: number) => Promise<void> | void;
  style?: unknown;
}) {
  return createElement(
    'div',
    {
      draggable: !disabled,
      'data-reorder-index': String(index),
      'data-reorder-status': status,
      onDragStart: (event: DragEvent<HTMLDivElement>) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(index));
        const container = event.currentTarget.parentElement;
        if (!container) return;
        const nodes = Array.from(container.children).filter(
          (node): node is HTMLElement =>
            node instanceof HTMLElement && node.dataset.reorderStatus === status,
        );
        const scrollElement =
          (container.closest('[data-testid="library-scroll"]') as HTMLElement | null) ??
          (document.scrollingElement as HTMLElement | null);
        if (!scrollElement) return;
        activeWebDrag = {
          dropped: false,
          from: index,
          itemId,
          nodes,
          over: index,
          pendingOver: index,
          pointerX: event.clientX,
          pointerY: event.clientY,
          rects: nodes.map((node) => {
            const rect = node.getBoundingClientRect();
            return {
              height: rect.height,
              left: rect.left,
              top: rect.top,
              width: rect.width,
            };
          }),
          reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
          scrollElement,
          status,
        };
        positionWebDrag(index);
      },
      onDragEnter: (event: DragEvent<HTMLDivElement>) => {
        if (disabled || activeWebDrag?.status !== status) return;
        event.preventDefault();
        updateWebAutoScroll(event.clientX, event.clientY);
        const over = webDragIndexAtPoint(event.clientX, event.clientY);
        if (over !== undefined) scheduleWebDrag(over);
      },
      onDragOver: (event: DragEvent<HTMLDivElement>) => {
        if (disabled) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        if (activeWebDrag?.status !== status) return;
        updateWebAutoScroll(event.clientX, event.clientY);
        const over = webDragIndexAtPoint(event.clientX, event.clientY);
        if (over !== undefined) scheduleWebDrag(over);
      },
      onDrop: (event: DragEvent<HTMLDivElement>) => {
        if (disabled) return;
        event.preventDefault();
        const session = activeWebDrag;
        if (!session || session.status !== status) return;
        session.dropped = true;
        const pointedIndex = webDragIndexAtPoint(event.clientX, event.clientY);
        if (pointedIndex !== undefined && pointedIndex !== session.over)
          positionWebDrag(pointedIndex);
        const from = session.from;
        const to = session.over;
        if (from === to) {
          clearWebDragStyles();
          return;
        }
        clearWebDragStyles();
        void onDrop(from, to);
      },
      onDragEnd: () => {
        if (!activeWebDrag?.dropped) clearWebDragStyles();
      },
      style: StyleSheet.flatten(style) as CSSProperties,
    },
    children,
  );
}

function StatusDropZone({
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
      ...statusDropZoneProps(disabled, status, onCrossDrop),
      'data-status-drop-zone': status,
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
export default function LibraryScreen() {
  return (
    <ScreenErrorBoundary message="Couldn’t load your library.">
      <Library />
    </ScreenErrorBoundary>
  );
}
function Library() {
  const itemQuery = useQuery(api.library.listItems);
  const items = itemQuery ?? EMPTY_ITEMS;
  const settings = useQuery(api.settings.getSettings);
  const setSettings = useMutation(api.settings.setSettings);
  const reorder = useMutation(api.library.reorderItem);
  const moveItemToWatched = useAction(api.library.moveItemToWatched);
  const toast = useToast();
  const [viewOverride, setViewOverride] = useState<'list' | 'posters'>();
  const view = viewOverride ?? settings?.defaultView ?? 'list';
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
  const [search, setSearch] = useState('');
  const [type, setType] = useState<MediaTypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [min, setMin] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [addButtonHidden, setAddButtonHidden] = useState(false);
  const [motionReduced, setMotionReduced] = useState(false);
  const [optimisticOrders, setOptimisticOrders] = useState<Partial<Record<Status, string[]>>>({});
  const [optimisticStatuses, setOptimisticStatuses] = useState<Record<string, Status>>({});
  const [pendingWatchedMove, setPendingWatchedMove] = useState<LibraryItem>();
  const [statusMovePending, setStatusMovePending] = useState(false);
  const [nativeDrag, setNativeDrag] = useState<{
    item: LibraryItem;
    rank?: number;
    status: Status;
  }>();
  const [nativeDragPreviewLayout, setNativeDragPreviewLayout] = useState<NativePosterDragLayout>();
  const [nativeTargetStatus, setNativeTargetStatus] = useState<Status>();
  const [nativeListTops, setNativeListTops] = useState<Partial<Record<Status, number>>>({});
  const [sectionLayouts, setSectionLayouts] = useState<
    Partial<Record<Status, { height: number; top: number }>>
  >({});
  const [nativeDragValues, setNativeDragValues] = useState<
    Partial<Record<Status, NativeDragValues>>
  >({});
  const [nativePosterMotion, setNativePosterMotion] = useState<
    Partial<Record<Status, NativeGridDragMotion>>
  >({});
  const [rootHeight, setRootHeight] = useState(0);
  const [scrollY] = useState(() => new Animated.Value(0));
  const toolbarY = useMemo(
    () => Animated.multiply(Animated.diffClamp(scrollY, 0, TOOLBAR_HEIGHT), -1),
    [scrollY],
  );
  const [drawerHandle, setDrawerHandle] = useState<AppDrawerHandle | null>(null);
  const toolbarPosition = useRef(0);
  const lastScrollY = useRef(0);
  const reduceMotion = useRef(false);
  const rootRef = useRef<View>(null);
  const nativePosterScrollRef = useRef<ScrollView>(null);
  const nativeScrollContentHeight = useRef(0);
  const nativeScrollViewportHeight = useRef(0);
  const rootWindowY = useRef(0);
  const nativePosterTouch = useRef(false);
  const reorderVersions = useRef<Partial<Record<Status, number>>>({});
  const nativeDragRef = useRef<{ item: LibraryItem; rank?: number; status: Status } | undefined>(
    undefined,
  );
  const nativeTargetRef = useRef<Status | undefined>(undefined);
  useEffect(() => {
    const setReducedMotion = (enabled: boolean) => {
      reduceMotion.current = enabled;
      setMotionReduced(enabled);
      if (enabled) {
        toolbarPosition.current = 0;
        setAddButtonHidden(false);
      }
    };
    void AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReducedMotion,
    );
    return () => subscription.remove();
  }, []);
  const allTags = useMemo(
    () =>
      [
        ...items
          .flatMap((i) => i.tags)
          .reduce((byKey, tag) => {
            const key = tag.toLocaleLowerCase();
            if (!byKey.has(key)) byKey.set(key, tag);
            return byKey;
          }, new Map<string, string>())
          .values(),
      ].sort((a, b) => a.localeCompare(b)),
    [items],
  );
  const selectedTags = new Set(tags);
  const filtered = useMemo(
    () =>
      items.filter(
        (i) =>
          matchesMediaType(i, type) &&
          (statusFilter === 'all' || i.status === statusFilter) &&
          (!min || (i.rating ?? -1) >= min) &&
          tags.every((tag) =>
            i.tags.some((itemTag) => itemTag.toLocaleLowerCase() === tag.toLocaleLowerCase()),
          ) &&
          i.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
      ),
    [items, type, statusFilter, min, tags, search],
  );
  const active =
    !!search.trim() || type !== 'all' || statusFilter !== 'all' || min > 0 || tags.length > 0;
  const visibleStatuses =
    statusFilter === 'all'
      ? LIBRARY_STATUSES
      : LIBRARY_STATUSES.filter(([status]) => status === statusFilter);
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
  const clear = () => {
    setSearch('');
    setType('all');
    setStatusFilter('all');
    setMin(0);
    setTags([]);
  };
  const updateGridColumns = (next: GridColumns) => {
    setGridOverride({ base: settings?.gridColumns, value: next });
    void setSettings({ gridColumns: next }).catch(() => {
      setGridOverride(undefined);
      toast.show('Couldn’t save grid scale');
    });
  };
  const drop = async (data: LibraryItem[], _from: number, to: number) => {
    if (active) {
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
      await reorder({
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
  function effectiveStatus(item: LibraryItem) {
    const optimistic = optimisticStatuses[item._id];
    return optimistic && optimistic !== item.status ? optimistic : item.status;
  }
  const orderedForStatus = (targetStatus: Status) => {
    const order = activeOptimisticOrder(targetStatus);
    return items
      .filter((item) => effectiveStatus(item) === targetStatus)
      .sort((a, b) => {
        if (!order) return a.rank - b.rank;
        const aIndex = order.indexOf(a._id);
        const bIndex = order.indexOf(b._id);
        if (aIndex === -1) return bIndex === -1 ? a.rank - b.rank : 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      });
  };
  const performCategoryMove = async (item: LibraryItem, targetStatus: Status) => {
    if (statusMovePending || effectiveStatus(item) === targetStatus) return;
    const sourceStatus = effectiveStatus(item);
    const sourceItems = orderedForStatus(sourceStatus).filter((entry) => entry._id !== item._id);
    const targetItems = orderedForStatus(targetStatus).filter((entry) => entry._id !== item._id);
    const nextTarget = [...targetItems, item];
    setStatusMovePending(true);
    setOptimisticStatuses((current) => ({ ...current, [item._id]: targetStatus }));
    setOptimisticOrders((current) => ({
      ...current,
      [sourceStatus]: sourceItems.map((entry) => entry._id),
      [targetStatus]: nextTarget.map((entry) => entry._id),
    }));
    try {
      const placement = {
        itemId: item._id,
        beforeId: targetItems[targetItems.length - 1]?._id,
      };
      if (targetStatus === 'watched') await moveItemToWatched(placement);
      else await reorder({ ...placement, status: targetStatus });
    } catch {
      setOptimisticStatuses((current) => {
        const next = { ...current };
        delete next[item._id];
        return next;
      });
      setOptimisticOrders((current) => {
        const next = { ...current };
        delete next[sourceStatus];
        delete next[targetStatus];
        return next;
      });
      toast.show(
        targetStatus === 'watched'
          ? 'Couldn’t mark every episode watched'
          : 'Couldn’t move this title',
      );
    }
    setStatusMovePending(false);
  };
  const requestCategoryMove = (itemId: string, targetStatus: Status) => {
    if (active || statusMovePending) return;
    const item = items.find((entry) => entry._id === itemId);
    if (!item || effectiveStatus(item) === targetStatus) return;
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
  const finishNativeDrag = (status: Status, next: LibraryItem[], from: number, to: number) => {
    const dragged = nativeDragRef.current;
    const target = nativeTargetRef.current;
    setNativeDrag(undefined);
    setNativeDragPreviewLayout(undefined);
    nativePosterTouch.current = false;
    nativeDragRef.current = undefined;
    setNativeTargetStatus(undefined);
    nativeTargetRef.current = undefined;
    if (dragged && target && target !== status) {
      requestCategoryMove(dragged.item._id, target);
      return;
    }
    if (from !== to) void drop(next, from, to);
  };
  const beginNativePosterDrag = (
    item: LibraryItem,
    status: Status,
    index: number,
    ranked: boolean,
  ) => {
    const nextDrag = { item, status, rank: ranked ? index + 1 : undefined };
    nativeTargetRef.current = status;
    setNativeTargetStatus(status);
    nativeDragRef.current = nextDrag;
    setNativeDrag(nextDrag);
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
        setNativeDragPreviewLayout({
          height: layout.height,
          left: layout.x - rootX,
          rank: dragged.rank,
          top: layout.y - rootY,
          width: layout.width,
        });
    });
  };
  const cancelNativePosterDrag = () => {
    setNativeDrag(undefined);
    setNativeDragPreviewLayout(undefined);
    setNativeTargetStatus(undefined);
    nativeDragRef.current = undefined;
    nativeTargetRef.current = undefined;
    nativePosterTouch.current = false;
  };
  const updateToolbarFromScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = Math.max(0, event.nativeEvent.contentOffset.y);
    const delta = y - lastScrollY.current;
    lastScrollY.current = y;
    if (reduceMotion.current) return;
    const next =
      y === 0 ? 0 : Math.max(-TOOLBAR_HEIGHT, Math.min(0, toolbarPosition.current - delta));
    toolbarPosition.current = next;
    setAddButtonHidden(next <= -TOOLBAR_HEIGHT + 1);
  }, []);
  const handleScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        listener: updateToolbarFromScroll,
        useNativeDriver: Platform.OS !== 'web' && view === 'posters',
      }),
    [scrollY, updateToolbarFromScroll, view],
  );
  const nativePosterAutoScroll = useMemo<NativeGridAutoScroll>(
    () => ({
      getBounds: () => ({
        top: rootWindowY.current + TOOLBAR_HEIGHT,
        bottom: rootWindowY.current + Math.max(TOOLBAR_HEIGHT, rootHeight - MOBILE_NAV_HEIGHT),
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
  const edgeSwipe = useMemo(
    () =>
      createDrawerEdgeSwipe(
        drawerHandle,
        () => nativePosterTouch.current || nativeDragRef.current !== undefined,
      ),
    [drawerHandle],
  );
  const LibraryScrollComponent = (
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
      {...(Platform.OS === 'web' || view === 'posters' ? {} : edgeSwipe.panHandlers)}
    >
      <Animated.View
        style={[
          s.toolbar,
          {
            opacity: motionReduced
              ? 1
              : toolbarY.interpolate({
                  inputRange: [-TOOLBAR_HEIGHT, 0],
                  outputRange: [0, 1],
                  extrapolate: 'clamp',
                }),
            transform: [{ translateY: motionReduced ? 0 : toolbarY }],
          },
        ]}
      >
        <TabHeader
          ref={setDrawerHandle}
          accessibilityLabel="Search library"
          testID="library-search"
          value={search}
          onChangeText={setSearch}
          placeholder="Search Library"
          returnKeyType="search"
          maxWidth={880}
          trailing={
            <View style={s.headerActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={view === 'list' ? 'Show poster view' : 'Show list view'}
                accessibilityState={{ selected: view === 'posters' }}
                onPress={() => setViewOverride(view === 'list' ? 'posters' : 'list')}
                style={s.icon}
              >
                {view === 'list' ? (
                  <LayoutGrid size={18} color={colors.text} strokeWidth={1.7} />
                ) : (
                  <List size={18} color={colors.text} strokeWidth={1.7} />
                )}
              </Pressable>
              <Drawer>
                <DrawerTrigger asChild>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Filter library"
                    style={[s.icon, active && s.iconActive]}
                  >
                    <SlidersHorizontal size={18} color={colors.text} strokeWidth={1.7} />
                    {active && <View style={s.activeDot} />}
                  </Pressable>
                </DrawerTrigger>
                <DrawerContent className="max-w-md gap-6 rounded-2xl border-border bg-background p-6">
                  <DrawerHeader>
                    <DrawerTitle>Filters</DrawerTitle>
                  </DrawerHeader>
                  <View style={s.filterGroup}>
                    <Text style={s.filterLabel}>Type</Text>
                    <View style={s.filterWrap}>
                      <Chip
                        label="All"
                        accessibilityLabel="All types"
                        selected={type === 'all'}
                        onPress={() => setType('all')}
                      />
                      <Chip
                        label="Movies"
                        accessibilityLabel="Movies type"
                        selected={type === 'movie'}
                        onPress={() => setType('movie')}
                      />
                      <Chip
                        label="TV Shows"
                        accessibilityLabel="TV Shows type"
                        selected={type === 'tv'}
                        onPress={() => setType('tv')}
                      />
                      <Chip
                        label="Anime"
                        accessibilityLabel="Anime type"
                        selected={type === 'anime'}
                        onPress={() => setType('anime')}
                      />
                    </View>
                  </View>
                  <View style={s.filterGroup}>
                    <Text style={s.filterLabel}>Status</Text>
                    <View style={s.filterWrap}>
                      <Chip
                        label="All"
                        accessibilityLabel="All statuses"
                        selected={statusFilter === 'all'}
                        onPress={() => setStatusFilter('all')}
                      />
                      {LIBRARY_STATUSES.map(([status, label]) => (
                        <Chip
                          key={status}
                          label={label}
                          accessibilityLabel={`${label} status`}
                          selected={statusFilter === status}
                          onPress={() => setStatusFilter(status)}
                        />
                      ))}
                    </View>
                  </View>
                  <View style={s.filterGroup}>
                    <Text style={s.filterLabel}>Minimum Rating</Text>
                    <View style={s.filterWrap}>
                      {[0, 9, 8, 7, 6].map((n) => (
                        <Chip
                          key={n}
                          label={n ? `${n}+` : 'Any'}
                          accessibilityLabel={n ? `${n}+ rating` : 'Any rating'}
                          selected={min === n}
                          onPress={() => setMin(n)}
                        />
                      ))}
                    </View>
                  </View>
                  {allTags.length > 0 && (
                    <View style={s.filterGroup}>
                      <Text style={s.filterLabel}>Tags</Text>
                      <View style={s.filterWrap}>
                        {allTags.map((tag) => (
                          <Chip
                            key={tag}
                            label={tag}
                            selected={selectedTags.has(tag)}
                            onPress={() =>
                              setTags(
                                selectedTags.has(tag)
                                  ? tags.filter((value) => value !== tag)
                                  : [...tags, tag],
                              )
                            }
                          />
                        ))}
                      </View>
                    </View>
                  )}
                  <DrawerFooter>
                    {active && <Chip label="Clear filters" onPress={clear} />}
                  </DrawerFooter>
                </DrawerContent>
              </Drawer>
            </View>
          }
        />
      </Animated.View>
      <LibraryScrollComponent
        ref={Platform.OS !== 'web' && view === 'posters' ? nativePosterScrollRef : undefined}
        testID="library-scroll"
        contentContainerStyle={s.content}
        onContentSizeChange={(_width, height) => {
          nativeScrollContentHeight.current = height;
        }}
        onLayout={(event) => {
          nativeScrollViewportHeight.current = event.nativeEvent.layout.height;
        }}
        onScroll={handleScroll}
        scrollEnabled={Platform.OS === 'web' || view !== 'posters' || !nativeDrag}
        scrollEventThrottle={16}
      >
        {active && <Text style={s.hint}>{filtered.length} results · Clear filters to reorder</Text>}
        {itemQuery === undefined ? (
          <LibraryPageSkeleton list={view === 'list'} />
        ) : (
          <PinchDensity
            columns={gridColumns}
            onChange={(next) => {
              if (view === 'posters') updateGridColumns(next);
            }}
          >
            {visibleStatuses.map(([status, label]) => {
              const data = filtered
                .filter((i) => effectiveStatus(i) === status)
                .sort((a, b) => {
                  const order = activeOptimisticOrder(status);
                  if (!order) return a.rank - b.rank;
                  const aIndex = order.indexOf(a._id);
                  const bIndex = order.indexOf(b._id);
                  if (aIndex === -1) return bIndex === -1 ? a.rank - b.rank : 1;
                  if (bIndex === -1) return -1;
                  return aIndex - bIndex;
                });
              return (
                <StatusDropZone
                  key={status}
                  status={status}
                  disabled={active || statusMovePending}
                  onCrossDrop={requestCategoryMove}
                  onLayout={(event) => {
                    const { height, y } = event.nativeEvent.layout;
                    setSectionLayouts((current) => ({
                      ...current,
                      [status]: {
                        top: y,
                        height,
                      },
                    }));
                  }}
                  style={[
                    s.section,
                    Platform.OS !== 'web' &&
                      nativeDrag &&
                      nativeTargetStatus === status &&
                      nativeDrag.status !== status &&
                      s.categoryDropActive,
                  ]}
                >
                  <View style={s.sectionHead}>
                    <Text style={s.sectionTitle}>{label}</Text>
                    <Text style={s.count}>{data.length.toString().padStart(2, '0')}</Text>
                  </View>
                  {!data.length ? (
                    <EmptyState
                      title={active ? 'No matches' : 'Nothing here yet'}
                      detail={active ? 'Try a broader filter.' : 'Add a title when you’re ready.'}
                    />
                  ) : view === 'posters' ? (
                    Platform.OS === 'web' ? (
                      <View style={[s.grid, s.webGrid]}>
                        {data.map((item, index) => (
                          <WebDraggable
                            key={item._id}
                            itemId={item._id}
                            index={index}
                            status={status}
                            disabled={active || statusMovePending}
                            style={{
                              width: gridItemWidth(gridColumns),
                              minWidth: 0,
                              flexGrow: 0,
                              flexShrink: 0,
                              flexBasis: gridItemWidth(gridColumns),
                              cursor: active ? 'default' : 'grab',
                            }}
                            onDrop={(from, to) => {
                              const next = [...data];
                              const [moved] = next.splice(from, 1);
                              next.splice(to, 0, moved);
                              return drop(next, from, to);
                            }}
                          >
                            <PosterCard
                              item={item}
                              rank={index + 1}
                              ranked={status === 'watched'}
                              disabled={active || statusMovePending}
                              onMove={(direction) => {
                                const to = index + direction;
                                if (to < 0 || to >= data.length) return;
                                const next = [...data];
                                const [moved] = next.splice(index, 1);
                                next.splice(to, 0, moved);
                                void drop(next, index, to);
                              }}
                              onCategoryMove={(target) => requestCategoryMove(item._id, target)}
                              contained
                            />
                          </WebDraggable>
                        ))}
                      </View>
                    ) : (
                      <NativeDraggableGrid
                        key={`poster-grid-${gridColumns}`}
                        autoScroll={nativePosterAutoScroll}
                        contentContainerStyle={s.grid}
                        data={data}
                        disabled={active || statusMovePending}
                        itemWidth={gridItemWidth(gridColumns)}
                        keyExtractor={(item) => item._id}
                        onMotionInit={(motion) =>
                          setNativePosterMotion((current) => ({ ...current, [status]: motion }))
                        }
                        onTouchStateChange={(touching) => {
                          nativePosterTouch.current = touching;
                        }}
                        onDragBegin={({ item, index }) =>
                          beginNativePosterDrag(item, status, index, status === 'watched')
                        }
                        onDragLayout={positionNativePosterDrag}
                        onDragMove={({ absoluteY }) =>
                          updateNativeDragTarget(
                            status,
                            absoluteY - rootWindowY.current + lastScrollY.current,
                          )
                        }
                        onDragCancel={cancelNativePosterDrag}
                        onDragEnd={({ data: next, from, to }) =>
                          finishNativeDrag(status, next, from, to)
                        }
                        renderItem={({ item, index }) => (
                          <PosterCard
                            item={item}
                            rank={index + 1}
                            ranked={status === 'watched'}
                            disabled={active || statusMovePending}
                            onCategoryMove={(target) => requestCategoryMove(item._id, target)}
                            onMove={(direction) => {
                              const to = index + direction;
                              if (to < 0 || to >= data.length) return;
                              const next = [...data];
                              const [moved] = next.splice(index, 1);
                              next.splice(to, 0, moved);
                              void drop(next, index, to);
                            }}
                          />
                        )}
                      />
                    )
                  ) : Platform.OS === 'web' ? (
                    <View style={listColumns === 2 && s.webTwoColumnList}>
                      {data.map((item, index) => (
                        <WebDraggable
                          key={item._id}
                          itemId={item._id}
                          index={index}
                          status={status}
                          disabled={active || statusMovePending}
                          style={{
                            ...WEB_ROW_DRAG_STYLE,
                            width: listItemWidth(listColumns),
                            flexBasis: listItemWidth(listColumns),
                            flexGrow: 0,
                            flexShrink: 0,
                            cursor: active ? 'default' : 'grab',
                          }}
                          onDrop={(from, to) => {
                            const next = [...data];
                            const [moved] = next.splice(from, 1);
                            next.splice(to, 0, moved);
                            return drop(next, from, to);
                          }}
                        >
                          <Row
                            item={item}
                            rank={index + 1}
                            ranked={status === 'watched'}
                            disabled={active || statusMovePending}
                            textSize={listTextSize}
                            contained={listColumns === 2}
                            onCategoryMove={(target) => requestCategoryMove(item._id, target)}
                            onMove={(direction) => {
                              const to = index + direction;
                              if (to < 0 || to >= data.length) return;
                              const next = [...data];
                              const [moved] = next.splice(index, 1);
                              next.splice(to, 0, moved);
                              void drop(next, index, to);
                            }}
                          />
                        </WebDraggable>
                      ))}
                    </View>
                  ) : (
                    <View
                      onLayout={(event) => {
                        const { y } = event.nativeEvent.layout;
                        setNativeListTops((current) => ({
                          ...current,
                          [status]: y,
                        }));
                      }}
                    >
                      <NestableDraggableFlatList
                        key={`list-${listColumns}`}
                        scrollEnabled={false}
                        numColumns={listColumns}
                        columnWrapperStyle={listColumns === 2 ? s.listGridRow : undefined}
                        data={data}
                        keyExtractor={(i) => i._id}
                        dragItemOverflow
                        autoscrollThreshold={80}
                        autoscrollSpeed={140}
                        animationConfig={NATIVE_DRAG_ANIMATION}
                        onAnimValInit={(values) =>
                          setNativeDragValues((current) => ({
                            ...current,
                            [status]: values as NativeDragValues,
                          }))
                        }
                        onDragBegin={(index) => {
                          const item = data[index];
                          if (!item) return;
                          nativeTargetRef.current = status;
                          setNativeTargetStatus(status);
                          nativeDragRef.current = { item, status };
                          setNativeDrag({ item, status });
                        }}
                        onDragEnd={({ data: next, from, to }) =>
                          finishNativeDrag(status, next, from, to)
                        }
                        renderItem={(p: RenderItemParams<LibraryItem>) => (
                          <ScaleDecorator activeScale={motionReduced ? 1 : 1.012}>
                            <ShadowDecorator color="#000" opacity={0.34} radius={12} elevation={7}>
                              <Row
                                {...p}
                                rank={(p.getIndex() ?? 0) + 1}
                                ranked={status === 'watched'}
                                disabled={active || statusMovePending}
                                textSize={listTextSize}
                                contained={listColumns === 2}
                                onCategoryMove={(target) => requestCategoryMove(p.item._id, target)}
                                onMove={(direction) => {
                                  const index = p.getIndex() ?? 0;
                                  const to = index + direction;
                                  if (to < 0 || to >= data.length) return;
                                  const next = [...data];
                                  const [moved] = next.splice(index, 1);
                                  next.splice(to, 0, moved);
                                  void drop(next, index, to);
                                }}
                              />
                            </ShadowDecorator>
                          </ScaleDecorator>
                        )}
                      />
                      {nativeDragValues[status] && (
                        <NativeDragMonitor
                          values={nativeDragValues[status]}
                          status={status}
                          listTop={
                            (sectionLayouts[status]?.top ?? 0) + (nativeListTops[status] ?? 0)
                          }
                          onHover={updateNativeDragTarget}
                        />
                      )}
                    </View>
                  )}
                </StatusDropZone>
              );
            })}
          </PinchDensity>
        )}
      </LibraryScrollComponent>
      <Drawer
        open={!!pendingWatchedMove}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !statusMovePending) setPendingWatchedMove(undefined);
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
      {!!nativeDrag && !!nativeDragPreviewLayout && !!nativePosterMotion[nativeDrag.status] && (
        <NativePosterDragPreview
          bounds={{ top: TOOLBAR_HEIGHT, bottom: rootHeight - MOBILE_NAV_HEIGHT }}
          layout={nativeDragPreviewLayout}
          motion={nativePosterMotion[nativeDrag.status]!}
          posterPath={nativeDrag.item.posterPath}
          title={nativeDrag.item.title}
        />
      )}
      <Animated.View
        testID="library-add-motion"
        pointerEvents={!motionReduced && addButtonHidden ? 'none' : 'auto'}
        style={[
          s.addButtonShell,
          {
            opacity: motionReduced
              ? 1
              : toolbarY.interpolate({
                  inputRange: [-TOOLBAR_HEIGHT, 0],
                  outputRange: [0, 1],
                  extrapolate: 'clamp',
                }),
            transform: [
              {
                scale: motionReduced
                  ? 1
                  : toolbarY.interpolate({
                      inputRange: [-TOOLBAR_HEIGHT, 0],
                      outputRange: [0.35, 1],
                      extrapolate: 'clamp',
                    }),
              },
              {
                translateY: motionReduced
                  ? 0
                  : toolbarY.interpolate({
                      inputRange: [-TOOLBAR_HEIGHT, 0],
                      outputRange: [24, 0],
                      extrapolate: 'clamp',
                    }),
              },
            ],
          },
        ]}
      >
        <NativePressable
          accessibilityRole="button"
          accessibilityLabel="Add title"
          accessibilityHint="Opens title search"
          onPress={() => router.push('/add')}
          style={s.addButton}
          pressedStyle={s.addButtonPressed}
        >
          <Plus size={23} color={colors.bg} strokeWidth={1.9} />
        </NativePressable>
      </Animated.View>
      <MobileNav current="library" />
    </View>
  );
}
function PosterCard({
  item,
  rank,
  ranked,
  disabled,
  onCategoryMove,
  onMove,
  contained = false,
}: {
  item: LibraryItem;
  rank: number;
  ranked: boolean;
  disabled: boolean;
  onCategoryMove?: (status: Status) => void;
  onMove?: (direction: -1 | 1) => void;
  contained?: boolean;
}) {
  return (
    <NativePressable
      accessibilityRole="button"
      accessibilityLabel={item.title}
      accessibilityHint={
        disabled
          ? 'Clear filters to reorder your library'
          : Platform.OS === 'web'
            ? 'Drag to reorder this title'
            : 'Long press and drag to reorder this title'
      }
      accessibilityActions={
        disabled
          ? undefined
          : [
              { name: 'moveUp', label: 'Move up' },
              { name: 'moveDown', label: 'Move down' },
              ...categoryAccessibilityActions,
            ]
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'moveUp') onMove?.(-1);
        if (event.nativeEvent.actionName === 'moveDown') onMove?.(1);
        if (event.nativeEvent.actionName.startsWith('moveTo:'))
          onCategoryMove?.(event.nativeEvent.actionName.slice(7) as Status);
      }}
      onPress={() => router.push(`/item/${item._id}`)}
      style={[s.card, contained && s.webCardInner]}
      pressedStyle={s.cardPressed}
    >
      <View pointerEvents="none" style={contained && s.webCardContent}>
        <PosterImage path={item.posterPath} title={item.title} />
        <Text numberOfLines={2} style={s.cardTitle}>
          {ranked && <Text style={s.rank}>{rank}. </Text>}
          {item.title}
        </Text>
      </View>
    </NativePressable>
  );
}
function Row({
  item,
  drag,
  isActive,
  rank,
  ranked,
  disabled,
  onCategoryMove,
  onMove,
  textSize,
  contained = false,
}: {
  item: LibraryItem;
  drag?: () => void;
  isActive?: boolean;
  rank: number;
  ranked: boolean;
  disabled: boolean;
  onCategoryMove?: (status: Status) => void;
  onMove: (direction: -1 | 1) => void;
  textSize: ListTextSize;
  contained?: boolean;
}) {
  const typography = listTypography(textSize);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.title}
      accessibilityHint={disabled ? undefined : 'Use accessibility actions to reorder this title'}
      accessibilityActions={
        disabled
          ? undefined
          : [
              { name: 'moveUp', label: 'Move up' },
              { name: 'moveDown', label: 'Move down' },
              ...categoryAccessibilityActions,
            ]
      }
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'moveUp') onMove(-1);
        if (event.nativeEvent.actionName === 'moveDown') onMove(1);
        if (event.nativeEvent.actionName.startsWith('moveTo:'))
          onCategoryMove?.(event.nativeEvent.actionName.slice(7) as Status);
      }}
      onPress={() => router.push(`/item/${item._id}`)}
      onLongPress={Platform.OS === 'web' || disabled ? undefined : drag}
      delayLongPress={220}
      hitSlop={{ top: 7, bottom: 7, left: 0, right: 0 }}
      style={[
        s.row,
        { minHeight: typography.minHeight },
        contained && s.rowContained,
        isActive && s.dragActive,
      ]}
    >
      {ranked && (
        <Text numberOfLines={1} style={s.rowRank}>
          {rank}.
        </Text>
      )}
      <View style={s.rowTitleShell}>
        <Text
          numberOfLines={contained ? 2 : 1}
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
    </Pressable>
  );
}
const s = createStyles({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    width: '100%',
    maxWidth: 880,
    alignSelf: 'center',
    padding: 20,
    paddingTop: TOOLBAR_HEIGHT,
    paddingBottom: 112,
  },
  toolbar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    backgroundColor: colors.bg,
  },
  icon: {
    width: 44,
    height: 44,
    flexShrink: 0,
    borderRadius: 18,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconActive: {},
  activeDot: {
    position: 'absolute',
    right: 5,
    top: 5,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.text,
  },
  addButtonShell: {
    position: 'absolute',
    right: 24,
    bottom: 88,
    width: 56,
    height: 56,
    elevation: 5,
    zIndex: 2,
  },
  addButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonPressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
  hint: { color: colors.muted, fontSize: 11, marginTop: 12, marginBottom: 4 },
  filterGroup: { gap: 10 },
  filterLabel: { color: colors.muted, fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },
  filterWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  confirmMessage: { color: colors.text, fontSize: 14, lineHeight: 20 },
  section: { marginTop: 24 },
  categoryDropActive: {
    backgroundColor: colors.surface,
    borderRadius: 12,
  },
  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 11,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: { color: colors.muted, fontSize: 12, letterSpacing: 0.2, fontWeight: '600' },
  count: { color: colors.muted, fontSize: 11, fontVariant: ['tabular-nums'] },
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
  webTwoColumnList: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: '3.5%',
  },
  listGridRow: { gap: '3.5%' },
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
  grid: {
    paddingTop: 16,
    paddingBottom: 4,
  },
  webGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: '3.5%',
    rowGap: 12,
  },
  gridRow: { gap: '3.5%', marginBottom: 12 },
  card: { flex: 1, width: '100%', maxWidth: '100%', minWidth: 0 },
  webCardInner: { width: '100%', maxWidth: '100%', flexGrow: 0, flexShrink: 0 },
  webCardContent: { width: '100%' },
  cardPressed: { opacity: 0.82 },
  dragActive: {
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.text,
    borderRadius: 10,
    opacity: 0.96,
    zIndex: 2,
  },
  cardTitle: { color: colors.text, fontSize: 12, lineHeight: 16, marginTop: 6, fontWeight: '600' },
  rank: { color: colors.muted },
});
