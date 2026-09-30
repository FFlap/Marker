import type { AppDrawerHandle } from '@/components/AppDrawer';
import { LibraryFiltersDrawer } from '@/components/LibraryFiltersDrawer';
import { TabHeader } from '@/components/TabHeader';
import type { MediaTypeFilter, StatusFilter } from '@/lib/libraryFilters';

type LibraryFilters = {
  active: boolean;
  allTags: string[];
  minimumRating: number;
  search: string;
  selectedTags: string[];
  status: StatusFilter;
  type: MediaTypeFilter;
};

type FilterActions = {
  clear: () => void;
  setMinimumRating: (rating: number) => void;
  setSearch: (search: string) => void;
  setSelectedTags: (tags: string[]) => void;
  setStatus: (status: StatusFilter) => void;
  setType: (type: MediaTypeFilter) => void;
};

export function LibraryToolbar({
  filters,
  onDrawerChange,
  setFilters,
}: {
  filters: LibraryFilters;
  onDrawerChange: (drawer: AppDrawerHandle | null) => void;
  setFilters: FilterActions;
}) {
  return (
    <TabHeader
      ref={onDrawerChange}
      accessibilityLabel="Search library"
      testID="library-search"
      value={filters.search}
      onChangeText={setFilters.setSearch}
      placeholder="Search Library"
      returnKeyType="search"
      maxWidth={880}
      trailing={
        <LibraryFiltersDrawer
          accessibilityLabel="Filter library"
          active={filters.active}
          mediaType={filters.type}
          status={filters.status}
          minimumRating={filters.minimumRating}
          onMediaTypeChange={setFilters.setType}
          onStatusChange={setFilters.setStatus}
          onMinimumRatingChange={setFilters.setMinimumRating}
          onClear={setFilters.clear}
          tags={{
            all: filters.allTags,
            selected: filters.selectedTags,
            onChange: setFilters.setSelectedTags,
          }}
        />
      }
    />
  );
}
