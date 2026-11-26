import { Text, View } from 'react-native';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';

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
      minHeight: 26,
      maxWidth: '100%',
      paddingHorizontal: 11,
      paddingVertical: 4,
      borderRadius: radius.pill,
      backgroundColor: colors.elevated,
      justifyContent: 'center',
    },
    tagText: { color: colors.secondary, fontSize: 12, fontWeight: '500' },
  },
  ['tagText'] as const,
);
