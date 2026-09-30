export type GridColumns = 3 | 4 | 5;
export type ListColumns = 1 | 2;
export type ListTextSize = 'small' | 'medium' | 'large';

export const DEFAULT_DISPLAY_PREFERENCES = {
  gridColumns: 3 as GridColumns,
  listColumns: 1 as ListColumns,
  listTextSize: 'medium' as ListTextSize,
};

export function stepGridColumns(columns: GridColumns, direction: 'in' | 'out'): GridColumns {
  if (direction === 'out') return Math.min(5, columns + 1) as GridColumns;
  return Math.max(3, columns - 1) as GridColumns;
}

/** Space between grid cells, as a share of the grid's width. */
const GRID_GAP_RATIO = 0.035;

/**
 * Cell width and gap in whole device pixels, rounded down so a full row always fits.
 * Percentage widths that add up to exactly 100% can round a few pixels over and push
 * the last cell of every row onto the next line on some screen widths.
 */
export function gridMetrics(width: number, columns: number, pixelRatio: number) {
  const floorToPixel = (value: number) => Math.floor(value * pixelRatio) / pixelRatio;
  const gap = floorToPixel(width * GRID_GAP_RATIO);
  return { gap, itemWidth: floorToPixel((width - gap * (columns - 1)) / columns) };
}

/** Two-column list cells leave slack between them instead of summing to 100%. */
export function listItemWidth(columns: ListColumns) {
  return columns === 2 ? '48%' : '100%';
}

export function listTypography(size: ListTextSize) {
  if (size === 'small') return { fontSize: 13, lineHeight: 18, minHeight: 44 };
  if (size === 'large') return { fontSize: 19, lineHeight: 26, minHeight: 52 };
  return { fontSize: 16, lineHeight: 22, minHeight: 44 };
}
