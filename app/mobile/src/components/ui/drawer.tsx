import { cn } from '@/lib/utils';
import { colors } from '@/constants/colors';
import * as DialogPrimitive from '@rn-primitives/dialog';
import * as React from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewProps,
} from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { FullWindowOverlay as RNFullWindowOverlay } from 'react-native-screens';

const DrawerTrigger = DialogPrimitive.Trigger;
const DrawerClose = DialogPrimitive.Close;

const DrawerPortal = DialogPrimitive.Portal;

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
  progress: SharedValue<number>;
};

const DrawerMotionContext = React.createContext<DrawerMotionContextValue | null>(null);

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
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const isControlled = openProp !== undefined;
  const requestedOpen = isControlled ? openProp : defaultOpen;
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(() => Boolean(requestedOpen));
  const [closing, setClosing] = React.useState(false);
  const progress = useSharedValue(0);
  const effectiveRequestedOpen = isControlled ? Boolean(openProp) : uncontrolledOpen;

  const clearCloseTimer = React.useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  React.useEffect(() => {
    progress.set(
      withTiming(effectiveRequestedOpen ? 1 : 0, {
        duration: effectiveRequestedOpen ? enterDuration : exitDuration,
        easing: effectiveRequestedOpen ? enterEasing : exitEasing,
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [effectiveRequestedOpen, progress]);

  React.useEffect(() => clearCloseTimer, [clearCloseTimer]);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      clearCloseTimer();
      setClosing(false);
      if (!isControlled) setUncontrolledOpen(true);
      onOpenChange?.(true);
      return;
    }
    clearCloseTimer();
    setClosing(true);
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
      setClosing(false);
    }, exitDuration);
  }

  return (
    <DrawerMotionContext.Provider
      value={{ interactive: effectiveRequestedOpen && !closing, progress }}
    >
      <DialogPrimitive.Root
        open={effectiveRequestedOpen}
        onOpenChange={handleOpenChange}
        {...props}
      />
    </DrawerMotionContext.Provider>
  );
}

const DrawerBackdrop = React.forwardRef<
  React.ComponentRef<typeof Pressable>,
  React.ComponentProps<typeof Pressable>
>(function DrawerBackdrop({ children, ...props }, ref) {
  return (
    <Pressable ref={ref} {...props}>
      {children}
    </Pressable>
  );
});

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
  const { interactive, progress } = useDrawerMotion();
  const { onOpenChange } = DialogPrimitive.useRootContext();
  const sheetHeight = useSharedValue(windowHeight);
  const dragStart = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.get()) * sheetHeight.get() }],
  }));
  const dragGesture = React.useMemo(
    () =>
      Gesture.Pan()
        .enabled(interactive && Platform.OS !== 'web')
        .maxPointers(1)
        .activeOffsetY([-10_000, 4])
        .failOffsetX([-32, 32])
        .onBegin(() => {
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
          if (success) return;
          progress.set(
            withTiming(1, {
              duration: settleDuration,
              easing: enterEasing,
              reduceMotion: ReduceMotion.System,
            }),
          );
        }),
    [dragStart, interactive, onOpenChange, progress, sheetHeight],
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
      <GestureDetector gesture={dragGesture}>
        <View collapsable={false}>{grabber}</View>
      </GestureDetector>
      {children}
    </Animated.View>
  );
});

function DrawerOverlay({
  className,
  children,
  onPress,
  ...props
}: Omit<React.ComponentProps<typeof Pressable>, 'style'> & {
  children?: React.ReactNode;
}) {
  const { interactive } = useDrawerMotion();
  const { onOpenChange } = DialogPrimitive.useRootContext();

  function onOverlayPress(event: Parameters<NonNullable<typeof onPress>>[0]) {
    onPress?.(event);
    onOpenChange(false);
  }

  return (
    <FullWindowOverlay>
      <DrawerBackdrop
        className={cn(
          'absolute bottom-0 left-0 right-0 top-0 flex justify-end',
          Platform.select({
            web: 'fixed cursor-default [&>*]:cursor-auto',
          }),
          className,
        )}
        {...props}
        accessibilityElementsHidden={!interactive}
        importantForAccessibility={interactive ? 'auto' : 'no-hide-descendants'}
        onPress={onOverlayPress}
        pointerEvents={interactive ? 'auto' : 'none'}
        style={styles.overlay}
      >
        <DrawerBackdropTint />
        <Pressable onPress={() => undefined} style={styles.sheetPressGuard}>
          {children}
        </Pressable>
      </DrawerBackdrop>
    </FullWindowOverlay>
  );
}
function DrawerContent({
  className,
  portalHost,
  children,
  style,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  portalHost?: string;
}) {
  const motion = useDrawerMotion();
  const { height: windowHeight } = useWindowDimensions();
  const contentChildren = React.Children.toArray(children);
  const header =
    contentChildren[0] &&
    React.isValidElement(contentChildren[0]) &&
    contentChildren[0].type === DrawerHeader
      ? contentChildren[0]
      : undefined;
  const body = header ? contentChildren.slice(1) : contentChildren;

  return (
    <DrawerPortal hostName={portalHost}>
      <DrawerMotionContext.Provider value={motion}>
        <DrawerOverlay>
          <DialogPrimitive.Content asChild {...props}>
            <DrawerSheet
              className={cn(
                'bg-background border-border z-50 flex w-full overflow-hidden rounded-t-[28px] rounded-b-none border-t p-0 shadow-lg shadow-black/10',
                className,
                'mx-0 max-w-none gap-0 rounded-t-[28px] rounded-b-none border-x-0 border-b-0 p-0',
              )}
              style={[{ maxHeight: windowHeight * 0.92 }, style]}
              grabber={
                <>
                  <View pointerEvents="none" style={styles.handleArea}>
                    <View style={styles.handle} />
                  </View>
                  {header}
                </>
              }
            >
              <ScrollView
                bounces={false}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.content}
              >
                <View className="gap-6">{body}</View>
              </ScrollView>
            </DrawerSheet>
          </DialogPrimitive.Content>
        </DrawerOverlay>
      </DrawerMotionContext.Provider>
    </DrawerPortal>
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

function DrawerFooter({ className, ...props }: ViewProps) {
  return (
    <View
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

function DrawerTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-foreground text-center text-base font-semibold leading-none', className)}
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
};

const styles = StyleSheet.create({
  sheetPressGuard: { width: '100%' },
  overlay: {
    position: Platform.OS === 'web' ? ('fixed' as 'absolute') : 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdropTint: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  sheet: {
    zIndex: 50,
    width: '100%',
    overflow: 'hidden',
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderColor: colors.border,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
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
    backgroundColor: '#3A3A3D',
  },
  headerTitle: {
    alignItems: 'center',
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 28,
  },
});
