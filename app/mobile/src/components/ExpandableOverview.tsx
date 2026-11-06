import { useState } from 'react';
import { Text, View, type StyleProp, type TextStyle } from 'react-native';
import { NativePressable } from '@/components/ui/NativePressable';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';

export function ExpandableOverview({
  text,
  style,
  testID,
}: {
  text: string;
  style: StyleProp<TextStyle>;
  testID?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);

  return (
    <View>
      <Text testID={testID} style={style} numberOfLines={expanded ? undefined : 3}>
        {text}
      </Text>
      {/* Measure the full text because native platforms can report only the clamped lines. */}
      <View
        style={styles.measurement}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text
          style={style}
          onTextLayout={(event) => setTruncated(event.nativeEvent.lines.length > 3)}
        >
          {text}
        </Text>
      </View>
      {truncated && (
        <NativePressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(!expanded)}
          style={styles.toggle}
          pressedStyle={styles.pressed}
        >
          <Text style={styles.toggleText}>{expanded ? 'Read less' : 'Read more'}</Text>
        </NativePressable>
      )}
    </View>
  );
}

const styles = createAppStyles(
  {
    measurement: { position: 'absolute', top: 0, left: 0, right: 0, opacity: 0 },
    toggle: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center' },
    toggleText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    pressed: { opacity: 0.6 },
  },
  ['toggleText'] as const,
);
