import { Image } from 'expo-image';
import { Text, View } from 'react-native';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';

export function ProfileAvatar({
  username,
  avatarUrl,
  size = 48,
}: {
  username?: string;
  avatarUrl?: string;
  size?: number;
}) {
  const frame = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View
      accessibilityLabel={username ? `${username}'s profile photo` : 'Profile photo'}
      style={[s.frame, frame]}
    >
      {avatarUrl ? (
        <Image
          source={avatarUrl}
          contentFit="cover"
          transition={120}
          recyclingKey={avatarUrl}
          style={frame}
        />
      ) : (
        <Text style={[s.initial, { fontSize: Math.max(13, size * 0.34) }]}>
          {(username?.trim().charAt(0) || 'M').toLocaleUpperCase()}
        </Text>
      )}
    </View>
  );
}

const s = createAppStyles(
  {
    frame: {
      overflow: 'hidden',
      flexShrink: 0,
      backgroundColor: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    initial: { color: colors.bg, fontWeight: '700' },
  },
  ['initial'] as const,
);
