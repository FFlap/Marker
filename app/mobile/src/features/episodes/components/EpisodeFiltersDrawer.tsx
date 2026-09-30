import { StyleSheet, View } from 'react-native';
import { FilterSheetFooter, FilterTrigger } from '@/components/FilterSheetParts';
import {
  ControlSection,
  MinimumRatingControl,
  SelectableTag,
} from '@/components/ui/library-controls';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Segmented } from '@/components/ui/primitives';

export type ShowFilter = 'all' | 'anime' | 'other';

const showOptions = [
  { value: 'all', label: 'All' },
  { value: 'anime', label: 'Anime' },
  { value: 'other', label: 'Other TV' },
] as const satisfies readonly { value: ShowFilter; label: string }[];

export function EpisodeFiltersDrawer({
  tab,
  active,
  showFilter,
  minimumRating,
  tagFilter,
  tags,
  onShowFilterChange,
  onMinimumRatingChange,
  onTagFilterChange,
}: {
  tab: 'watching' | 'favorites';
  active: boolean;
  showFilter: ShowFilter;
  minimumRating: number;
  /** Lower-cased tag, or `all`. */
  tagFilter: string;
  tags: string[];
  onShowFilterChange: (value: ShowFilter) => void;
  onMinimumRatingChange: (value: number) => void;
  onTagFilterChange: (value: string) => void;
}) {
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <FilterTrigger accessibilityLabel={`Filter ${tab} episodes`} active={active} />
      </DrawerTrigger>
      <DrawerContent className="max-w-md">
        <DrawerHeader>
          <DrawerTitle>Episode filters</DrawerTitle>
        </DrawerHeader>
        <View style={styles.sections}>
          <ControlSection label="Show type">
            <Segmented options={showOptions} value={showFilter} onChange={onShowFilterChange} />
          </ControlSection>
          {tab === 'favorites' && (
            <>
              <MinimumRatingControl value={minimumRating} onChange={onMinimumRatingChange} />
              {tags.length > 0 && (
                <ControlSection label="Tag">
                  <View style={styles.tags}>
                    {tags.map((tag) => {
                      const key = tag.toLocaleLowerCase();
                      return (
                        <SelectableTag
                          key={tag}
                          exclusive
                          label={tag}
                          selected={tagFilter === key}
                          onPress={() => onTagFilterChange(tagFilter === key ? 'all' : key)}
                        />
                      );
                    })}
                  </View>
                </ControlSection>
              )}
            </>
          )}
          <FilterSheetFooter
            active={active}
            onClear={() => {
              onShowFilterChange('all');
              onMinimumRatingChange(0);
              onTagFilterChange('all');
            }}
          />
        </View>
      </DrawerContent>
    </Drawer>
  );
}

const styles = StyleSheet.create({
  sections: { gap: 28 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
