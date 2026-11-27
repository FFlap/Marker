import { router, type Href } from 'expo-router';
import Plus from 'lucide-react-native/icons/plus';
import Globe2 from 'lucide-react-native/icons/earth';
import LockKeyhole from 'lucide-react-native/icons/lock-keyhole';
import { Text, View } from 'react-native';
import { SecondaryHeader } from '@/components/BackButton';
import { LibraryFiltersDrawer } from '@/components/LibraryFiltersDrawer';
import { Drawer, DrawerContent, DrawerHeader, DrawerTrigger } from '@/components/ui/drawer';
import { IconButton, SearchField } from '@/components/ui/primitives';
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
  resultCount,
}: {
  filters: {
    mediaType: MediaTypeFilter;
    minimumRating: number;
    search: string;
    status: StatusFilter;
  };
  isPublic: boolean;
  onVisibilityChange: (isPublic: boolean) => void;
  setFilters: {
    minimumRating: (rating: number) => void;
    search: (search: string) => void;
    status: (status: StatusFilter) => void;
    type: (type: MediaTypeFilter) => void;
  };
  tag: string;
  visibilityPending: boolean;
  /** Titles the filters leave, for the sheet's "Show N titles" button. */
  resultCount?: number;
}) {
  return (
    <>
      <SecondaryHeader
        title={tag || 'Tag'}
        backLabel="Back to tags"
        fallback="/tags"
        maxWidth={880}
        right={
          <View style={s.headerActions}>
            {/* Adding sits in the header, so it never covers titles in the list. */}
            <IconButton
              icon={Plus}
              accessibilityLabel={`Add titles to ${tag}`}
              accessibilityHint="Opens your library for multi-select"
              onPress={() => router.push({ pathname: '/tags/add/[tag]', params: { tag } } as Href)}
            />
            <Drawer>
              <DrawerTrigger asChild>
                {/* Shows who can see the tag now; opens the choice. */}
                <IconButton
                  icon={isPublic ? Globe2 : LockKeyhole}
                  accessibilityLabel="Tag visibility"
                  accessibilityHint={
                    isPublic ? 'Public. Change who can see it' : 'Private. Change who can see it'
                  }
                />
              </DrawerTrigger>
              <DrawerContent className="max-w-md">
                <DrawerHeader>
                  <Text accessibilityRole="header" numberOfLines={1} style={s.sheetTitle}>
                    {`Who can see ${tag}`}
                  </Text>
                </DrawerHeader>
                <View
                  accessibilityRole="radiogroup"
                  accessibilityLabel="Choose tag visibility"
                  style={s.visibilityOptions}
                >
                  <VisibilityOption
                    label="Public"
                    detail="On your profile and in Explore"
                    selected={isPublic}
                    disabled={visibilityPending}
                    icon={<Globe2 size={19} color={colors.text} strokeWidth={1.7} />}
                    onPress={() => onVisibilityChange(true)}
                  />
                  <VisibilityOption
                    label="Private"
                    detail="Only you"
                    selected={!isPublic}
                    disabled={visibilityPending}
                    icon={<LockKeyhole size={19} color={colors.text} strokeWidth={1.7} />}
                    onPress={() => onVisibilityChange(false)}
                  />
                </View>
              </DrawerContent>
            </Drawer>
          </View>
        }
      />
      <View style={s.toolbar}>
        <SearchField
          accessibilityLabel={`Search titles in ${tag}`}
          testID="tag-title-search"
          value={filters.search}
          onChangeText={setFilters.search}
          placeholder={`Search ${tag}`}
        />
        <LibraryFiltersDrawer
          mediaType={filters.mediaType}
          status={filters.status}
          minimumRating={filters.minimumRating}
          onMediaTypeChange={setFilters.type}
          onStatusChange={setFilters.status}
          onMinimumRatingChange={setFilters.minimumRating}
          resultCount={resultCount}
        />
      </View>
    </>
  );
}
