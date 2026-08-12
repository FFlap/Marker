import { StyleSheet, TextStyle } from 'react-native';

const fonts = {
  regular: 'AlbertSans_400Regular',
  medium: 'AlbertSans_500Medium',
  semibold: 'AlbertSans_600SemiBold',
  bold: 'AlbertSans_700Bold',
} as const;

// Albert Sans reads slightly smaller than the previous system face at the same
// numeric size. Compensate for its visual metrics without scaling controls or
// layout spacing along with the text.
const FONT_SIZE_COMPENSATION = 1.08;

function compensate(value: TextStyle['fontSize']) {
  return typeof value === 'number' ? Math.round(value * FONT_SIZE_COMPENSATION) : value;
}

function familyFor(style: TextStyle) {
  const weight = style.fontWeight;
  if (weight === 'bold' || Number(weight) >= 700) return fonts.bold;
  if (Number(weight) >= 600) return fonts.semibold;
  if (Number(weight) >= 500) return fonts.medium;
  return fonts.regular;
}

export function createStyles<T extends StyleSheet.NamedStyles<T>>(styles: T): T {
  const withFonts = Object.fromEntries(
    Object.entries(styles).map(([key, style]) => {
      const textStyle = style as TextStyle;
      const isText =
        'color' in textStyle ||
        'fontSize' in textStyle ||
        'fontWeight' in textStyle ||
        'lineHeight' in textStyle ||
        'letterSpacing' in textStyle ||
        'textAlign' in textStyle ||
        'textTransform' in textStyle ||
        'fontVariant' in textStyle;
      return [
        key,
        isText
          ? {
              ...textStyle,
              fontSize: compensate(textStyle.fontSize),
              lineHeight: compensate(textStyle.lineHeight),
              fontFamily: familyFor(textStyle),
            }
          : style,
      ];
    }),
  ) as T;
  return StyleSheet.create(withFonts);
}
