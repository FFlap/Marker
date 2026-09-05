import { EllipsisVertical, Globe2, LockKeyhole } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { SecondaryHeader } from '@/components/BackButton';
import { LibraryFiltersDrawer } from '@/components/LibraryFiltersDrawer';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Input } from '@/components/ui/primitives';
import { colors } from '@/constants/colors';
import type { MediaTypeFilter, StatusFilter } from '@/lib/libraryFilters';
import { tagDetailStyles as s } from '../screens/TagDetailScreen.styles';
import { VisibilityOption } from './TagScreenParts';

export function TagHeader({
  filters,
  isPublic,
  onVisibilityChange,
  setFilters,
  tag,
  visibilityPending,
}: {
  filters: {
    active: boolean;
    mediaType: MediaTypeFilter;
    minimumRating: number;
    search: string;
    status: StatusFilter;
  };
  isPublic: boolean;
  onVisibilityChange: (isPublic: boolean) => void;
  setFilters: {
    clear: () => void;
    minimumRating: (rating: number) => void;
    search: (search: string) => void;
    status: (status: StatusFilter) => void;
    type: (type: MediaTypeFilter) => void;
  };
  tag: string;
  visibilityPending: boolean;
}) {
  return (
    <>
      <SecondaryHeader
        title={tag || 'Tag'}
        backLabel="Back to tags"
        fallback="/tags"
        maxWidth={880}
        right={
          <Drawer>
            <DrawerTrigger asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Tag visibility"
                hitSlop={4}
                style={s.headerAction}
              >
                <EllipsisVertical size={20} color={colors.text} strokeWidth={1.8} />
              </Pressable>
            </DrawerTrigger>
            <DrawerContent className="max-w-md gap-6 rounded-2xl border-border bg-background p-6">
              <DrawerHeader>
                <DrawerTitle>Tag visibility</DrawerTitle>
              </DrawerHeader>
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel="Choose tag visibility"
                style={s.visibilityOptions}
              >
                <VisibilityOption
                  label="Public"
                  detail="Show this collection on your profile and in global tags."
                  selected={isPublic}
                  disabled={visibilityPending}
                  icon={<Globe2 size={19} color={colors.text} strokeWidth={1.7} />}
                  onPress={() => onVisibilityChange(true)}
                />
                <VisibilityOption
                  label="Private"
                  detail="Keep this collection visible only to you."
                  selected={!isPublic}
                  disabled={visibilityPending}
                  icon={<LockKeyhole size={19} color={colors.text} strokeWidth={1.7} />}
                  onPress={() => onVisibilityChange(false)}
                />
              </View>
            </DrawerContent>
          </Drawer>
        }
      />
      <View style={s.toolbar}>
        <Input
          accessibilityLabel={`Search titles in ${tag}`}
          testID="tag-title-search"
          value={filters.search}
          onChangeText={setFilters.search}
          placeholder={`Search ${tag}`}
          returnKeyType="search"
          compact
          style={s.searchInput}
        />
        <LibraryFiltersDrawer
          active={filters.active}
          mediaType={filters.mediaType}
          status={filters.status}
          minimumRating={filters.minimumRating}
          onMediaTypeChange={setFilters.type}
          onStatusChange={setFilters.status}
          onMinimumRatingChange={setFilters.minimumRating}
          onClear={setFilters.clear}
        />
      </View>
    </>
  );
}
