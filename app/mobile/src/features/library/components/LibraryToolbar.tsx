import { router } from 'expo-router';
import Plus from 'lucide-react-native/icons/plus';
import { View } from 'react-native';
import type { AppDrawerHandle } from '@/components/AppDrawer';
import { IconButton } from '@/components/ui/primitives';
import { LibraryFiltersDrawer } from '@/components/LibraryFiltersDrawer';
import { TabHeader } from '@/components/TabHeader';
import type { LibrarySort, MediaTypeFilter, StatusFilter } from '@/lib/libraryFilters';

type LibraryFilters = {
  active: boolean;
  allTags: string[];
  minimumRating: number;
  search: string;
  selectedTags: string[];
  sort: LibrarySort;
  status: StatusFilter;
  type: MediaTypeFilter;
};

type FilterActions = {
  clear: () => void;
  setMinimumRating: (rating: number) => void;
  setSearch: (search: string) => void;
  setSelectedTags: (tags: string[]) => void;
  setSort: (sort: LibrarySort) => void;
  setStatus: (status: StatusFilter) => void;
  setType: (type: MediaTypeFilter) => void;
};

export function LibraryToolbar({
  filters,
  onDrawerChange,
  setFilters,
  resultCount,
  addDisabled = false,
}: {
  filters: LibraryFilters;
  onDrawerChange: (drawer: AppDrawerHandle | null) => void;
  setFilters: FilterActions;
  resultCount?: number;
  /** While the library is still loading, adding waits. */
  addDisabled?: boolean;
}) {
  return (
    <TabHeader
      ref={onDrawerChange}
      accessibilityLabel="Search library"
      testID="library-search"
      value={filters.search}
      onChangeText={setFilters.setSearch}
      placeholder="Search library"
      returnKeyType="search"
      maxWidth={880}
      trailing={
        // Add lives in the toolbar, so it never covers titles in the list.
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <IconButton
            icon={Plus}
            accessibilityLabel="Add title"
            accessibilityHint="Opens title search"
            disabled={addDisabled}
            onPress={() => router.push('/add')}
          />
          <LibraryFiltersDrawer
            accessibilityLabel="Filter library"
            mediaType={filters.type}
            status={filters.status}
            minimumRating={filters.minimumRating}
            onMediaTypeChange={setFilters.setType}
            onStatusChange={setFilters.setStatus}
            onMinimumRatingChange={setFilters.setMinimumRating}
            sort={{ value: filters.sort, onChange: setFilters.setSort }}
            resultCount={resultCount}
            tags={{
              all: filters.allTags,
              selected: filters.selectedTags,
              onChange: setFilters.setSelectedTags,
            }}
          />
        </View>
      }
    />
  );
}
