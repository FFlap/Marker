import { useState } from 'react';
import { PixelRatio, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { SectionHeading } from '@/components/ui/primitives';
import { colors } from '@/constants/colors';
import {
  LibraryPosterCard,
  LibraryRow,
  twoColumnPairHeight,
  useTitleLines,
  type CardItem,
} from '@/features/library/components/LibraryItemCards';
import {
  gridMetrics,
  listTypography,
  type GridColumns,
  type ListColumns,
  type ListTextSize,
} from '@/lib/displayPreferences';
import { createAppStyles } from '@/lib/typography';

const sample = (id: number, title: string, rating: number): CardItem => ({
  _id: `sample-${id}` as CardItem['_id'],
  title,
  rating,
  status: 'watched',
});

const SAMPLE: CardItem[] = [
  sample(1, 'Frieren: Beyond Journey’s End', 5),
  sample(2, 'Spirited Away', 4.5),
  sample(3, 'SPY x FAMILY', 4),
  sample(4, 'Paprika', 4),
  sample(5, 'Dan Da Dan', 3.5),
  sample(6, 'Inception', 4.5),
  sample(7, 'Chainsaw Man', 4),
  sample(8, 'One Piece', 3.5),
  sample(9, 'Wind Breaker', 3),
  sample(10, 'Sakamoto Days', 4),
];

/**
 * The real library cards at the library's own width, so layout settings preview exactly
 * what the library will show. Bleeds to the screen edges like the library does.
 */
export function LayoutPreview({
  view,
  textSize,
  listColumns,
  gridColumns,
  items,
  total,
}: {
  view: 'list' | 'posters';
  textSize: ListTextSize;
  listColumns: ListColumns;
  gridColumns: GridColumns;
  items?: CardItem[];
  /** How many watched titles the library has; the heading shows it for real entries. */
  total?: number;
}) {
  const [width, setWidth] = useState(0);
  const titleLines = useTitleLines();
  // A library with too few watched titles previews sample ones, labelled as such.
  const sampled = !items || items.length < 4;
  const source = sampled ? SAMPLE : items;
  const columns = view === 'posters' ? gridColumns : listColumns;
  const { gap, itemWidth } = gridMetrics(width, columns, PixelRatio.get());
  // A fixed-height window into the library: settings change what fills it, never its
  // height, so the controls below stay put while a slider is dragged.
  const shown = source.slice(0, view === 'posters' ? gridColumns * 2 : listColumns === 2 ? 8 : 6);
  const typography = listTypography(textSize);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={s.stage}
    >
      <SectionHeading
        title={sampled ? 'Sample layout' : 'Watched'}
        count={sampled ? undefined : (total ?? source.length)}
        style={s.heading}
        large={view === 'list' && textSize === 'large'}
      />
      <View style={s.window}>
        <View
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          style={[s.grid, { columnGap: gap, rowGap: view === 'posters' ? 12 : 0 }]}
        >
          {width > 0 &&
            shown.map((item, index) => (
              <View
                key={item._id}
                style={[
                  { width: itemWidth },
                  view === 'list' && listColumns === 1 && { height: typography.minHeight },
                ]}
              >
                {view === 'posters' ? (
                  <LibraryPosterCard
                    item={item}
                    rank={index + 1}
                    ranked
                    disabled
                    compact={gridColumns === 5}
                  />
                ) : (
                  <LibraryRow
                    item={item}
                    rank={index + 1}
                    ranked
                    disabled
                    textSize={textSize}
                    contained={listColumns === 2}
                    pairHeight={
                      listColumns === 2
                        ? twoColumnPairHeight(
                            shown,
                            index,
                            itemWidth,
                            textSize,
                            titleLines.measured,
                          )
                        : undefined
                    }
                    onTitleLines={titleLines.report}
                  />
                )}
              </View>
            ))}
        </View>
        <Svg pointerEvents="none" width="100%" height={FADE} style={s.fade}>
          <Defs>
            <LinearGradient id="previewFade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.bg} stopOpacity={0} />
              <Stop offset="1" stopColor={colors.bg} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height={FADE} fill="url(#previewFade)" />
        </Svg>
      </View>
    </View>
  );
}

const WINDOW_HEIGHT = 200;
const FADE = 72;

const s = createAppStyles(
  {
    stage: {
      marginHorizontal: -20,
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 20,
      backgroundColor: colors.bg,
    },

    heading: { marginBottom: 12 },
    window: { height: WINDOW_HEIGHT, overflow: 'hidden' },
    // Laid out at its natural height and clipped by the window, never squeezed into it.
    grid: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    fade: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  },
  [] as const,
);
