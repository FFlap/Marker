import { useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { captionFromLines } from '@/lib/text';

/**
 * A two-line poster caption. A hidden copy lays out the full title; when it needs more than
 * two lines, the shown caption ends at the last whole word that fits, with "…". A single
 * word too long for a line gets `shrunkStyle` instead of breaking mid-word.
 */
export function PosterCaption({
  title,
  textStyle,
  shrunkStyle,
  boxStyle,
  ellipsisFontSize,
}: {
  title: string;
  textStyle: StyleProp<TextStyle>;
  shrunkStyle?: StyleProp<TextStyle>;
  /** Reserve two lines here so captions keep a row even. */
  boxStyle?: StyleProp<ViewStyle>;
  /** Roughly the caption's font size, to leave room for the ellipsis. */
  ellipsisFontSize: number;
}) {
  const [layout, setLayout] = useState<{ title: string; caption?: string; shrunk: boolean }>({
    title,
    shrunk: false,
  });
  // A new title starts over rather than showing the previous title's trim.
  const current = layout.title === title ? layout : { title, shrunk: false };
  if (current !== layout) setLayout(current);
  const boxWidth = useRef(0);
  const style = [textStyle, current.shrunk && shrunkStyle];
  return (
    <View
      style={boxStyle}
      onLayout={(event) => {
        boxWidth.current = event.nativeEvent.layout.width;
      }}
    >
      <Text numberOfLines={2} android_hyphenationFrequency="normal" style={style}>
        {current.caption ?? title}
      </Text>
      <Text
        aria-hidden
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        android_hyphenationFrequency="normal"
        onTextLayout={(event) => {
          const lines = event.nativeEvent.lines;
          const splitWord = lines.some(
            (line, index) => index < lines.length - 1 && !/[\s\-‐]$/.test(line.text),
          );
          if (splitWord && !current.shrunk && shrunkStyle) {
            setLayout({ title, shrunk: true });
            return;
          }
          const caption = captionFromLines(
            lines,
            // Before the box reports its width, the widest line is a close stand-in.
            boxWidth.current || Math.max(...lines.map((line) => line.width)),
            ellipsisFontSize * (current.shrunk ? 0.8 : 0.9),
          );
          if (caption !== current.caption) setLayout({ ...current, caption });
        }}
        style={[style, styles.measure]}
      >
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  measure: { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 },
});
