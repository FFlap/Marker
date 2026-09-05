import type { ReactNode } from 'react';
import { SlidersHorizontal } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';
import type { AppDrawerHandle } from '@/components/AppDrawer';
import { TabHeader } from '@/components/TabHeader';
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Chip } from '@/components/ui/primitives';
import { colors } from '@/constants/colors';
import { LIBRARY_STATUSES, type MediaTypeFilter, type StatusFilter } from '@/lib/libraryFilters';
import { createAppStyles } from '@/lib/typography';

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
  const selectedTags = new Set(filters.selectedTags);

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
        <View style={s.actions}>
          <Drawer>
            <DrawerTrigger asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Filter library"
                style={s.icon}
              >
                <SlidersHorizontal size={18} color={colors.text} strokeWidth={1.7} />
                {filters.active && <View style={s.activeDot} />}
              </Pressable>
            </DrawerTrigger>
            <DrawerContent className="max-w-md gap-6 rounded-2xl border-border bg-background p-6">
              <DrawerHeader>
                <DrawerTitle>Filters</DrawerTitle>
              </DrawerHeader>
              <FilterGroup label="Type">
                {(['all', 'movie', 'tv', 'anime'] as const).map((type) => (
                  <Chip
                    key={type}
                    label={{ all: 'All', movie: 'Movies', tv: 'TV Shows', anime: 'Anime' }[type]}
                    accessibilityLabel={
                      {
                        all: 'All types',
                        movie: 'Movies type',
                        tv: 'TV Shows type',
                        anime: 'Anime type',
                      }[type]
                    }
                    selected={filters.type === type}
                    onPress={() => setFilters.setType(type)}
                  />
                ))}
              </FilterGroup>
              <FilterGroup label="Status">
                <Chip
                  label="All"
                  accessibilityLabel="All statuses"
                  selected={filters.status === 'all'}
                  onPress={() => setFilters.setStatus('all')}
                />
                {LIBRARY_STATUSES.map(([status, label]) => (
                  <Chip
                    key={status}
                    label={label}
                    accessibilityLabel={`${label} status`}
                    selected={filters.status === status}
                    onPress={() => setFilters.setStatus(status)}
                  />
                ))}
              </FilterGroup>
              <FilterGroup label="Minimum Rating">
                {[0, 9, 8, 7, 6].map((rating) => (
                  <Chip
                    key={rating}
                    label={rating ? `${rating}+` : 'Any'}
                    accessibilityLabel={rating ? `${rating}+ rating` : 'Any rating'}
                    selected={filters.minimumRating === rating}
                    onPress={() => setFilters.setMinimumRating(rating)}
                  />
                ))}
              </FilterGroup>
              {filters.allTags.length > 0 && (
                <FilterGroup label="Tags">
                  {filters.allTags.map((tag) => (
                    <Chip
                      key={tag}
                      label={tag}
                      selected={selectedTags.has(tag)}
                      onPress={() =>
                        setFilters.setSelectedTags(
                          selectedTags.has(tag)
                            ? filters.selectedTags.filter((value) => value !== tag)
                            : [...filters.selectedTags, tag],
                        )
                      }
                    />
                  ))}
                </FilterGroup>
              )}
              <DrawerFooter>
                {filters.active && <Chip label="Clear filters" onPress={setFilters.clear} />}
              </DrawerFooter>
            </DrawerContent>
          </Drawer>
        </View>
      }
    />
  );
}

function FilterGroup({ children, label }: { children: ReactNode; label: string }) {
  return (
    <View style={s.filterGroup}>
      <Text style={s.filterLabel}>{label}</Text>
      <View style={s.filterWrap}>{children}</View>
    </View>
  );
}

const s = createAppStyles(
  {
    actions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    icon: {
      width: 44,
      height: 44,
      flexShrink: 0,
      borderRadius: 18,
      backgroundColor: 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    activeDot: {
      position: 'absolute',
      right: 5,
      top: 5,
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.text,
    },
    filterGroup: { gap: 10 },
    filterLabel: { color: colors.muted, fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },
    filterWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  },
  ['filterLabel'] as const,
);
