import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { TagGallery } from '@/components/TagGallery';
import { colors } from '@/constants/colors';
import { createStyles } from '@/lib/typography';

export type PublicTagPreview = {
  tag: string;
  count: number;
  posters: { title: string; posterPath?: string }[];
};

export function PublicTagsSection({
  tags,
  username,
}: {
  tags: PublicTagPreview[];
  username: string;
}) {
  if (!tags.length) return null;
  return (
    <View style={s.section}>
      <View style={s.sectionHead}>
        <Text style={s.sectionTitle}>Public Tags</Text>
      </View>
      <TagGallery
        entries={tags.map((tag) => ({
          key: tag.tag.toLocaleLowerCase(),
          label: tag.tag,
          posters: tag.posters.map((poster, index) => ({
            key: `${poster.title}-${index}`,
            title: poster.title,
            posterPath: poster.posterPath,
          })),
        }))}
        onPress={(tag) =>
          router.push({
            pathname: '/u/[username]/tags/[tag]',
            params: { username, tag: tag.label },
          })
        }
      />
    </View>
  );
}

const s = createStyles({
  section: { marginTop: 34 },
  sectionHead: {
    paddingBottom: 11,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: { color: colors.muted, fontSize: 12, fontWeight: '600' },
});
