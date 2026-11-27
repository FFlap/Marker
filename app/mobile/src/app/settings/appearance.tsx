import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Columns2 from 'lucide-react-native/icons/columns-2';
import Grid3x3 from 'lucide-react-native/icons/grid-3x3';
import Rows2 from 'lucide-react-native/icons/rows-2';
import List from 'lucide-react-native/icons/list';
import { api } from '@marker/shared/api';
import { SecondaryHeader } from '@/components/BackButton';
import { LayoutPreview } from '@/components/LayoutPreview';
import { ScreenView } from '@/components/ScreenLayout';
import { Segmented } from '@/components/ui/primitives';
import { StepSlider } from '@/components/ui/StepSlider';
import { colors } from '@/constants/colors';
import { typeRamp } from '@/constants/theme';
import { useSettings } from '@/hooks/use-settings';
import type { GridColumns, ListColumns, ListTextSize } from '@/lib/displayPreferences';
import { createAppStyles } from '@/lib/typography';
import { useStartupQuery } from '@/hooks/useStartupQuery';

const TEXT_SIZES: ListTextSize[] = ['small', 'medium', 'large'];
const TEXT_SIZE_LABELS: Record<ListTextSize, string> = {
  small: 'Small',
  medium: 'Standard',
  large: 'Large',
};
const GRID_COLUMNS: GridColumns[] = [3, 4, 5];

const views = [
  {
    label: 'List',
    value: 'list',
    icon: (color: string) => <List size={18} color={color} strokeWidth={1.9} />,
  },
  {
    label: 'Posters',
    value: 'posters',
    icon: (color: string) => <Grid3x3 size={18} color={color} strokeWidth={1.9} />,
  },
] as const;

const listColumns = [
  {
    label: 'One column',
    value: '1',
    icon: (color: string) => <Rows2 size={18} color={color} strokeWidth={1.9} />,
  },
  {
    label: 'Two columns',
    value: '2',
    icon: (color: string) => <Columns2 size={18} color={color} strokeWidth={1.9} />,
  },
] as const;

export default function AppearanceSettings() {
  const { current, loaded: settingsLoaded, pending, update } = useSettings();
  // Through the startup data, like the settings, so the preview has your titles at once.
  const items = useStartupQuery(api.library.items.listItems);
  // Shown once both your settings and your titles are known, so neither shows a stand-in.
  const loaded = settingsLoaded && items !== undefined;
  const watched = items
    ?.filter((item) => item.status === 'watched')
    .sort((left, right) => left.rank - right.rank);
  const previewItems = watched?.slice(0, 10);
  // Slider drags update the preview immediately and save once on release.
  const [preview, setPreview] = useState<{ text?: ListTextSize; grid?: GridColumns }>({});
  const textSize = preview.text ?? current.listTextSize;
  const gridColumns = preview.grid ?? current.gridColumns;
  const textIndex = TEXT_SIZES.indexOf(current.listTextSize);
  const gridIndex = GRID_COLUMNS.indexOf(current.gridColumns);

  return (
    <ScreenView style={s.root}>
      <SecondaryHeader
        title="Appearance"
        backLabel="Back to settings"
        fallback="/(tabs)/settings"
        maxWidth={680}
      />
      {/* Held back (space kept) until the saved layout is known, so the preview and controls
          never show a default that isn't yours. */}
      {!loaded && (
        <Text accessibilityRole="progressbar" pointerEvents="none" style={s.loadingLabel}>
          Loading appearance
        </Text>
      )}
      {/* The preview stays pinned at the top while the controls scroll under it, so its
          change is always in view. */}
      <ScrollView
        contentContainerStyle={s.content}
        stickyHeaderIndices={[0]}
        style={!loaded && s.waiting}
        pointerEvents={loaded ? 'auto' : 'none'}
        accessibilityElementsHidden={!loaded}
        importantForAccessibility={loaded ? 'auto' : 'no-hide-descendants'}
      >
        <LayoutPreview
          view={current.defaultView}
          textSize={textSize}
          listColumns={current.listColumns}
          gridColumns={gridColumns}
          items={previewItems}
          total={watched?.length}
        />
        <Text style={s.caption}>Your library and tags use this layout.</Text>

        <View style={s.group}>
          <Text style={s.label}>Layout</Text>
          <Segmented
            options={views}
            value={current.defaultView}
            disabled={pending.has('defaultView')}
            onChange={(value) => void update('defaultView', value)}
          />
        </View>

        {current.defaultView === 'list' ? (
          <>
            <View style={s.group}>
              <Text style={s.label}>List text size</Text>
              {/* Named stops under the track, like Posters per row's numbers. */}
              <View style={s.slider}>
                <StepSlider
                  stopLabels={TEXT_SIZES.map((size) => TEXT_SIZE_LABELS[size])}
                  steps={TEXT_SIZES.length}
                  index={Math.max(0, textIndex)}
                  accessibilityLabel="List text size"
                  valueLabel={TEXT_SIZE_LABELS[textSize]}
                  onPreview={(index) =>
                    setPreview((value) => ({
                      ...value,
                      text: index === undefined ? undefined : TEXT_SIZES[index],
                    }))
                  }
                  onChange={(index) => void update('listTextSize', TEXT_SIZES[index]!)}
                />
              </View>
            </View>
            <View style={s.group}>
              <Text style={s.label}>Columns</Text>
              <Segmented
                options={listColumns}
                value={String(current.listColumns) as '1' | '2'}
                disabled={pending.has('listColumns')}
                onChange={(value) => void update('listColumns', Number(value) as ListColumns)}
              />
            </View>
          </>
        ) : (
          <View style={s.group}>
            <Text style={s.label}>Posters per row</Text>
            {/* Each stop is labelled with its number; the current one is white. */}
            <View style={s.slider}>
              <StepSlider
                stopLabels={GRID_COLUMNS.map(String)}
                steps={GRID_COLUMNS.length}
                index={Math.max(0, gridIndex)}
                accessibilityLabel="Posters per row"
                valueLabel={`${gridColumns} posters`}
                onPreview={(index) =>
                  setPreview((value) => ({
                    ...value,
                    grid: index === undefined ? undefined : GRID_COLUMNS[index],
                  }))
                }
                onChange={(index) => void update('gridColumns', GRID_COLUMNS[index]!)}
              />
            </View>
            <Text style={s.hint}>You can also pinch the library to change this.</Text>
          </View>
        )}
      </ScrollView>
    </ScreenView>
  );
}

const s = createAppStyles(
  {
    waiting: { opacity: 0 },
    // Read by screen readers only; the page itself stays empty until the layout is known.
    loadingLabel: { position: 'absolute', opacity: 0 },
    root: { flex: 1, backgroundColor: colors.bg },
    content: {
      width: '100%',
      maxWidth: 680,
      alignSelf: 'center',
      paddingHorizontal: 20,
      paddingTop: 88,
      paddingBottom: 56,
      gap: 28,
    },
    group: { gap: 14 },
    label: { ...typeRamp.sectionTitle },
    caption: { ...typeRamp.meta, marginTop: -16 },
    hint: { ...typeRamp.meta },
    slider: { flex: 1, minWidth: 0 },
  },
  ['label', 'caption', 'hint'] as const,
);
