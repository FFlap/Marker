import { Text, View } from 'react-native';
import { useStartupData } from '@/hooks/useStartupQuery';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';

export function StartupSyncStatus({ bottom = 16 }: { bottom?: number }) {
  const startup = useStartupData();
  if (!startup?.cached) return null;
  return (
    <View pointerEvents="none" style={[styles.container, { bottom }]}>
      <Text accessibilityLiveRegion="polite" style={styles.label}>
        Saved content · Updating…
      </Text>
    </View>
  );
}

const styles = createAppStyles(
  {
    container: {
      position: 'absolute',
      alignSelf: 'center',
      backgroundColor: colors.bg,
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 12,
    },
    label: { color: colors.muted, fontSize: 11 },
  },
  ['label'] as const,
);
