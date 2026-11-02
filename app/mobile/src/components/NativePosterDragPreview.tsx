import { useCallback, useRef, useState, type ReactNode } from 'react';
import Reanimated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { Text } from 'react-native';
import { colors } from '@/constants/colors';
import { PosterImage } from '@/components/ui/PosterImage';
import { createAppStyles } from '@/lib/typography';

export type NativePosterDragMotion = {
  horizontalTranslate?: SharedValue<number>;
  isTouchActiveNative: SharedValue<boolean>;
  touchTranslate: SharedValue<number>;
  onPreviewReady?: () => void;
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
  children,
  layout,
  motion,
  posterPath,
  title,
}: {
  children?: ReactNode;
  bounds?: NativePosterDragBounds;
  layout: NativePosterDragLayout;
  motion: NativePosterDragMotion;
  posterPath?: string;
  title: string;
}) {
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  const [imageFailed, setImageFailed] = useState(false);
  const onPreviewReady = motion.onPreviewReady;
  const onDisplay = useCallback(() => {
    if (readyRef.current) return;
    readyRef.current = true;
    // Batch the preview reveal and the original card placeholder in React.
    setReady(true);
    onPreviewReady?.();
  }, [onPreviewReady]);
  const onError = useCallback(() => {
    setImageFailed(true);
    onDisplay();
  }, [onDisplay]);
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
      // The owner unmounts this preview with the final cell-order commit.
      // Hiding on native touch-up would leave a gap before that commit.
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
      onLayout={children || !posterPath ? onDisplay : undefined}
      style={[
        styles.preview,
        { left: layout.left, top: layout.top, width: layout.width, opacity: ready ? 1 : 0 },
        motionStyle,
      ]}
    >
      {children || (
        <>
          <PosterImage
            path={imageFailed ? undefined : posterPath}
            title={title}
            style={styles.poster}
            transition={0}
            onDisplay={onDisplay}
            onError={onError}
          />
          <Text numberOfLines={2} style={styles.title}>
            {layout.rank !== undefined && <Text style={styles.rank}>{layout.rank}. </Text>}
            {title}
          </Text>
        </>
      )}
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
