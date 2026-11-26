import Eye from 'lucide-react-native/icons/eye';
import Hash from 'lucide-react-native/icons/hash';
import { Image } from 'expo-image';
import { Text, View } from 'react-native';
import { useRef } from 'react';
import {
  RatingControl,
  Stepper,
  TagEditor,
  withPendingTag,
} from '@/components/ui/library-controls';
import { Drawer, DrawerClose, DrawerContent } from '@/components/ui/drawer';
import { Button, SwitchRow } from '@/components/ui/primitives';
import { colors } from '@/constants/colors';
import { ExpandableOverview } from '@/components/ExpandableOverview';
import { radius, typeRamp } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';
import { formatActivityDate } from '@marker/shared/watchActivityStats';
import { clipSynopsis, displayEpisodeName } from '@/lib/text';
import { SettingIcon } from '@/components/settings/SettingIcon';
import { useLocalToday } from '@/hooks/use-local-today';

export type EditableEpisode = {
  episode: number;
  season: number;
  name?: string;
  overview?: string;
  runtime?: number;
  imageUrl?: string;
  airDate?: string;
  /** Series title, shown when the sheet opens outside the series page. */
  showTitle?: string;
};

export type EpisodeEditDraft = { rating?: number; tags: string[]; timesWatched: number };

/** One editor for an episode, used from the series page and from the Episodes tab. */
export function EpisodeEditSheet({
  open,
  onOpenChange,
  episode,
  watched,
  pending,
  draft,
  tagSuggestions,
  onToggleWatched,
  onRatingChange,
  onTagsChange,
  onTimesWatchedChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  episode: EditableEpisode;
  watched: boolean;
  pending: boolean;
  draft: EpisodeEditDraft;
  tagSuggestions?: string[];
  onToggleWatched: () => void;
  onRatingChange: (rating: number | undefined) => void;
  onTagsChange: (tags: string[]) => void;
  onTimesWatchedChange: (times: number) => void;
}) {
  // Text still typed in the tag field, kept as a tag when the sheet closes.
  const pendingTag = useRef('');
  const today = useLocalToday();
  const number = episode.episode.toString().padStart(2, '0');
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        // A tag still typed in the field is kept when the sheet closes.
        if (!next) {
          const tags = withPendingTag(draft.tags, pendingTag.current, tagSuggestions ?? []);
          if (tags !== draft.tags) onTagsChange(tags);
          pendingTag.current = '';
        }
        onOpenChange(next);
      }}
    >
      {
        <DrawerContent className="max-w-lg">
          <View style={s.hero}>
            <View style={s.artwork}>
              {episode.imageUrl ? (
                <Image
                  source={episode.imageUrl}
                  accessibilityLabel={`Episode ${episode.episode} artwork`}
                  contentFit="cover"
                  transition={150}
                  style={s.image}
                />
              ) : (
                <Text style={s.fallbackNumber}>{number}</Text>
              )}
            </View>
            <View style={s.heroCopy}>
              <Text numberOfLines={1} style={s.kicker}>
                {/* "S1 E2" names an episode the same way everywhere outside its season. */}
                {[
                  episode.showTitle,
                  `S${episode.season} E${episode.episode}`,
                  episode.runtime ? `${episode.runtime} min` : undefined,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              <Text accessibilityRole="header" style={s.title}>
                {episode.name ? displayEpisodeName(episode.name) : `Episode ${episode.episode}`}
              </Text>
            </View>
          </View>
          {(!!episode.overview || !!episode.airDate) && (
            <View style={s.about}>
              {!!episode.overview && (
                // Three lines keep the controls in view; "Read more" opens the rest.
                <ExpandableOverview text={clipSynopsis(episode.overview)} style={s.overview} />
              )}
              {!!episode.airDate && (
                <Text style={s.fact}>
                  {/^\d{4}-\d{2}-\d{2}$/.test(episode.airDate) && episode.airDate > today
                    ? 'Airs'
                    : 'Aired'}{' '}
                  {/^\d{4}-\d{2}-\d{2}$/.test(episode.airDate)
                    ? formatActivityDate(episode.airDate)
                    : episode.airDate}
                </Text>
              )}
            </View>
          )}
          <View style={s.content}>
            <View style={s.group}>
              <SwitchRow
                label="Watched"
                value={watched}
                disabled={pending}
                onChange={onToggleWatched}
                icon={
                  <SettingIcon>
                    <Eye size={17} color={colors.text} strokeWidth={1.8} />
                  </SettingIcon>
                }
              />
              {watched && (
                <>
                  <View style={s.divider} />
                  <View style={s.stepper}>
                    <Stepper
                      label="Times watched"
                      value={draft.timesWatched}
                      min={1}
                      max={999}
                      onChange={onTimesWatchedChange}
                      icon={
                        <SettingIcon>
                          <Hash size={17} color={colors.text} strokeWidth={1.8} />
                        </SettingIcon>
                      }
                    />
                  </View>
                </>
              )}
            </View>
            <RatingControl value={draft.rating} onChange={onRatingChange} />
            <TagEditor
              tags={draft.tags}
              suggestions={tagSuggestions}
              onChange={onTagsChange}
              onInputChange={(value) => {
                pendingTag.current = value;
              }}
            />
            <DrawerClose asChild>
              <Button size="lg" title="Done" onPress={() => undefined} />
            </DrawerClose>
          </View>
        </DrawerContent>
      }
    </Drawer>
  );
}

const s = createAppStyles(
  {
    hero: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    artwork: {
      width: 128,
      height: 72,
      overflow: 'hidden',
      borderRadius: radius.sm,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    image: { width: '100%', height: '100%' },
    fallbackNumber: { color: colors.faint, fontSize: 24, fontWeight: '800' },
    heroCopy: { flex: 1, minWidth: 0, gap: 4 },
    kicker: { color: colors.secondary, fontSize: 12, fontWeight: '600' },
    title: { ...typeRamp.sheetTitle },
    about: { gap: 6 },
    overview: { ...typeRamp.body },
    fact: { ...typeRamp.meta },
    content: { gap: 22 },
    group: { borderRadius: radius.lg, backgroundColor: colors.surface, overflow: 'hidden' },
    divider: { height: 1, marginLeft: 64, backgroundColor: colors.border },
    // Same right inset as the switch row above, so the controls end on one line.
    stepper: { paddingHorizontal: 16, paddingVertical: 6 },
  },
  ['fallbackNumber', 'kicker', 'title', 'overview', 'fact'] as const,
);
