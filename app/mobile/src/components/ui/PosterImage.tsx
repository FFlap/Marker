import type { ImageStyle, StyleProp, ViewStyle } from 'react-native';
import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';

export function PosterImage({
  path,
  title,
  style,
  testID,
}: {
  path?: string;
  title: string;
  style?: StyleProp<ImageStyle>;
  testID?: string;
}) {
  if (path)
    return (
      <Image
        testID={testID}
        source={`https://image.tmdb.org/t/p/w342${path}`}
        contentFit="cover"
        transition={150}
        style={[styles.poster, style]}
      />
    );
  const initials = title
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
  return (
    <View
      testID={testID}
      style={[styles.poster, styles.placeholder, style as StyleProp<ViewStyle>]}
    >
      <Text style={styles.initials}>{initials}</Text>
    </View>
  );
}

const styles = createAppStyles(
  {
    poster: {
      backgroundColor: colors.surface,
      borderRadius: 10,
      aspectRatio: 2 / 3,
      width: '100%',
    },
    placeholder: {
      position: 'relative',
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.border,
    },
    initials: { color: colors.muted, fontSize: 18, fontWeight: '700' },
  },
  ['initials'] as const,
);
