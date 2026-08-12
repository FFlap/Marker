import { Text, View } from 'react-native';
import { Tags as TagsIcon } from 'lucide-react-native';
import { PosterImage } from '@/components/ui/PosterImage';
import { NativePressable } from '@/components/ui/NativePressable';
import { colors } from '@/constants/colors';
import { createStyles } from '@/lib/typography';

export type TagGalleryEntry = {
  key: string;
  label: string;
  posters: {
    key: string;
    title: string;
    posterPath?: string;
  }[];
};

export function TagGallery({
  entries,
  onPress,
}: {
  entries: TagGalleryEntry[];
  onPress: (entry: TagGalleryEntry) => void;
}) {
  return (
    <View style={s.gallery}>
      {entries.map((entry) => (
        <NativePressable
          key={entry.key}
          accessibilityRole="button"
          accessibilityLabel={`Open ${entry.label} tag`}
          onPress={() => onPress(entry)}
          style={s.card}
          pressedStyle={s.pressed}
        >
          <View style={s.posterStage}>
            {entry.posters.length ? (
              <View style={s.posterStack}>
                {entry.posters.slice(0, 3).map((poster, index) => (
                  <View
                    key={poster.key}
                    style={[s.posterLayer, index > 0 && s.posterOverlap, { zIndex: index + 1 }]}
                  >
                    <PosterImage path={poster.posterPath} title={poster.title} style={s.poster} />
                  </View>
                ))}
              </View>
            ) : (
              <View style={s.fallback}>
                <TagsIcon size={30} color={colors.muted} strokeWidth={1.4} />
              </View>
            )}
          </View>
          <Text numberOfLines={1} style={s.tagName}>
            {entry.label}
          </Text>
        </NativePressable>
      ))}
    </View>
  );
}

const s = createStyles({
  gallery: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: '4%',
    rowGap: 30,
    paddingTop: 18,
  },
  card: {
    width: '48%',
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  pressed: { opacity: 0.76, transform: [{ scale: 0.992 }] },
  posterStage: {
    width: '100%',
    height: 198,
    alignItems: 'flex-end',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  posterStack: {
    width: '100%',
    maxWidth: 220,
    height: 198,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  posterLayer: {
    width: '60%',
    maxWidth: 132,
    aspectRatio: 2 / 3,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: colors.bg,
    shadowColor: '#000',
    shadowOpacity: 0.42,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 7 },
  },
  posterOverlap: { marginLeft: '-40%' },
  poster: { width: '100%', height: '100%' },
  fallback: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.elevated,
  },
  tagName: {
    width: '100%',
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 3,
  },
});
