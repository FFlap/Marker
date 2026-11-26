import type { ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';
import { router, type Href } from 'expo-router';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import { IconButton } from '@/components/ui/primitives';
import { colors } from '@/constants/colors';
import { typeRamp } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';

type BackButtonProps = {
  accessibilityLabel?: string;
  fallback?: Href;
};

function BackButton({
  accessibilityLabel = 'Back to library',
  fallback = '/(tabs)',
}: BackButtonProps = {}) {
  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(fallback);
  };

  return <IconButton icon={ArrowLeft} accessibilityLabel={accessibilityLabel} onPress={goBack} />;
}

type SecondaryHeaderProps = {
  title: string;
  maxWidth: number;
  backLabel?: string;
  fallback?: Href;
  right?: ReactNode;
};

export function SecondaryHeader({
  title,
  maxWidth,
  backLabel,
  fallback,
  right,
}: SecondaryHeaderProps) {
  return (
    <View style={s.toolbar}>
      {/* With no trailing icon, the title ends on the 20dp gutter like page content. */}
      <View style={[s.header, { maxWidth }, !right && s.headerPlain]}>
        <BackButton accessibilityLabel={backLabel} fallback={fallback} />
        <Animated.Text
          key={title}
          entering={FadeIn.duration(180).reduceMotion(ReduceMotion.System)}
          accessibilityRole="header"
          numberOfLines={1}
          style={s.title}
        >
          {title}
        </Animated.Text>
        {right}
      </View>
    </View>
  );
}

const s = createAppStyles(
  {
    toolbar: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 10,
      backgroundColor: colors.bg,
    },
    header: {
      width: '100%',
      alignSelf: 'center',
      height: 72,
      // Mirrors the left side: icon glyphs sit on the 20dp gutter.
      paddingLeft: 10,
      paddingRight: 10,
      paddingTop: 20,
      paddingBottom: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    headerPlain: { paddingRight: 20 },
    title: {
      ...typeRamp.screenTitle,
      fontSize: 24,
      lineHeight: 30,
      flex: 1,
      minWidth: 0,
    },
  },
  ['title'] as const,
);
