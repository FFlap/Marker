import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { NativePressable } from '@/components/ui/NativePressable';
import { colors } from '@/constants/colors';
import { createStyles } from '@/lib/typography';

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

  return (
    <NativePressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={2}
      onPress={goBack}
      style={s.button}
      pressedStyle={s.pressed}
    >
      <ArrowLeft size={18} color={colors.text} strokeWidth={1.7} />
    </NativePressable>
  );
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
      <View style={[s.header, { maxWidth }]}>
        <BackButton accessibilityLabel={backLabel} fallback={fallback} />
        <Text numberOfLines={1} style={s.title}>
          {title}
        </Text>
        {right}
      </View>
    </View>
  );
}

const s = createStyles({
  button: {
    width: 40,
    height: 40,
    flexShrink: 0,
    borderRadius: 20,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.62 },
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
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.6,
    flex: 1,
    minWidth: 0,
  },
});
