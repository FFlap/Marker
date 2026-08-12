import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { MobileNav } from '@/components/MobileNav';
import { SkeletonShimmer } from '@/components/SkeletonShimmer';
import { TagGallery } from '@/components/TagGallery';
import { EmptyState } from '@/components/ui/primitives';
import { colors } from '@/constants/colors';
import { createStyles } from '@/lib/typography';
import { TabHeader } from '@/components/TabHeader';

type TagPreview = {
  tag: string;
  count: number;
  posters: {
    itemId: string;
    title: string;
    posterPath?: string;
  }[];
};

export default function TagsScreen() {
  const collections = useQuery(api.tags.mine);
  const [search, setSearch] = useState('');
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return query
      ? (collections ?? []).filter((group) => group.tag.toLocaleLowerCase().includes(query))
      : (collections ?? []);
  }, [collections, search]);

  return (
    <View style={s.root}>
      <View style={s.toolbar}>
        <TabHeader
          current="tags"
          maxWidth={760}
          accessibilityLabel="Search your tags"
          testID="tag-search"
          value={search}
          onChangeText={setSearch}
          placeholder="Search your tags"
          returnKeyType="search"
        />
      </View>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {collections === undefined ? (
          <TagSkeletons />
        ) : visible.length ? (
          <TagGallery
            entries={(visible as TagPreview[]).map((group) => ({
              key: group.tag.toLocaleLowerCase(),
              label: group.tag,
              posters: group.posters.map((item) => ({
                key: String(item.itemId),
                title: item.title,
                posterPath: item.posterPath,
              })),
            }))}
            onPress={(group) =>
              router.push({
                pathname: '/tags/[tag]',
                params: { tag: group.label },
              })
            }
          />
        ) : (
          <EmptyState
            title={collections.length ? 'No matching tags' : 'No tags yet'}
            detail={
              collections.length
                ? 'Try a different search.'
                : 'Add tags to titles and they’ll become visual collections here.'
            }
          />
        )}
      </ScrollView>
      <MobileNav current="tags" />
    </View>
  );
}

function TagSkeletons() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading tags" style={s.cards}>
      {[0, 1, 2].map((index) => (
        <View key={index} style={s.card}>
          <View style={s.skeletonPosters}>
            <SkeletonShimmer />
          </View>
          <View style={s.skeletonTitle}>
            <SkeletonShimmer />
          </View>
        </View>
      ))}
    </View>
  );
}

const s = createStyles({
  root: { flex: 1, backgroundColor: colors.bg },
  toolbar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    backgroundColor: colors.bg,
  },
  content: {
    width: '100%',
    maxWidth: 760,
    minHeight: '100%',
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 76,
    paddingBottom: 128,
  },
  cards: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: '4%',
    rowGap: 24,
  },
  card: {
    width: '48%',
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingVertical: 4,
  },
  skeletonPosters: {
    position: 'relative',
    overflow: 'hidden',
    width: 68,
    height: 102,
    borderRadius: 10,
    backgroundColor: colors.elevated,
  },
  skeletonTitle: {
    position: 'relative',
    overflow: 'hidden',
    width: 82,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.elevated,
    marginTop: 10,
  },
});
