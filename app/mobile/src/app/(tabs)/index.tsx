import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { ScreenView } from '@/components/ScreenLayout';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  Text,
  useWindowDimensions,
  PixelRatio,
  View,
} from 'react-native';
import { useStartupData, useStartupQuery as useQuery } from '@/hooks/useStartupQuery';
import { getFunctionName, type FunctionReturnType } from 'convex/server';
import { StartupSyncStatus } from '@/components/StartupSyncStatus';
import Reanimated from 'react-native-reanimated';
import { useAccountLoading } from '@/hooks/useAccountLoading';
import { useWatchingRefresh } from '@/hooks/use-watching-refresh';
import { api } from '@marker/shared/api';
import { SectionHeading } from '@/components/ui/primitives';
import { WatchedConfirmSheet } from '@/components/WatchedConfirmSheet';
import { useToast } from '@/components/ui/Toast';
import { NativePressable } from '@/components/ui/NativePressable';
import type { LibraryItem } from '@/types';
import { ScreenErrorBoundary } from '@/components/ScreenErrorBoundary';
import { PinchDensity } from '@/components/PinchDensity';
import { useGridColumns } from '@/hooks/use-grid-columns';
import { LibraryPageSkeleton } from '@/components/PageSkeletons';
import type { AppDrawerHandle } from '@/components/AppDrawer';
import { MobileNav } from '@/components/MobileNav';
import { NativePosterDragPreview } from '@/components/NativePosterDragPreview';
import { NativeDraggableGrid } from '@/components/NativeDraggableGrid';
import { DEFAULT_DISPLAY_PREFERENCES, gridMetrics, listTypography } from '@/lib/displayPreferences';
import {
  LIBRARY_SORTS,
  LIBRARY_STATUSES,
  matchesMediaType,
  isAlsoWatching,
  matchesStatus,
  sortLibraryItems,
} from '@/lib/libraryFilters';
import { useMutation } from 'convex/react';

import {
  LibraryPosterCard,
  LibraryRow,
  AlsoWatchingCard,
  twoColumnPairHeight,
  useTitleLines,
} from '@/features/library/components/LibraryItemCards';
import { LibraryToolbar } from '@/features/library/components/LibraryToolbar';
import { useLibraryReordering } from '@/features/library/hooks/useLibraryReordering';
import {
  useLibraryFilters,
  type LibraryFilterControls,
} from '@/features/library/hooks/useLibraryFilters';
import { createDrawerEdgeSwipe } from '@/features/library/components/LibraryDragHelpers';
import {
  libraryScreenStyles as s,
  MOBILE_NAV_HEIGHT,
  TOOLBAR_HEIGHT,
} from '@/features/library/screens/LibraryScreen.styles';
import { useLocalToday } from '@/hooks/use-local-today';
const EMPTY_ITEMS: LibraryItem[] = [];
export default function LibraryScreen() {
  return (
    <ScreenErrorBoundary message="Couldn’t load your library.">
      <LibraryContent />
    </ScreenErrorBoundary>
  );
}
function LibraryContent() {
  const { libraryReady } = useAccountLoading();
  const controls = useLibraryFilters();
  return libraryReady ? (
    <Library controls={controls} />
  ) : (
    <LibraryLoadingScreen controls={controls} />
  );
}
/** Render the existing library shell without initializing item drag/reorder machinery. */
function LibraryLoadingScreen({ controls }: { controls: LibraryFilterControls }) {
  const [drawer, setDrawer] = useState<AppDrawerHandle | null>(null);
  // Saved settings from the last session shape the skeleton before live data arrives.
  const cachedSettings = useStartupData()?.values[getFunctionName(api.settings.getSettings)] as
    FunctionReturnType<typeof api.settings.getSettings> | undefined;
  const edgeSwipe = useMemo(() => createDrawerEdgeSwipe(drawer, () => false), [drawer]);
  return (
    <ScreenView style={s.root} {...edgeSwipe.panHandlers}>
      <View style={s.toolbar}>
        <LibraryToolbar
          filters={{ ...controls.filters, allTags: [] }}
          setFilters={controls.actions}
          onDrawerChange={setDrawer}
          addDisabled
        />
      </View>
      <ScrollView testID="library-scroll" contentContainerStyle={s.content}>
        <LibraryPageSkeleton
          list={(cachedSettings?.defaultView ?? 'list') === 'list'}
          columns={cachedSettings?.gridColumns}
          listColumns={cachedSettings?.listColumns}
          textSize={cachedSettings?.listTextSize}
        />
      </ScrollView>
      <MobileNav current="library" />
    </ScreenView>
  );
}

function Library({ controls }: { controls: LibraryFilterControls }) {
  const { libraryReady } = useAccountLoading();
  const itemQuery = useQuery(api.library.items.listItems, libraryReady ? {} : 'skip');
  const items = itemQuery ?? EMPTY_ITEMS;
  const settings = useQuery(api.settings.getSettings, libraryReady ? {} : 'skip');
  useWatchingRefresh({ enabled: libraryReady });
  const titleLines = useTitleLines();
  const setSettings = useMutation(api.settings.setSettings);
  const toast = useToast();
  const view = settings?.defaultView ?? 'list';
  const { gridColumns, updateGridColumns } = useGridColumns(settings?.gridColumns);
  const listColumns = settings?.listColumns ?? DEFAULT_DISPLAY_PREFERENCES.listColumns;
  const listTextSize = settings?.listTextSize ?? DEFAULT_DISPLAY_PREFERENCES.listTextSize;
  const today = useLocalToday();
  const automaticAiring = settings?.airingInWatching !== false;
  // Watched shows also listed under Watching (a new episode is out, or set by hand).
  const alsoWatchingIds = useMemo(
    () =>
      new Set(
        items
          .filter((item) => isAlsoWatching(item, automaticAiring, today))
          .map((item) => item._id),
      ),
    [automaticAiring, items, today],
  );
  const { fontScale, width: windowWidth } = useWindowDimensions();
  const listCellWidth = gridMetrics(Math.min(windowWidth, 880) - 40, 2, PixelRatio.get()).itemWidth;
  const typography = listTypography(listTextSize);
  // Window only unscaled rows. Accessibility scaling can wrap the fixed-width
  // rating, so those rows must retain their natural measured height.
  const rowHeight = Math.max(
    typography.minHeight,
    Math.ceil((Math.max(22, typography.lineHeight) + typography.fontSize / 2) * fontScale),
  );
  const {
    search,
    type,
    status: statusFilter,
    minimumRating: min,
    selectedTags: tags,
    sort,
    active,
  } = controls.filters;
  const sorted = sort !== 'custom';
  const reorderLocked = active || sorted;
  const motionReduced = useReducedMotion();
  const [toolbarHidden, setToolbarHidden] = useState(false);
  if (motionReduced && toolbarHidden) setToolbarHidden(false);
  const [scrollY] = useState(() => new Animated.Value(0));
  const toolbarY = useMemo(
    () => Animated.multiply(Animated.diffClamp(scrollY, 0, TOOLBAR_HEIGHT), -1),
    [scrollY],
  );
  const [drawerHandle, setDrawerHandle] = useState<AppDrawerHandle | null>(null);
  const toolbarPosition = useRef(0);
  // Keep per-frame scroll bookkeeping out of React state, and reset it even
  // when motion is re-enabled before the next scroll event.
  useEffect(() => {
    if (motionReduced) toolbarPosition.current = 0;
  }, [motionReduced]);
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
          matchesStatus(i, statusFilter, alsoWatchingIds.has(i._id)) &&
          (!min || (i.rating ?? -1) >= min) &&
          tags.every((tag) =>
            i.tags.some((itemTag) => itemTag.toLocaleLowerCase() === tag.toLocaleLowerCase()),
          ) &&
          i.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
      ),
    [items, type, statusFilter, min, tags, search, alsoWatchingIds],
  );
  const visibleItemIds = useMemo(() => new Set(filtered.map((item) => item._id)), [filtered]);
  const visibleStatuses =
    statusFilter === 'all'
      ? LIBRARY_STATUSES
      : LIBRARY_STATUSES.filter(([status]) => status === statusFilter);
  const reordering = useLibraryReordering(items, reorderLocked, {
    confirmWatched: settings?.confirmWatchedMove !== false,
  });
  const {
    moveToStatus: performCategoryMove,
    orderedForStatus,
    requestStatusMove: requestCategoryMove,
    saveOrder,
  } = reordering;
  const { item: pendingWatchedMove, pending: statusMovePending } = reordering.confirmation;
  const {
    insertion,
    autoScroll: nativePosterAutoScroll,
    begin: beginNativePosterDrag,
    cancel: cancelNativePosterDrag,
    contentYFromWindow,
    draggedItem: nativeDrag,
    dragPreviewLayout: nativeDragPreviewLayout,
    finish: finishNativeDrag,
    posterMotion: nativePosterMotion,
    position: positionNativePosterDrag,
    posterScrollRef: nativePosterScrollRef,
    posterTouchActive: nativePosterTouch,
    rootHeight,
    rootRef,
    scrollContentHeight: nativeScrollContentHeight,
    scrollOffset: lastScrollY,
    scrollViewportHeight: nativeScrollViewportHeight,
    setPosterMotion: setNativePosterMotion,
    setRootHeight,
    setSectionLayouts,
    sectionLayouts,
    targetStatus: nativeTargetStatus,
    updateTarget: updateNativeDragTarget,
  } = reordering.drag;
  const drop = (data: LibraryItem[], _from: number, to: number) => saveOrder(data, to);
  const updateToolbarFromScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = Math.max(0, event.nativeEvent.contentOffset.y);
      const delta = y - lastScrollY.current;
      lastScrollY.current = y;
      if (motionReduced) return;
      const next =
        y === 0 ? 0 : Math.max(-TOOLBAR_HEIGHT, Math.min(0, toolbarPosition.current - delta));
      toolbarPosition.current = next;
      setToolbarHidden(next <= -TOOLBAR_HEIGHT + 1);
    },
    [lastScrollY, motionReduced],
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
  return (
    <ScreenView
      ref={rootRef}
      onLayout={(event) => {
        setRootHeight(event.nativeEvent.layout.height);
      }}
      style={s.root}
      {...(view === 'posters' ? {} : edgeSwipe.panHandlers)}
    >
      <Animated.View
        testID="library-toolbar-motion"
        // Off-screen toolbar controls shouldn't take touches.
        pointerEvents={!motionReduced && toolbarHidden ? 'none' : 'auto'}
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
            sort,
            status: statusFilter,
            type,
          }}
          setFilters={controls.actions}
          onDrawerChange={setDrawerHandle}
          resultCount={filtered.length}
          addDisabled={!libraryReady}
        />
      </Animated.View>
      <Reanimated.ScrollView
        ref={nativePosterScrollRef}
        testID="library-scroll"
        contentContainerStyle={s.content}
        onContentSizeChange={(_width, height) => {
          nativeScrollContentHeight.current = height;
        }}
        onLayout={(event) => {
          nativeScrollViewportHeight.current = event.nativeEvent.layout.height;
        }}
        onScroll={handleScroll}
        scrollEnabled={!nativeDrag}
        scrollEventThrottle={16}
      >
        {reorderLocked && (
          <View style={s.hintRow}>
            <Text accessibilityLiveRegion="polite" numberOfLines={1} style={s.hint}>
              {filtered.length} {filtered.length === 1 ? 'title' : 'titles'}
              {sorted ? ` · ${LIBRARY_SORTS.find((option) => option.value === sort)?.label}` : ''}
            </Text>
            <NativePressable
              accessibilityRole="button"
              accessibilityLabel="Reset sort and filters"
              hitSlop={8}
              onPress={controls.actions.clear}
              style={s.hintAction}
              pressedStyle={s.hintActionPressed}
            >
              <Text style={s.hintActionText}>Reset</Text>
            </NativePressable>
          </View>
        )}
        {itemQuery === undefined ? (
          <LibraryPageSkeleton
            list={view === 'list'}
            columns={gridColumns}
            listColumns={listColumns}
            textSize={listTextSize}
          />
        ) : (
          <PinchDensity
            columns={gridColumns}
            onChange={(next) => {
              if (view === 'posters') updateGridColumns(next);
            }}
          >
            {visibleStatuses.map(([status, label]) => {
              const own = orderedForStatus(status).filter((item) => visibleItemIds.has(item._id));
              const also =
                status === 'watching'
                  ? orderedForStatus('watched').filter(
                      (item) => alsoWatchingIds.has(item._id) && visibleItemIds.has(item._id),
                    )
                  : [];
              // In your order, shows also in Watched lead the grid in their Watched order. Any
              // other sort orders the whole section together (it is read-only then).
              const alsoWatching = sorted ? [] : also;
              const data = sortLibraryItems(sorted ? [...also, ...own] : own, sort);
              // Ranks are the saved Watched positions, also when filters hide some titles.
              const savedRank =
                status === 'watched'
                  ? new Map(orderedForStatus('watched').map((item, index) => [item._id, index + 1]))
                  : undefined;
              // Shows ranked under Watched lead the Watching grid, so pairs span both.
              const sectionCards = [...alsoWatching, ...data];
              const dropTarget =
                !!nativeDrag && nativeTargetStatus === status && nativeDrag.status !== status;
              return (
                <View
                  key={status}
                  onLayout={(event) => {
                    const { height, y } = event.nativeEvent.layout;
                    setSectionLayouts((current) => ({
                      ...current,
                      [status]: {
                        top: y + TOOLBAR_HEIGHT,
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
                  <SectionHeading
                    title={label}
                    count={data.length + alsoWatching.length}
                    style={s.sectionHead}
                    large={view === 'list' && listTextSize === 'large'}
                  />
                  {!data.length && !alsoWatching.length && !dropTarget ? (
                    nativeDrag ? (
                      <View style={s.emptySection}>
                        <Text style={s.emptySectionText}>Drop here</Text>
                      </View>
                    ) : (
                      <Text style={s.emptyLine}>{active ? 'No matches' : 'No titles yet'}</Text>
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
                        nativeDrag && nativeTargetStatus === status && nativeDrag.status !== status
                          ? {
                              index: insertion.index ?? 0,
                              height: nativeDragPreviewLayout?.height ?? rowHeight,
                            }
                          : undefined
                      }
                      leading={alsoWatching.map((item, index) => ({
                        key: item._id,
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
                                    sectionCards,
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
                      data={data}
                      disabled={reorderLocked || statusMovePending}
                      columns={view === 'posters' ? gridColumns : listColumns}
                      rowHeight={
                        view === 'list' && listColumns === 1 && fontScale <= 1
                          ? rowHeight
                          : undefined
                      }
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
                      onDragMove={({ absoluteX, absoluteY, scrollOffset }) =>
                        updateNativeDragTarget(
                          status,
                          contentYFromWindow(absoluteY, scrollOffset),
                          absoluteX,
                          absoluteY,
                          scrollOffset,
                        )
                      }
                      onDragCancel={cancelNativePosterDrag}
                      onDragEnd={({ data: next, from, to }) =>
                        finishNativeDrag(status, next, from, to)
                      }
                      renderItem={({ item, index }) => {
                        const Card = view === 'posters' ? LibraryPosterCard : LibraryRow;
                        return (
                          <Card
                            textSize={listTextSize}
                            contained={listColumns === 2}
                            pairHeight={
                              view === 'list' && listColumns === 2
                                ? twoColumnPairHeight(
                                    sectionCards,
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
                            rank={savedRank?.get(item._id) ?? index + 1}
                            ranked={status === 'watched'}
                            disabled={reorderLocked || statusMovePending}
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
      <StartupSyncStatus bottom={72} />
      <WatchedConfirmSheet
        item={pendingWatchedMove}
        pending={statusMovePending}
        onClose={reordering.confirmation.close}
        onConfirm={(item, { dontAskAgain }) => {
          void performCategoryMove(item, 'watched', reordering.confirmation.index)
            .then((saved) => {
              if (saved && dontAskAgain)
                return setSettings({ confirmWatchedMove: false }).catch(() =>
                  toast.show('Couldn’t save that preference'),
                );
            })
            .finally(reordering.confirmation.close);
        }}
      />
      {!!nativeDrag && !!nativeDragPreviewLayout && !!nativePosterMotion[nativeDrag.status] && (
        <NativePosterDragPreview
          bounds={{ top: TOOLBAR_HEIGHT, bottom: rootHeight - MOBILE_NAV_HEIGHT }}
          layout={nativeDragPreviewLayout}
          motion={nativePosterMotion[nativeDrag.status]!}
          posterPath={nativeDrag.item.posterPath}
          title={nativeDrag.item.title}
        >
          {view === 'list' && (
            <LibraryRow
              item={nativeDrag.item}
              rank={nativeDrag.rank ?? 0}
              ranked={nativeDrag.status === 'watched'}
              disabled
              textSize={listTextSize}
              contained={listColumns === 2}
              onMove={() => undefined}
            />
          )}
        </NativePosterDragPreview>
      )}
      <MobileNav current="library" />
    </ScreenView>
  );
}
