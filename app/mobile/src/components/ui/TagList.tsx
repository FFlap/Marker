import { Text, View } from 'react-native';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';

// Read-only tags stay compact so they read as metadata, not as controls.
export function TagList({ tags }: { tags: readonly string[] }) {
  return (
    <View style={styles.list}>
      {[...new Set(tags)].map((tag) => (
        <View key={tag} style={styles.tag}>
          <Text style={styles.tagText}>{tag}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = createAppStyles(
  {
    list: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    tag: {
      minHeight: 24,
      maxWidth: '100%',
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 6,
      justifyContent: 'center',
    },
    tagText: { color: colors.muted, fontSize: 11, fontWeight: '500', letterSpacing: 0.1 },
  },
  ['tagText'] as const,
);
