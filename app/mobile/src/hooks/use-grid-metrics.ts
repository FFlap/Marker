import { useCallback, useState } from 'react';
import { PixelRatio, type DimensionValue, type LayoutChangeEvent } from 'react-native';
import { gridMetrics } from '@/lib/displayPreferences';

export function useGridMetrics(columns: number) {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidth((current) => (Math.abs(current - next) < 0.5 ? current : next));
  }, []);
  const metrics: { gap: number | `${number}%`; itemWidth: DimensionValue } =
    width > 0
      ? gridMetrics(width, columns, PixelRatio.get())
      : { gap: '3%', itemWidth: `${(97 - 3 * (columns - 1)) / columns}%` };
  return { onLayout, ...metrics };
}
