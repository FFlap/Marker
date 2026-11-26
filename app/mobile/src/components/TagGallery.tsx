import { Text, View } from 'react-native';
import TagsIcon from 'lucide-react-native/icons/tags';
import { PosterImage } from '@/components/ui/PosterImage';
import { NativePressable } from '@/components/ui/NativePressable';
import { colors } from '@/constants/colors';
import { radius, typeRamp } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';

export type TagGalleryEntry = {
  key: string;
  label: string;
  /** Titles in the tag; shown under the name when known. */
  count?: number;
  posters: {
    key: string;
    title: string;
    posterPath?: string;
  }[];
};

/** Back posters fan out behind the first one. */
const FAN = [
  { style: 'front', rotate: '0deg' },
  { style: 'right', rotate: '7deg' },
  { style: 'left', rotate: '-7deg' },
] as const;

export function TagGallery({
  entries,
  onPress,
}: {
  entries: TagGalleryEntry[];
  onPress: (entry: TagGalleryEntry) => void;
}) {
  return (
    <View style={s.gallery}>
      {entries.map((entry) => {
        const posters = entry.posters.slice(0, 3);
        return (
          <NativePressable
            key={entry.key}
            accessibilityRole="button"
            accessibilityLabel={`Open ${entry.label} tag${
              entry.count !== undefined
                ? `, ${entry.count} ${entry.count === 1 ? 'title' : 'titles'}`
                : ''
            }`}
            onPress={() => onPress(entry)}
            style={s.card}
            pressedStyle={s.pressed}
          >
            <View style={s.stage}>
              {posters.length ? (
                // Draw the back posters first so the first poster sits on top.
                posters
                  .map((poster, index) => ({ poster, fan: FAN[index]! }))
                  .reverse()
                  .map(({ poster, fan }) => (
                    <View
                      key={poster.key}
                      style={[
                        s.poster,
                        fan.style === 'front' ? s.front : fan.style === 'right' ? s.right : s.left,
                        { transform: [{ rotate: fan.rotate }] },
                      ]}
                    >
                      <PosterImage
                        path={poster.posterPath}
                        title={poster.title}
                        style={s.posterImage}
                      />
                      {fan.style !== 'front' && <View style={s.dim} />}
                    </View>
                  ))
              ) : (
                <View style={s.fallback}>
                  <TagsIcon size={26} color={colors.muted} strokeWidth={1.5} />
                </View>
              )}
            </View>
            <View style={s.copy}>
              <Text numberOfLines={1} style={s.tagName}>
                {entry.label}
              </Text>
              {entry.count !== undefined && (
                <Text style={s.count}>
                  {entry.count} {entry.count === 1 ? 'title' : 'titles'}
                </Text>
              )}
            </View>
          </NativePressable>
        );
      })}
    </View>
  );
}

const s = createAppStyles(
  {
    gallery: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: '4%',
      rowGap: 14,
      paddingTop: 16,
    },
    card: {
      width: '48%',
      minWidth: 0,
      padding: 12,
      gap: 12,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
    },
    pressed: { backgroundColor: colors.elevated },
    stage: {
      height: 148,
      alignItems: 'center',
      justifyContent: 'flex-end',
    },
    poster: {
      position: 'absolute',
      bottom: 4,
      width: '50%',
      aspectRatio: 2 / 3,
      borderRadius: radius.sm,
      overflow: 'hidden',
      backgroundColor: colors.elevated,
    },
    front: { zIndex: 3 },
    right: { right: '6%', bottom: 10 },
    left: { left: '6%', bottom: 10 },
    // A cover still loading reads as a poster-shaped tile, not as part of the card.
    posterImage: { width: '100%', height: '100%', backgroundColor: colors.elevated },
    dim: { position: 'absolute', inset: 0, backgroundColor: 'rgba(10,10,11,0.35)' },
    fallback: {
      width: 64,
      height: 64,
      marginBottom: 40,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.elevated,
    },
    copy: { gap: 2, paddingHorizontal: 2 },
    tagName: { ...typeRamp.rowTitle, fontWeight: '600' },
    count: { ...typeRamp.meta },
  },
  ['tagName', 'count'] as const,
);
