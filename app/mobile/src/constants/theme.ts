import { colors } from './colors';

/** Corner radii. Controls are fully rounded; containers step up with their size. */
export const radius = {
  /** Episode stills, small thumbnails. */
  xs: 8,
  /** Poster artwork. */
  sm: 10,
  /** List rows, inputs inside cards, tag chips' containers. */
  md: 14,
  /** Cards and grouped lists. */
  lg: 20,
  /** Bottom sheets. */
  sheet: 28,
  /** Buttons, chips, search fields, segmented controls. */
  pill: 999,
} as const;

/** Heights for tappable controls, smallest to largest. */
export const controlHeight = {
  sm: 36,
  md: 44,
  lg: 52,
} as const;

/** Icon button diameters. */
export const iconButtonSize = {
  sm: 32,
  md: 40,
  lg: 48,
} as const;

export const spacing = {
  screen: 20,
  section: 32,
} as const;

/**
 * Type ramp, before the app-wide font size compensation in `createAppStyles`.
 * Screen titles and section headings are always primary white.
 */
export const typeRamp = {
  screenTitle: {
    color: colors.text,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  sheetTitle: { color: colors.text, fontSize: 17, lineHeight: 22, fontWeight: '700' },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  rowTitle: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '600' },
  body: { color: colors.secondary, fontSize: 14, lineHeight: 20 },
  label: { color: colors.secondary, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  meta: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  caption: { color: colors.muted, fontSize: 11, lineHeight: 15 },
} as const;
