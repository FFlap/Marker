import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

export function SkeletonShimmer() {
  const [progress] = useState(() => new Animated.Value(0));
  const { width } = useWindowDimensions();
  const travelWidth = Math.min(width, 760);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

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

  if (reduceMotion) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.band,
        {
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [-120, travelWidth + 120],
              }),
            },
            { rotate: '12deg' },
          ],
        },
      ]}
    >
      <View style={styles.edge} />
      <View style={styles.core} />
      <View style={styles.edge} />
    </Animated.View>
  );
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
