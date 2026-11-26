/**
 * Text follows three levels of emphasis: `text` for titles, headings and values a person
 * scans for, `secondary` for supporting copy, and `muted` for metadata and captions.
 * `faint` is reserved for placeholders and unavailable controls.
 */
export const colors = {
  bg: '#0A0A0B',
  surface: '#141417',
  elevated: '#1E1E22',
  border: '#26262B',
  borderStrong: '#3A3A41',
  /** Outline of unchecked checkboxes, radios and toggles; needs 3:1 against the page. */
  control: '#66666F',
  text: '#F4F4F5',
  secondary: '#B8B8BF',
  muted: '#86868E',
  faint: '#55555C',
  accent: '#F4F4F5',
  danger: '#E5675F',
  scrim: 'rgba(0, 0, 0, 0.62)',
} as const;
