import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import { router } from 'expo-router';
import {
  NestableDraggableFlatList,
  NestableScrollContainer,
  RenderItemParams,
  ScaleDecorator,
  ShadowDecorator,
} from 'react-native-draggable-flatlist';
import { Button, EmptyState } from '@/components/ui/primitives';
import { NativePressable } from '@/components/ui/NativePressable';
import { colors } from '@/constants/colors';
import type { LibraryItem } from '@/types';
import { ScreenErrorBoundary } from '@/components/ScreenErrorBoundary';
import { PinchDensity } from '@/components/PinchDensity';
import { useGridColumns } from '@/hooks/use-grid-columns';
import { LibraryPageSkeleton } from '@/components/PageSkeletons';
import type { AppDrawerHandle } from '@/components/AppDrawer';
import { MobileNav } from '@/components/MobileNav';
import { NativePosterDragPreview } from '@/components/NativePosterDragPreview';
import { NativeDraggableGrid } from '@/components/NativeDraggableGrid';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Plus } from 'lucide-react-native';
import { DEFAULT_DISPLAY_PREFERENCES, gridItemWidth } from '@/lib/displayPreferences';
import {
  LIBRARY_STATUSES,
  matchesMediaType,
  type MediaTypeFilter,
  type StatusFilter,
} from '@/lib/libraryFilters';

import { LibraryPosterCard, LibraryRow } from '@/features/library/components/LibraryItemCards';
import { LibraryToolbar } from '@/features/library/components/LibraryToolbar';
import {
  type NativeDragValues,
  useLibraryReordering,
} from '@/features/library/hooks/useLibraryReordering';
import {
  createDrawerEdgeSwipe,
  NativeDragMonitor,
  nativeDragAnimation,
  StatusDropZone,
} from '@/features/library/components/LibraryDragHelpers';
import {
  libraryScreenStyles as s,
  MOBILE_NAV_HEIGHT,
  TOOLBAR_HEIGHT,
} from '@/features/library/screens/LibraryScreen.styles';
const EMPTY_ITEMS: LibraryItem[] = [];
export default function LibraryScreen() {
  return (
    <ScreenErrorBoundary message="Couldn’t load your library.">
      <Library />
    </ScreenErrorBoundary>
  );
}
function Library() {
  const itemQuery = useQuery(api.library.items.listItems);
  const items = itemQuery ?? EMPTY_ITEMS;
  const settings = useQuery(api.settings.getSettings);
  const view = settings?.defaultView ?? 'list';
  const { gridColumns, updateGridColumns } = useGridColumns(settings?.gridColumns);
  const listColumns = settings?.listColumns ?? DEFAULT_DISPLAY_PREFERENCES.listColumns;
  const listTextSize = settings?.listTextSize ?? DEFAULT_DISPLAY_PREFERENCES.listTextSize;
  const [search, setSearch] = useState('');
  const [type, setType] = useState<MediaTypeFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [min, setMin] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [addButtonHidden, setAddButtonHidden] = useState(false);
  const [motionReduced, setMotionReduced] = useState(false);
  const [scrollY] = useState(() => new Animated.Value(0));
  const toolbarY = useMemo(
    () => Animated.multiply(Animated.diffClamp(scrollY, 0, TOOLBAR_HEIGHT), -1),
    [scrollY],
  );
  const [drawerHandle, setDrawerHandle] = useState<AppDrawerHandle | null>(null);
  const toolbarPosition = useRef(0);
  const reduceMotion = useRef(false);
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
  const reordering = useLibraryReordering(items, active);
  const {
    effectiveStatus,
    moveToStatus: performCategoryMove,
    orderedForStatus,
    requestStatusMove: requestCategoryMove,
    saveOrder,
  } = reordering;
  const { item: pendingWatchedMove, pending: statusMovePending } = reordering.confirmation;
  const {
    autoScroll: nativePosterAutoScroll,
    begin: beginNativePosterDrag,
    beginList: beginNativeListDrag,
    cancel: cancelNativePosterDrag,
    contentYFromWindow,
    draggedItem: nativeDrag,
    dragPreviewLayout: nativeDragPreviewLayout,
    dragValues: nativeDragValues,
    finish: finishNativeDrag,
    listTops: nativeListTops,
    posterMotion: nativePosterMotion,
    position: positionNativePosterDrag,
    posterScrollRef: nativePosterScrollRef,
    posterTouchActive: nativePosterTouch,
    rootHeight,
    rootRef,
    sectionLayouts,
    scrollContentHeight: nativeScrollContentHeight,
    scrollOffset: lastScrollY,
    scrollViewportHeight: nativeScrollViewportHeight,
    setDragValues: setNativeDragValues,
    setListTops: setNativeListTops,
    setPosterMotion: setNativePosterMotion,
    setRootHeight,
    setSectionLayouts,
    targetStatus: nativeTargetStatus,
    updateTarget: updateNativeDragTarget,
  } = reordering.drag;
  const drop = (data: LibraryItem[], _from: number, to: number) => saveOrder(data, to);
  const clear = () => {
    setSearch('');
    setType('all');
    setStatusFilter('all');
    setMin(0);
    setTags([]);
  };
  const updateToolbarFromScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = Math.max(0, event.nativeEvent.contentOffset.y);
      const delta = y - lastScrollY.current;
      lastScrollY.current = y;
      if (reduceMotion.current) return;
      const next =
        y === 0 ? 0 : Math.max(-TOOLBAR_HEIGHT, Math.min(0, toolbarPosition.current - delta));
      toolbarPosition.current = next;
      setAddButtonHidden(next <= -TOOLBAR_HEIGHT + 1);
    },
    [lastScrollY],
  );
  const handleScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        listener: updateToolbarFromScroll,
        useNativeDriver: false,
      }),
    [scrollY, updateToolbarFromScroll],
  );
  const edgeSwipe = useMemo(
    () => createDrawerEdgeSwipe(drawerHandle, () => nativePosterTouch.current || !!nativeDrag),
    [drawerHandle, nativeDrag, nativePosterTouch],
  );
  const LibraryScrollComponent = (view === 'posters'
    ? Animated.ScrollView
    : NestableScrollContainer) as unknown as typeof ScrollView;
  return (
    <View
      ref={rootRef}
      onLayout={(event) => setRootHeight(event.nativeEvent.layout.height)}
      style={s.root}
      {...(view === 'posters' ? {} : edgeSwipe.panHandlers)}
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
        <LibraryToolbar
          filters={{
            active,
            allTags,
            minimumRating: min,
            search,
            selectedTags: tags,
            status: statusFilter,
            type,
          }}
          setFilters={{
            clear,
            setMinimumRating: setMin,
            setSearch,
            setSelectedTags: setTags,
            setStatus: setStatusFilter,
            setType,
          }}
          onDrawerChange={setDrawerHandle}
        />
      </Animated.View>
      <LibraryScrollComponent
        ref={view === 'posters' ? nativePosterScrollRef : undefined}
        testID="library-scroll"
        contentContainerStyle={s.content}
        onContentSizeChange={(_width, height) => {
          nativeScrollContentHeight.current = height;
        }}
        onLayout={(event) => {
          nativeScrollViewportHeight.current = event.nativeEvent.layout.height;
        }}
        onScroll={handleScroll}
        scrollEnabled={view !== 'posters' || !nativeDrag}
        scrollEventThrottle={16}
      >
        {active && (
          <Text accessibilityLiveRegion="polite" style={s.hint}>
            {filtered.length} {filtered.length === 1 ? 'result' : 'results'} · Clear filters to
            reorder
          </Text>
        )}
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
              const orderedIds = orderedForStatus(status).map((item) => item._id);
              const data = filtered
                .filter((i) => effectiveStatus(i) === status)
                .sort((a, b) => {
                  const aIndex = orderedIds.indexOf(a._id);
                  const bIndex = orderedIds.indexOf(b._id);
                  return aIndex === -1 || bIndex === -1 ? a.rank - b.rank : aIndex - bIndex;
                });
              return (
                <StatusDropZone
                  key={status}
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
                        updateNativeDragTarget(status, contentYFromWindow(absoluteY))
                      }
                      onDragCancel={cancelNativePosterDrag}
                      onDragEnd={({ data: next, from, to }) =>
                        finishNativeDrag(status, next, from, to)
                      }
                      renderItem={({ item, index }) => (
                        <LibraryPosterCard
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
                        animationConfig={nativeDragAnimation}
                        onAnimValInit={(values) =>
                          setNativeDragValues((current) => ({
                            ...current,
                            [status]: values as NativeDragValues,
                          }))
                        }
                        onDragBegin={(index) => {
                          const item = data[index];
                          if (!item) return;
                          beginNativeListDrag(item, status);
                        }}
                        onDragEnd={({ data: next, from, to }) =>
                          finishNativeDrag(status, next, from, to)
                        }
                        renderItem={(p: RenderItemParams<LibraryItem>) => (
                          <ScaleDecorator activeScale={motionReduced ? 1 : 1.012}>
                            <ShadowDecorator color="#000" opacity={0.34} radius={12} elevation={7}>
                              <LibraryRow
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
          if (!nextOpen && !statusMovePending) reordering.confirmation.close();
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
                void performCategoryMove(item, 'watched').finally(reordering.confirmation.close);
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
