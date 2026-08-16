import { Image } from 'expo-image';
import { EllipsisVertical } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';
import { RatingControl, TagEditor } from '@/components/ui/library-controls';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { colors } from '@/constants/colors';
import type { Episode, EpisodeDraft } from '../libraryItemTypes';
import { libraryItemScreenStyles as s } from '../screens/LibraryItemScreen.styles';

type SavedEpisode = { watched: boolean; rating?: number; tags: string[] } | undefined;

export function EpisodeCard({
  draft,
  editing,
  episode,
  expanded,
  pending,
  saved,
  onEditingChange,
  onExpand,
  onPatch,
  onToggle,
}: {
  draft: EpisodeDraft;
  editing: boolean;
  episode: Episode;
  expanded: boolean;
  pending: boolean;
  saved: SavedEpisode;
  onEditingChange: (editing: boolean) => void;
  onExpand: () => void;
  onPatch: (field: keyof EpisodeDraft, value: number | undefined | string[]) => void;
  onToggle: () => void;
}) {
  const episodeNumber = episode.episode.toString().padStart(2, '0');
  return (
    <View style={s.episode}>
      <View style={s.epRow}>
        <View style={s.episodeArtwork}>
          {episode.imageUrl ? (
            <Image
              source={episode.imageUrl}
              accessibilityLabel={`Episode ${episode.episode} artwork`}
              contentFit="cover"
              transition={150}
              recyclingKey={`${episode.season}:${episode.episode}`}
              style={s.episodeImage}
            />
          ) : (
            <View style={s.episodeImageFallback}>
              <Text style={s.episodeImageNumber}>{episodeNumber}</Text>
            </View>
          )}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View episode ${episode.episode}`}
          style={s.epExpand}
          onPress={onExpand}
        >
          <View style={s.epHeader}>
            <Text style={s.epNo}>EP {episodeNumber}</Text>
            {!!episode.runtime && <Text style={s.epTime}>{episode.runtime} min</Text>}
          </View>
          <Text numberOfLines={2} style={s.epName}>
            {episode.name}
          </Text>
          {!!episode.overview && !expanded && (
            <Text numberOfLines={2} style={s.epOverview}>
              {episode.overview}
            </Text>
          )}
        </Pressable>
        <View style={s.epActions}>
          <Pressable
            accessibilityRole={saved?.watched ? 'button' : 'checkbox'}
            accessibilityLabel={
              saved?.watched
                ? `Episode ${episode.episode} options`
                : `Mark episode ${episode.episode} watched`
            }
            accessibilityHint={
              saved?.watched ? undefined : 'Opens episode options after marking it watched'
            }
            accessibilityState={
              saved?.watched ? { disabled: pending } : { checked: false, disabled: pending }
            }
            disabled={pending}
            hitSlop={8}
            onPress={() => {
              onEditingChange(true);
              if (!saved?.watched) onToggle();
            }}
            style={saved?.watched ? s.episodeOptionsButton : s.check}
          >
            {saved?.watched ? (
              <EllipsisVertical size={14} color={colors.muted} strokeWidth={1.8} />
            ) : (
              <Text style={{ color: colors.muted }}>✓</Text>
            )}
          </Pressable>
        </View>
      </View>
      {expanded && (
        <View style={s.epDetails}>
          {!!episode.overview && <Text style={s.epFullOverview}>{episode.overview}</Text>}
          {!!episode.airDate && <Text style={s.epFact}>Aired {episode.airDate}</Text>}
        </View>
      )}
      <Drawer open={editing} onOpenChange={onEditingChange}>
        {editing && (
          <DrawerContent className="max-w-lg gap-6 rounded-2xl border-border bg-background p-6">
            <DrawerHeader>
              <DrawerTitle>Edit episode {episode.episode}</DrawerTitle>
            </DrawerHeader>
            <View style={s.episodeEditorContent}>
              <RatingControl value={draft.rating} onChange={(value) => onPatch('rating', value)} />
              <TagEditor tags={draft.tags} onChange={(value) => onPatch('tags', value)} />
              <Pressable
                accessibilityRole="button"
                disabled={pending}
                onPress={onToggle}
                style={s.drawerTextAction}
              >
                <Text style={[s.drawerTextActionLabel, pending && s.drawerTextActionDisabled]}>
                  {saved?.watched ? 'Mark episode unwatched' : 'Mark episode watched'}
                </Text>
              </Pressable>
            </View>
          </DrawerContent>
        )}
      </Drawer>
    </View>
  );
}
