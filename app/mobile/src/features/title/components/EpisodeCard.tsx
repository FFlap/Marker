import { Image } from 'expo-image';
import Check from 'lucide-react-native/icons/check';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import { Pressable, Text, View } from 'react-native';
import { colors } from '@/constants/colors';
import { NativePressable } from '@/components/ui/NativePressable';
import type { Episode, EpisodeDraft } from '../libraryItemTypes';
import { libraryItemScreenStyles as s } from '../screens/LibraryItemScreen.styles';
import { EpisodeEditSheet } from './EpisodeEditSheet';
import { displayEpisodeName } from '@/lib/text';

type SavedEpisode = { watched: boolean; rating?: number; tags: string[] } | undefined;

/**
 * The check toggles watched; the rest of the row opens the episode editor, which also
 * holds the full synopsis.
 */
export function EpisodeCard({
  draft,
  editing,
  episode,
  pending,
  saved,
  onEditingChange,
  onPatch,
  onToggle,
  tagSuggestions,
  editable = true,
}: {
  draft: EpisodeDraft;
  editing: boolean;
  episode: Episode;
  pending: boolean;
  saved: SavedEpisode;
  onEditingChange: (editing: boolean) => void;
  onPatch: (field: keyof EpisodeDraft, value: number | undefined | string[]) => void;
  onToggle: () => void;
  tagSuggestions?: string[];
  /** The saved episode has loaded, so its sheet can edit it. */
  editable?: boolean;
}) {
  const episodeNumber = episode.episode.toString().padStart(2, '0');
  const watched = !!saved?.watched;
  return (
    <View style={s.episode}>
      <View style={s.epRow}>
        <NativePressable
          accessibilityRole="button"
          accessibilityLabel={`Episode ${episode.episode}, ${displayEpisodeName(episode.name)}, options`}
          accessibilityHint="Shows the synopsis, rating, tags and watch count"
          accessibilityState={{ disabled: !editable }}
          disabled={!editable}
          style={s.epOpen}
          pressedStyle={s.epOpenPressed}
          onPress={() => onEditingChange(true)}
        >
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
          <View style={s.epExpand}>
            <View style={s.epHeader}>
              <Text numberOfLines={1} style={s.epMeta}>
                <Text style={s.epNo}>E{episode.episode}</Text>
                {!!episode.runtime && ` · ${episode.runtime} min`}
                {watched && draft.timesWatched > 1 && (
                  <Text style={s.epTimes}> · Watched {draft.timesWatched}×</Text>
                )}
              </Text>
            </View>
            {/* The synopsis lives in the episode sheet so the title keeps its room. */}
            <Text numberOfLines={3} style={s.epName}>
              {displayEpisodeName(episode.name)}
            </Text>
          </View>
          {/* The row opens the episode's details; the circle only ticks it. */}
          <ChevronRight size={16} color={colors.muted} strokeWidth={2} />
        </NativePressable>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={
            watched
              ? `Mark episode ${episode.episode} unwatched`
              : `Mark episode ${episode.episode} watched`
          }
          accessibilityState={{ checked: watched, disabled: pending }}
          disabled={pending}
          hitSlop={10}
          onPress={onToggle}
          style={[s.check, watched && s.checkOn]}
        >
          {watched && <Check size={16} color={colors.bg} strokeWidth={2.6} />}
        </Pressable>
      </View>
      <EpisodeEditSheet
        open={editing}
        onOpenChange={onEditingChange}
        episode={episode}
        watched={watched}
        pending={pending}
        draft={draft}
        onToggleWatched={onToggle}
        onRatingChange={(value) => onPatch('rating', value)}
        onTagsChange={(value) => onPatch('tags', value)}
        onTimesWatchedChange={(value) => onPatch('timesWatched', value)}
        tagSuggestions={tagSuggestions}
      />
    </View>
  );
}
