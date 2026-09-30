import { StyleSheet, View } from 'react-native';
import { FilterSheetFooter, FilterTrigger } from '@/components/FilterSheetParts';
import { LIBRARY_STATUSES, type MediaTypeFilter, type StatusFilter } from '@/lib/libraryFilters';
import { Segmented } from '@/components/ui/primitives';
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

const typeOptions = [
  { value: 'all', label: 'All', accessibilityLabel: 'All types' },
  { value: 'movie', label: 'Movies', accessibilityLabel: 'Movies type' },
  { value: 'tv', label: 'TV Shows', accessibilityLabel: 'TV Shows type' },
  { value: 'anime', label: 'Anime', accessibilityLabel: 'Anime type' },
] as const satisfies readonly {
  value: MediaTypeFilter;
  label: string;
  accessibilityLabel: string;
}[];

const statusOptions = [
  { value: 'all', label: 'All', accessibilityLabel: 'All statuses' },
  ...LIBRARY_STATUSES.map(([value, label]) => ({
    value,
    label,
    accessibilityLabel: `${label} status`,
  })),
] satisfies { value: StatusFilter; label: string; accessibilityLabel: string }[];

type LibraryFiltersDrawerProps = {
  accessibilityLabel?: string;
  active: boolean;
  mediaType: MediaTypeFilter;
  status: StatusFilter;
  minimumRating: number;
  onMediaTypeChange: (value: MediaTypeFilter) => void;
  onStatusChange: (value: StatusFilter) => void;
  onMinimumRatingChange: (value: number) => void;
  onClear: () => void;
  /** Tag filtering is offered only where titles can carry several tags. */
  tags?: {
    all: string[];
    selected: string[];
    onChange: (tags: string[]) => void;
  };
};

export function LibraryFiltersDrawer({
  accessibilityLabel = 'Filter tag titles',
  active,
  mediaType,
  status,
  minimumRating,
  onMediaTypeChange,
  onStatusChange,
  onMinimumRatingChange,
  onClear,
  tags,
}: LibraryFiltersDrawerProps) {
  const selectedTags = new Set(tags?.selected);

  return (
    <Drawer>
      <DrawerTrigger asChild>
        <FilterTrigger accessibilityLabel={accessibilityLabel} active={active} />
      </DrawerTrigger>
      <DrawerContent className="max-w-md">
        <DrawerHeader>
          <DrawerTitle>Filters</DrawerTitle>
        </DrawerHeader>
        <View style={styles.sections}>
          <ControlSection label="Type">
            <Segmented options={typeOptions} value={mediaType} onChange={onMediaTypeChange} />
          </ControlSection>
          <ControlSection label="Status">
            <Segmented options={statusOptions} value={status} onChange={onStatusChange} />
          </ControlSection>
          <MinimumRatingControl value={minimumRating} onChange={onMinimumRatingChange} />
          {tags && tags.all.length > 0 && (
            <ControlSection label="Tags">
              <View style={styles.tags}>
                {tags.all.map((tag) => (
                  <SelectableTag
                    key={tag}
                    label={tag}
                    selected={selectedTags.has(tag)}
                    onPress={() =>
                      tags.onChange(
                        selectedTags.has(tag)
                          ? tags.selected.filter((value) => value !== tag)
                          : [...tags.selected, tag],
                      )
                    }
                  />
                ))}
              </View>
            </ControlSection>
          )}
          <FilterSheetFooter active={active} onClear={onClear} />
        </View>
      </DrawerContent>
    </Drawer>
  );
}

const styles = StyleSheet.create({
  sections: { gap: 28 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
