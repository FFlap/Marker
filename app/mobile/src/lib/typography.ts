import { Platform, StyleSheet, TextStyle } from 'react-native';
import { fontFamilies as fonts } from './fonts';

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

/**
 * Only fill in values the style declares. Override styles such as `{ color }` for a
 * selected state are merged after a base style, so writing `fontSize: undefined` or a
 * regular family into them would erase the base size and weight.
 */
function withAppFont(style: TextStyle): TextStyle {
  const next: TextStyle = { ...style };
  if (style.fontSize !== undefined) next.fontSize = compensate(style.fontSize);
  if (style.lineHeight !== undefined) next.lineHeight = compensate(style.lineHeight);
  if (style.fontWeight !== undefined || style.fontSize !== undefined) {
    next.fontFamily = familyFor(style);
    // Each weight is its own family. Android would also look for a bold style of that
    // family, not find one, and draw the system font instead (or fake-bold the face).
    if (Platform.OS === 'android' && style.fontWeight !== undefined) next.fontWeight = 'normal';
  }
  return next;
}

export function createAppStyles<T extends StyleSheet.NamedStyles<T>, K extends keyof T>(
  styles: T,
  textKeys: readonly K[],
): T {
  const textKeySet = new Set<keyof T>(textKeys);
  const withFonts = Object.fromEntries(
    Object.entries(styles).map(([key, style]) => {
      const textStyle = style as TextStyle;
      return [key, textKeySet.has(key as keyof T) ? withAppFont(textStyle) : style];
    }),
  ) as T;
  return StyleSheet.create(withFonts);
}
