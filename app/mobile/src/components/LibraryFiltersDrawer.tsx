import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SlidersHorizontal } from 'lucide-react-native';
import { colors } from '@/constants/colors';
import { LIBRARY_STATUSES, type MediaTypeFilter, type StatusFilter } from '@/lib/libraryFilters';
import { Chip } from '@/components/ui/primitives';
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';

type LibraryFiltersDrawerProps = {
  active: boolean;
  mediaType: MediaTypeFilter;
  status: StatusFilter;
  minimumRating: number;
  onMediaTypeChange: (value: MediaTypeFilter) => void;
  onStatusChange: (value: StatusFilter) => void;
  onMinimumRatingChange: (value: number) => void;
  onClear: () => void;
};

export function LibraryFiltersDrawer({
  active,
  mediaType,
  status,
  minimumRating,
  onMediaTypeChange,
  onStatusChange,
  onMinimumRatingChange,
  onClear,
}: LibraryFiltersDrawerProps) {
  return (
    <Drawer>
      <DrawerTrigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Filter tag titles"
          accessibilityState={{ selected: active }}
          hitSlop={4}
          style={[styles.trigger, active && styles.triggerActive]}
        >
          <SlidersHorizontal size={18} color={colors.text} strokeWidth={1.7} />
          {active && <View style={styles.activeDot} />}
        </Pressable>
      </DrawerTrigger>
      <DrawerContent className="max-w-md gap-6 rounded-2xl border-border bg-background p-6">
        <DrawerHeader>
          <DrawerTitle>Filters</DrawerTitle>
        </DrawerHeader>
        <FilterGroup label="Type">
          {(
            [
              ['all', 'All'],
              ['movie', 'Movies'],
              ['tv', 'TV Shows'],
              ['anime', 'Anime'],
            ] as const
          ).map(([value, label]) => (
            <Chip
              key={value}
              label={label}
              accessibilityLabel={`${label} type`}
              selected={mediaType === value}
              onPress={() => onMediaTypeChange(value)}
            />
          ))}
        </FilterGroup>
        <FilterGroup label="Status">
          <Chip
            label="All"
            accessibilityLabel="All statuses"
            selected={status === 'all'}
            onPress={() => onStatusChange('all')}
          />
          {LIBRARY_STATUSES.map(([value, label]) => (
            <Chip
              key={value}
              label={label}
              accessibilityLabel={`${label} status`}
              selected={status === value}
              onPress={() => onStatusChange(value)}
            />
          ))}
        </FilterGroup>
        <FilterGroup label="Minimum Rating">
          {[0, 9, 8, 7, 6].map((rating) => (
            <Chip
              key={rating}
              label={rating ? `${rating}+` : 'Any'}
              accessibilityLabel={rating ? `${rating}+ rating` : 'Any rating'}
              selected={minimumRating === rating}
              onPress={() => onMinimumRatingChange(rating)}
            />
          ))}
        </FilterGroup>
        <DrawerFooter>{active && <Chip label="Clear filters" onPress={onClear} />}</DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.options}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 36,
    height: 36,
    flexShrink: 0,
    borderRadius: 18,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  triggerActive: {},
  activeDot: {
    position: 'absolute',
    right: 5,
    top: 5,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.text,
  },
  group: { gap: 10 },
  label: { color: colors.muted, fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
