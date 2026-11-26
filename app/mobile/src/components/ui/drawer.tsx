import { transitionPresence, type PresenceState } from '@marker/shared/lifecycle';
import { cn } from '@/lib/utils';
import { colors } from '@/constants/colors';
import * as DialogPrimitive from '@rn-primitives/dialog';
import * as React from 'react';
import {
  Platform,
  Pressable,
  type ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewProps,
} from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { KeyboardScrollView } from '@/components/ui/KeyboardScrollView';
import { FullWindowOverlay as RNFullWindowOverlay } from 'react-native-screens';
import { radius, typeRamp } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';

const DrawerTrigger = DialogPrimitive.Trigger;
const DrawerClose = DialogPrimitive.Close;

const FullWindowOverlay = Platform.OS === 'ios' ? RNFullWindowOverlay : React.Fragment;
const enterEasing = Easing.bezier(0.22, 1, 0.36, 1);
const exitEasing = Easing.bezier(0.25, 1, 0.5, 1);
const enterDuration = 320;
const exitDuration = 200;
const settleDuration = 240;
const dismissDistanceRatio = 0.22;
const dismissVelocity = 850;

type DrawerMotionContextValue = {
  interactive: boolean;
  /** False while the sheet must stay open, such as during a save. */
  dismissible: boolean;
  progress: SharedValue<number>;
};

const DrawerMotionContext = React.createContext<DrawerMotionContextValue | null>(null);

/**
 * A list with its own scroll view inside a sheet reports its offset here, so dragging down
 * scrolls that list back up instead of closing the sheet (see `useDrawerInnerScroll`).
 */
const DrawerInnerScrollContext = React.createContext<SharedValue<number> | null>(null);

/** A scroll view nested in a sheet's content; dragging down scrolls it before the sheet. */
function DrawerScrollView({
  ref,
  ...props
}: Omit<React.ComponentProps<typeof Animated.ScrollView>, 'ref'> & {
  ref?: React.Ref<ScrollView>;
}) {
  const innerOffset = React.useContext(DrawerInnerScrollContext);
  React.useEffect(() => () => innerOffset?.set(0), [innerOffset]);
  const onScroll = useAnimatedScrollHandler((event) => {
    innerOffset?.set(Math.max(0, event.contentOffset.y));
  });
  return (
    <Animated.ScrollView
      // Reanimated's scroll view is a plain ScrollView underneath.
      ref={ref as React.Ref<never>}
      onScroll={onScroll}
      scrollEventThrottle={16}
      {...props}
    />
  );
}

function useDrawerMotion() {
  const context = React.useContext(DrawerMotionContext);
  if (!context) {
    throw new Error('Drawer compound components cannot be rendered outside the Drawer component');
  }
  return context;
}

function Drawer({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  dismissible = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root> & {
  /** When false, swipes, the backdrop and Back don't close the sheet. */
  dismissible?: boolean;
}) {
  const isControlled = openProp !== undefined;
  const requestedOpen = isControlled ? openProp : defaultOpen;
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(() => Boolean(requestedOpen));
  const [presence, setPresence] = React.useState<PresenceState>({
    state: requestedOpen ? 'open' : 'closed',
  });
  const closing = presence.state === 'closing';
  const progress = useSharedValue(0);
  const effectiveRequestedOpen = isControlled ? Boolean(openProp) : uncontrolledOpen;
  const previousOpen = React.useRef(false);
  // When a parent closes a controlled drawer directly, keep it mounted for the exit animation.
  const [lingering, setLingering] = React.useState(false);
  const [lastRequestedOpen, setLastRequestedOpen] = React.useState(effectiveRequestedOpen);
  if (lastRequestedOpen !== effectiveRequestedOpen) {
    setLastRequestedOpen(effectiveRequestedOpen);
    setLingering(!effectiveRequestedOpen && isControlled && presence.state !== 'closing');
  }

  const clearCloseTimer = React.useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  React.useEffect(() => {
    // A closed drawer already starts at zero; don't schedule an invisible animation.
    if (previousOpen.current === effectiveRequestedOpen) return;
    previousOpen.current = effectiveRequestedOpen;
    progress.set(
      withTiming(effectiveRequestedOpen ? 1 : 0, {
        duration: effectiveRequestedOpen ? enterDuration : exitDuration,
        easing: effectiveRequestedOpen ? enterEasing : exitEasing,
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [effectiveRequestedOpen, progress]);

  React.useEffect(() => clearCloseTimer, [clearCloseTimer]);
  React.useEffect(() => {
    if (!lingering) return;
    const timer = setTimeout(() => setLingering(false), exitDuration);
    return () => clearTimeout(timer);
  }, [lingering]);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      clearCloseTimer();
      setPresence((current) => transitionPresence(current, 'open'));
      if (!isControlled) setUncontrolledOpen(true);
      onOpenChange?.(true);
      return;
    }
    if (!dismissible) return;
    clearCloseTimer();
    setPresence((current) =>
      transitionPresence(
        current.state === 'closed' && effectiveRequestedOpen ? { state: 'open' } : current,
        'close',
      ),
    );
    progress.set(
      withTiming(0, {
        duration: exitDuration,
        easing: exitEasing,
        reduceMotion: ReduceMotion.System,
      }),
    );
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      if (!isControlled) setUncontrolledOpen(false);
      onOpenChange?.(false);
      setPresence((current) => transitionPresence(current, 'closed'));
    }, exitDuration);
  }

  return (
    <DrawerMotionContext.Provider
      value={{ interactive: effectiveRequestedOpen && !closing, dismissible, progress }}
    >
      <DialogPrimitive.Root
        open={effectiveRequestedOpen || lingering}
        onOpenChange={handleOpenChange}
        {...props}
      />
    </DrawerMotionContext.Provider>
  );
}

function DrawerBackdropTint() {
  const { progress } = useDrawerMotion();
  const animatedStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.backdropTint, animatedStyle]}
    />
  );
}

const DrawerSheet = React.forwardRef<
  React.ComponentRef<typeof View>,
  React.ComponentProps<typeof View> & { grabber?: React.ReactNode }
>(function DrawerSheet({ children, grabber, onLayout, ...props }, ref) {
  const { height: windowHeight } = useWindowDimensions();
  const { interactive: open, dismissible, progress } = useDrawerMotion();
  const interactive = open && dismissible;
  const { onOpenChange } = DialogPrimitive.useRootContext();
  const sheetHeight = useSharedValue(windowHeight);
  const dragStart = useSharedValue(1);
  const scrollOffset = useSharedValue(0);
  const dragging = useSharedValue(false);
  const touchX = useSharedValue(0);
  const touchY = useSharedValue(0);
  const { bottom: bottomInset } = useSafeAreaInsets();
  const contentHeight = useSharedValue(0);
  const viewportHeight = useSharedValue(0);
  const innerOffset = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollOffset.set(Math.max(0, event.contentOffset.y));
  });
  // A taller sheet fades out above the system gesture bar until it is scrolled to the end,
  // so nothing sits under the bar at rest.
  const fadeStyle = useAnimatedStyle(() => ({
    opacity:
      contentHeight.get() - viewportHeight.get() - scrollOffset.get() > bottomInset + 4 ? 1 : 0,
  }));
  const fadeHeight = bottomInset + 28;
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.get()) * sheetHeight.get() }],
  }));
  const createDragGesture = React.useCallback(
    () =>
      Gesture.Pan()
        .enabled(interactive)
        .maxPointers(1)
        .activeOffsetY([-10_000, 4])
        .failOffsetX([-32, 32])
        .onStart(() => {
          dragging.set(true);
          dragStart.set(progress.get());
        })
        .onUpdate((event) => {
          const height = Math.max(sheetHeight.get(), 1);
          const downwardDistance = Math.max(0, event.translationY);
          progress.set(Math.max(0, Math.min(1, dragStart.get() - downwardDistance / height)));
        })
        .onEnd((event) => {
          const height = Math.max(sheetHeight.get(), 1);
          const shouldDismiss =
            event.translationY >= height * dismissDistanceRatio ||
            event.velocityY >= dismissVelocity;
          if (shouldDismiss) {
            progress.set(
              withTiming(0, {
                duration: exitDuration,
                easing: exitEasing,
                reduceMotion: ReduceMotion.System,
              }),
            );
            runOnJS(onOpenChange)(false);
            return;
          }
          progress.set(
            withTiming(1, {
              duration: settleDuration,
              easing: enterEasing,
              reduceMotion: ReduceMotion.System,
            }),
          );
        })
        .onFinalize((_event, success) => {
          dragging.set(false);
          if (success) return;
          progress.set(
            withTiming(1, {
              duration: settleDuration,
              easing: enterEasing,
              reduceMotion: ReduceMotion.System,
            }),
          );
        }),
    [dragging, dragStart, interactive, onOpenChange, progress, sheetHeight],
  );

  const headerGesture = React.useMemo(() => createDragGesture(), [createDragGesture]);
  const bodyGesture = React.useMemo(
    () =>
      createDragGesture()
        .manualActivation(true)
        .onTouchesDown((event, manager) => {
          'worklet';
          if (event.allTouches.length !== 1) {
            manager.fail();
            return;
          }
          touchX.set(event.allTouches[0].absoluteX);
          touchY.set(event.allTouches[0].absoluteY);
        })
        .onTouchesMove((event, manager) => {
          'worklet';
          if (dragging.get()) return;
          if (event.allTouches.length !== 1) {
            manager.fail();
            return;
          }
          const dx = event.allTouches[0].absoluteX - touchX.get();
          const dy = event.allTouches[0].absoluteY - touchY.get();
          // Let the content scroll normally unless pulling down from its top.
          if (scrollOffset.get() > 1 || innerOffset.get() > 1 || dy < -4 || Math.abs(dx) > 16) {
            manager.fail();
          } else if (dy > 4 && dy > Math.abs(dx)) {
            manager.activate();
          }
        }),
    [createDragGesture, dragging, innerOffset, scrollOffset, touchX, touchY],
  );
  const scrollGesture = React.useMemo(
    () => Gesture.Native().requireExternalGestureToFail(bodyGesture),
    [bodyGesture],
  );

  return (
    <Animated.View
      ref={ref}
      {...props}
      onLayout={(event) => {
        sheetHeight.set(event.nativeEvent.layout.height);
        onLayout?.(event);
      }}
      style={[styles.sheet, props.style, animatedStyle]}
    >
      <GestureDetector gesture={headerGesture}>
        <View collapsable={false}>{grabber}</View>
      </GestureDetector>
      <GestureDetector gesture={bodyGesture}>
        <Animated.View style={styles.scrollBody} collapsable={false}>
          <GestureDetector gesture={scrollGesture}>
            <KeyboardScrollView
              testID="drawer-scroll-view"
              mode="layout"
              extraKeyboardSpace={Platform.OS === 'ios' ? 0 : -bottomInset}
              bounces={false}
              showsVerticalScrollIndicator={false}
              onScroll={onScroll}
              scrollEventThrottle={16}
              onLayout={(event) => viewportHeight.set(event.nativeEvent.layout.height)}
              onContentSizeChange={(_, height) => contentHeight.set(height)}
              // Clear the system gesture bar or navigation buttons below the last control.
              contentContainerStyle={[styles.content, { paddingBottom: 28 + bottomInset }]}
            >
              <DrawerInnerScrollContext.Provider value={innerOffset}>
                <View className="gap-5">{children}</View>
              </DrawerInnerScrollContext.Provider>
            </KeyboardScrollView>
          </GestureDetector>
          {bottomInset > 0 && (
            <Animated.View
              pointerEvents="none"
              style={[styles.bottomFade, { height: fadeHeight }, fadeStyle]}
            >
              <Svg width="100%" height={fadeHeight}>
                <Defs>
                  <LinearGradient id="sheetFade" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={colors.bg} stopOpacity={0} />
                    <Stop
                      offset={String(28 / fadeHeight)}
                      stopColor={colors.bg}
                      stopOpacity={0.92}
                    />
                    <Stop offset="1" stopColor={colors.bg} stopOpacity={1} />
                  </LinearGradient>
                </Defs>
                <Rect width="100%" height={fadeHeight} fill="url(#sheetFade)" />
              </Svg>
            </Animated.View>
          )}
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
});

function DrawerOverlay({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Overlay>, 'style'>) {
  const { interactive } = useDrawerMotion();
  return (
    <FullWindowOverlay>
      <DialogPrimitive.Overlay
        className={cn('absolute bottom-0 left-0 right-0 top-0 flex justify-end', className)}
        {...props}
        accessibilityElementsHidden={!interactive}
        importantForAccessibility={interactive ? 'auto' : 'no-hide-descendants'}
        pointerEvents={interactive ? 'auto' : 'none'}
        style={styles.overlay}
      >
        <DrawerBackdropTint />
        <Pressable onPress={() => undefined} style={styles.sheetPressGuard}>
          {children}
        </Pressable>
      </DialogPrimitive.Overlay>
    </FullWindowOverlay>
  );
}
type DrawerContentProps = React.ComponentProps<typeof DialogPrimitive.Content> & {
  portalHost?: string;
};

function DrawerContent(props: DrawerContentProps) {
  const { open } = DialogPrimitive.useRootContext();
  // Avoid measuring, subscribing, and merging styles before the portal is visible.
  // The root stays open during its exit animation, and forceMount remains supported.
  return open || props.forceMount ? <MountedDrawerContent {...props} /> : null;
}

let contentMounts = 0;

function MountedDrawerContent({
  className,
  portalHost,
  children,
  style,
  ...props
}: DrawerContentProps) {
  const motion = useDrawerMotion();
  const { onOpenChange } = DialogPrimitive.useRootContext();
  const { height: windowHeight } = useWindowDimensions();
  // The portal host keeps content state by portal name, which is the same for a sheet
  // remounted in the same place. A per-mount key gives each opening fresh content state.
  const [mountKey] = React.useState(() => ++contentMounts);
  const contentChildren = React.Children.toArray(children);
  const header =
    contentChildren[0] &&
    React.isValidElement(contentChildren[0]) &&
    contentChildren[0].type === DrawerHeader
      ? contentChildren[0]
      : undefined;
  const body = header ? contentChildren.slice(1) : contentChildren;

  return (
    <DialogPrimitive.Portal hostName={portalHost}>
      <DrawerMotionContext.Provider key={mountKey} value={motion}>
        <DrawerOverlay>
          <DialogPrimitive.Content asChild {...props}>
            <DrawerSheet
              accessibilityViewIsModal
              className={cn(
                'bg-background border-border z-50 flex w-full overflow-hidden rounded-t-[28px] rounded-b-none border-t p-0 shadow-lg shadow-black/10',
                className,
                'mx-0 max-w-none gap-0 rounded-t-[28px] rounded-b-none border-x-0 border-b-0 p-0',
              )}
              style={[{ maxHeight: windowHeight * 0.92 }, style]}
              grabber={
                <>
                  <View
                    pointerEvents="none"
                    style={styles.handleArea}
                    // Screen readers can't drag, so the grabber doubles as a labelled close.
                    accessible={motion.dismissible}
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                    accessibilityActions={[{ name: 'activate' }]}
                    onAccessibilityAction={() => {
                      if (motion.dismissible) onOpenChange(false);
                    }}
                  >
                    <View style={styles.handle} />
                  </View>
                  {header}
                </>
              }
            >
              {body}
            </DrawerSheet>
          </DialogPrimitive.Content>
        </DrawerOverlay>
      </DrawerMotionContext.Provider>
    </DialogPrimitive.Portal>
  );
}

function DrawerHeader({ className, children, ...props }: ViewProps) {
  return (
    <View className={cn('h-14 w-full justify-center px-5', className)} {...props}>
      <View pointerEvents="none" style={styles.headerTitle}>
        {children}
      </View>
    </View>
  );
}

/** Every sheet title uses the one sheet-title style. */
function DrawerTitle({
  className,
  style,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-center', className)}
      style={[titleStyles.title, style]}
      {...props}
    />
  );
}

const titleStyles = createAppStyles({ title: { ...typeRamp.sheetTitle, textAlign: 'center' } }, [
  'title',
] as const);

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
  DrawerScrollView,
};

const styles = StyleSheet.create({
  sheetPressGuard: { width: '100%' },
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdropTint: {
    backgroundColor: colors.scrim,
  },
  sheet: {
    zIndex: 50,
    width: '100%',
    overflow: 'hidden',
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderColor: colors.border,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
  },
  handleArea: {
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
  },
  headerTitle: {
    alignItems: 'center',
  },
  scrollBody: { flexShrink: 1 },
  bottomFade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  content: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 28,
  },
});
