import { View } from 'react-native';
import { SectionHeading } from '@/components/ui/primitives';
import { router } from 'expo-router';
import { TagGallery } from '@/components/TagGallery';
import { createAppStyles } from '@/lib/typography';

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
      <SectionHeading title="Public tags" count={tags.length} />
      <TagGallery
        entries={tags.map((tag) => ({
          key: tag.tag.toLocaleLowerCase(),
          label: tag.tag,
          count: tag.count,
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

const s = createAppStyles(
  {
    section: { gap: 12 },
  },
  [] as const,
);
