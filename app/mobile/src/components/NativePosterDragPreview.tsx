import Reanimated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { Text } from 'react-native';
import { colors } from '@/constants/colors';
import { PosterImage } from '@/components/ui/PosterImage';
import { createAppStyles } from '@/lib/typography';

export type NativePosterDragMotion = {
  horizontalTranslate?: SharedValue<number>;
  isTouchActiveNative: SharedValue<boolean>;
  touchTranslate: SharedValue<number>;
};

export type NativePosterDragLayout = {
  height: number;
  left: number;
  rank?: number;
  top: number;
  width: number;
};

export type NativePosterDragBounds = {
  bottom: number;
  top: number;
};

const PREVIEW_PADDING = 4;
const PREVIEW_SCALE = 1.025;

export function clampNativePosterTop(
  intendedTop: number,
  height: number,
  bounds: NativePosterDragBounds,
  scale = 1,
) {
  'worklet';
  const scaleOverflow = (height * (scale - 1)) / 2;
  const minTop = bounds.top + scaleOverflow;
  const maxTop = Math.max(minTop, bounds.bottom - height - scaleOverflow);
  return Math.max(minTop, Math.min(maxTop, intendedTop));
}

export function NativePosterDragPreview({
  bounds,
  layout,
  motion,
  posterPath,
  title,
}: {
  bounds?: NativePosterDragBounds;
  layout: NativePosterDragLayout;
  motion: NativePosterDragMotion;
  posterPath?: string;
  title: string;
}) {
  const motionStyle = useAnimatedStyle(() => {
    const intendedTop = layout.top + motion.touchTranslate.value;
    const visibleTop = bounds
      ? clampNativePosterTop(
          intendedTop,
          layout.height + PREVIEW_PADDING * 2,
          bounds,
          PREVIEW_SCALE,
        )
      : intendedTop;
    return {
      opacity: motion.isTouchActiveNative.value ? 1 : 0,
      transform: [
        { translateX: motion.horizontalTranslate?.value ?? 0 },
        { translateY: visibleTop - layout.top },
        { scale: PREVIEW_SCALE },
      ],
    };
  });
  return (
    <Reanimated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[
        styles.preview,
        { left: layout.left, top: layout.top, width: layout.width },
        motionStyle,
      ]}
    >
      <PosterImage path={posterPath} title={title} style={styles.poster} />
      <Text numberOfLines={2} style={styles.title}>
        {layout.rank !== undefined && <Text style={styles.rank}>{layout.rank}. </Text>}
        {title}
      </Text>
    </Reanimated.View>
  );
}

const styles = createAppStyles(
  {
    preview: {
      position: 'absolute',
      zIndex: 30,
      elevation: 18,
      padding: PREVIEW_PADDING,
      borderRadius: 14,
      backgroundColor: colors.elevated,
      borderWidth: 1,
      borderColor: colors.text,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.38,
      shadowRadius: 16,
    },
    poster: { width: '100%', aspectRatio: 2 / 3, borderRadius: 10 },
    title: {
      color: colors.text,
      fontSize: 12,
      lineHeight: 16,
      marginTop: 6,
      fontWeight: '700',
    },
    rank: { color: colors.muted },
  },
  ['title', 'rank'] as const,
);
