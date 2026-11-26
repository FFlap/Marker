import { Text, View } from 'react-native';
import { Button, EmptyState, TextAction } from '@/components/ui/primitives';
import { typeRamp } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';

/**
 * A title search that failed (not one with no matches): says so and offers to try the same
 * query again. `inline` is the compact form shown above results that did load.
 */
export function SearchFailed({
  onRetry,
  inline = false,
}: {
  onRetry: () => void;
  inline?: boolean;
}) {
  if (inline)
    return (
      <View style={s.inline}>
        <Text style={s.inlineText}>Couldn’t load movies and TV shows.</Text>
        <TextAction title="Try again" onPress={onRetry} />
      </View>
    );
  return (
    <View style={s.block}>
      <EmptyState title="Search isn’t available" detail="Check your connection and try again." />
      <Button title="Try again" variant="secondary" size="sm" onPress={onRetry} />
    </View>
  );
}

const s = createAppStyles(
  {
    block: { alignItems: 'center', gap: 4 },
    inline: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      marginBottom: 16,
    },
    inlineText: { ...typeRamp.meta, flex: 1 },
  },
  ['inlineText'] as const,
);
