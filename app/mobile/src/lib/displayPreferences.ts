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

export function gridItemWidth(columns: GridColumns) {
  return ({ 3: '31%', 4: '22.375%', 5: '17.2%' } as const)[columns];
}

export function listItemWidth(columns: ListColumns) {
  return columns === 2 ? '48.25%' : '100%';
}

export function listTypography(size: ListTextSize) {
  if (size === 'small') return { fontSize: 13, lineHeight: 18, minHeight: 44 };
  if (size === 'large') return { fontSize: 19, lineHeight: 26, minHeight: 52 };
  return { fontSize: 16, lineHeight: 22, minHeight: 44 };
}
