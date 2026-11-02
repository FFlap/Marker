import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';

function useShimmerAnimation() {
  const [progress] = useState(() => new Animated.Value(0));
  const { width } = useWindowDimensions();
  const travelWidth = Math.min(width, 760);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    progress.setValue(0);
    if (reduceMotion) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: 1100,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.delay(350),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion]);

  const style = useMemo(
    () => [
      styles.band,
      {
        transform: [
          {
            translateX: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [-120, travelWidth + 120],
            }),
          },
          { rotate: '12deg' as const },
        ],
      },
    ],
    [progress, travelWidth],
  );
  return useMemo(() => ({ style, reduceMotion }), [style, reduceMotion]);
}

const ShimmerContext = createContext<ReturnType<typeof useShimmerAnimation> | null>(null);

/** A loading screen's blocks share one native animation and interpolation graph. */
export function SkeletonShimmerGroup({ children }: { children: ReactNode }) {
  const animation = useShimmerAnimation();
  return <ShimmerContext value={animation}>{children}</ShimmerContext>;
}

function ShimmerBand({ animation }: { animation: ReturnType<typeof useShimmerAnimation> }) {
  if (animation.reduceMotion) return null;

  return (
    <Animated.View pointerEvents="none" style={animation.style}>
      <View style={styles.edge} />
      <View style={styles.core} />
      <View style={styles.edge} />
    </Animated.View>
  );
}

function StandaloneShimmer() {
  return <ShimmerBand animation={useShimmerAnimation()} />;
}

export function SkeletonShimmer() {
  const animation = useContext(ShimmerContext);
  return animation ? <ShimmerBand animation={animation} /> : <StandaloneShimmer />;
}

const styles = StyleSheet.create({
  band: {
    position: 'absolute',
    top: -48,
    bottom: -48,
    left: 0,
    width: 108,
    flexDirection: 'row',
  },
  edge: { flex: 1, backgroundColor: 'rgba(244, 244, 245, 0.045)' },
  core: { flex: 1.35, backgroundColor: 'rgba(244, 244, 245, 0.14)' },
});
