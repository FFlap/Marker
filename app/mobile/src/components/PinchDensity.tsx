import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { colors } from '@/constants/colors';
import { type GridColumns, stepGridColumns } from '@/lib/displayPreferences';

export function PinchDensity({
  children,
  columns,
  onChange,
}: {
  children: ReactNode;
  columns: GridColumns;
  onChange: (columns: GridColumns) => void;
}) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [announcedColumns, setAnnouncedColumns] = useState<GridColumns>();
  const [opacity] = useState(() => new Animated.Value(0));
  const [scale] = useState(() => new Animated.Value(0.94));

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReducedMotion);
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReducedMotion,
    );
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (announcedColumns === undefined) return;
    opacity.stopAnimation();
    scale.stopAnimation();
    if (reducedMotion) {
      opacity.setValue(1);
      const timer = setTimeout(() => opacity.setValue(0), 650);
      return () => clearTimeout(timer);
    }
    opacity.setValue(0);
    scale.setValue(0.94);
    const animation = Animated.parallel([
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 140,
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.delay(420),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]),
      Animated.spring(scale, {
        toValue: 1,
        damping: 15,
        stiffness: 230,
        mass: 0.7,
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [announcedColumns, opacity, reducedMotion, scale]);

  const applyPinch = useCallback(
    (gestureScale: number) => {
      const direction = gestureScale < 0.82 ? 'out' : gestureScale > 1.18 ? 'in' : undefined;
      if (!direction) return;
      const next = stepGridColumns(columns, direction);
      if (next !== columns) {
        setAnnouncedColumns(next);
        onChange(next);
      }
    },
    [columns, onChange],
  );
  const pinch = useMemo(
    () =>
      Gesture.Pinch().onEnd((event) => {
        runOnJS(applyPinch)(event.scale);
      }),
    [applyPinch],
  );

  return (
    <GestureDetector gesture={pinch}>
      <View>
        {children}
        {announcedColumns !== undefined && (
          <Animated.View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            style={[s.badge, { opacity, transform: [{ scale }] }]}
          >
            <View style={s.miniGrid}>
              {Array.from({ length: announcedColumns }).map((_, index) => (
                <View key={index} style={s.miniPoster} />
              ))}
            </View>
            <Text style={s.label}>{announcedColumns} columns</Text>
          </Animated.View>
        )}
      </View>
    </GestureDetector>
  );
}

const s = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: 20,
    alignSelf: 'center',
    minWidth: 112,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 16,
    backgroundColor: colors.elevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: 7,
    boxShadow: '0 8px 18px rgba(0, 0, 0, 0.38)',
  },
  miniGrid: { height: 20, flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  miniPoster: { width: 9, height: 16, borderRadius: 2, backgroundColor: colors.text },
  label: { color: colors.text, fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
});
