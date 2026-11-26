import { transitionDraft, type DraftState } from '@marker/shared/lifecycle';
import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import Hash from 'lucide-react-native/icons/hash';
import Clock3 from 'lucide-react-native/icons/clock-3';
import {
  ControlSection,
  RatingControl,
  Stepper,
  TagEditor,
  withPendingTag,
} from '@/components/ui/library-controls';
import { Button, Segmented, SwitchRow } from '@/components/ui/primitives';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';
import { ENTRY_STATUS_OPTIONS } from '@/components/ui/entryStatusOptions';
import type { Status } from '@/types';
import { SettingIcon } from '@/components/settings/SettingIcon';

export type LibraryEntryDraft = {
  status: Status;
  /** Watched shows only: also listed under Watching (set by hand when not automatic). */
  alsoWatching?: boolean;
  rating?: number;
  timesWatched: number;
  tags: string[];
};

type EntryContentProps = {
  mode: 'add' | 'update';
  initial: LibraryEntryDraft;
  suggestions: string[];
  saving: boolean;
  onSubmit: (draft: LibraryEntryDraft) => void | Promise<void>;
  watchedHint?: string;
  onRemove?: () => void;
  removePending?: boolean;
  onTagPrefixChange?: (prefix: string) => void;
  /**
   * Offer "Also in Watching" for a watched show. Only when the automatic setting is off;
   * otherwise new episodes decide it.
   */
  offerAlsoWatching?: boolean;
};

type LibraryEntryDrawerProps = EntryContentProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Changes whose save failed. The sheet reopens with them and retries when closed. */
  unsaved?: LibraryEntryDraft;
};

export function LibraryEntryDrawer(props: LibraryEntryDrawerProps) {
  // Each opening owns a fresh draft and submission guard. Prop refreshes while
  // editing must not discard unsaved changes, and closing keeps the draft on screen
  // until the sheet has animated away.
  const [session, setSession] = useState({ open: props.open, id: 0 });
  if (session.open !== props.open)
    setSession({ open: props.open, id: props.open ? session.id + 1 : session.id });
  return <LibraryEntryDrawerSession key={session.id} {...props} />;
}

function LibraryEntryDrawerSession({
  mode,
  initial,
  suggestions,
  saving,
  onSubmit,
  watchedHint,
  onRemove,
  removePending = false,
  onTagPrefixChange,
  offerAlsoWatching = false,
  open,
  onOpenChange,
  unsaved,
}: LibraryEntryDrawerProps) {
  const [editor, setEditor] = useState<DraftState<LibraryEntryDraft>>(() => {
    const start = unsaved ?? initial;
    return { state: unsaved ? 'dirty' : 'clean', draft: { ...start, tags: [...start.tags] } };
  });
  const submission = useRef<'ready' | 'submitted'>('ready');
  // Text still typed in the tag field, saved as a tag when the sheet closes.
  const pendingTag = useRef('');
  const { draft } = editor;
  const withTyped = (entry: LibraryEntryDraft) => {
    const tags = withPendingTag(entry.tags, pendingTag.current, suggestions);
    return tags === entry.tags ? entry : { ...entry, tags };
  };

  const title = mode === 'add' ? 'Add to library' : 'Edit entry';
  const updateDraft = (update: (current: LibraryEntryDraft) => LibraryEntryDraft) => {
    setEditor((current) => transitionDraft(current, { type: 'edit', update }));
  };
  const setStatus = (status: Status) => {
    updateDraft((current) => ({
      ...current,
      status,
      alsoWatching: status === 'watched' ? current.alsoWatching : undefined,
      timesWatched:
        status === 'watched'
          ? Math.max(1, current.timesWatched)
          : mode === 'add' && (status === 'watchlist' || status === 'dropped')
            ? 0
            : current.timesWatched,
    }));
  };
  const setTimesWatched = (timesWatched: number) => {
    updateDraft((current) => ({
      ...current,
      timesWatched,
      ...(timesWatched > 0 && { status: 'watched' }),
    }));
  };

  return (
    <Drawer
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) return;
        onOpenChange(false);
        const submitted = withTyped(draft);
        // The field empties when the sheet closes, so the typed text goes with it.
        pendingTag.current = '';
        if (
          mode === 'update' &&
          (editor.state === 'dirty' || submitted !== draft) &&
          submission.current === 'ready'
        ) {
          submission.current = 'submitted';
          setEditor((current) => transitionDraft(current, { type: 'submit' }));
          void onSubmit(submitted);
        }
      }}
    >
      <DrawerContent className="max-w-lg">
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
        </DrawerHeader>
        <View style={s.controls}>
          <ControlSection label="Status">
            <Segmented options={ENTRY_STATUS_OPTIONS} value={draft.status} onChange={setStatus} />
            {draft.status === 'watched' && initial.status !== 'watched' && watchedHint && (
              <Animated.Text entering={FadeIn} exiting={FadeOut} style={s.hint}>
                {watchedHint}
              </Animated.Text>
            )}
          </ControlSection>
          {draft.status === 'watched' && (
            <Animated.View
              entering={FadeIn.duration(180)}
              exiting={FadeOut.duration(120)}
              layout={LinearTransition.duration(200)}
              style={s.watchedGroup}
            >
              {mode === 'update' && offerAlsoWatching && (
                <>
                  <SwitchRow
                    label="Also in Watching"
                    detail="Turn off when you’re caught up"
                    value={!!draft.alsoWatching}
                    onChange={(alsoWatching) =>
                      updateDraft((current) => ({
                        ...current,
                        alsoWatching: alsoWatching || undefined,
                      }))
                    }
                    icon={
                      <SettingIcon>
                        <Clock3 size={17} color={colors.text} strokeWidth={1.8} />
                      </SettingIcon>
                    }
                  />
                  <View style={s.watchedDivider} />
                </>
              )}
              <View style={s.stepperRow}>
                <Stepper
                  label="Times watched"
                  value={draft.timesWatched}
                  min={1}
                  onChange={setTimesWatched}
                  icon={
                    <SettingIcon>
                      <Hash size={17} color={colors.text} strokeWidth={1.8} />
                    </SettingIcon>
                  }
                />
              </View>
            </Animated.View>
          )}
          <RatingControl
            value={draft.rating}
            onChange={(rating) =>
              updateDraft((current) => ({
                ...current,
                rating,
              }))
            }
          />
          <TagEditor
            tags={draft.tags}
            suggestions={suggestions}
            onInputChange={(value) => {
              pendingTag.current = value;
              onTagPrefixChange?.(value);
            }}
            onChange={(tags) => updateDraft((current) => ({ ...current, tags }))}
          />
          <View style={s.footer}>
            {mode === 'add' ? (
              <Button
                size="lg"
                title={saving ? 'Adding…' : 'Add to library'}
                disabled={saving}
                onPress={() => {
                  if (submission.current === 'submitted') return;
                  submission.current = 'submitted';
                  setEditor((current) => transitionDraft(current, { type: 'submit' }));
                  const submitted = withTyped(draft);
                  pendingTag.current = '';
                  onOpenChange(false);
                  void onSubmit(submitted);
                }}
              />
            ) : (
              <DrawerClose asChild>
                <Button size="lg" title="Done" onPress={() => undefined} />
              </DrawerClose>
            )}
            {mode === 'update' && onRemove && (
              <Pressable
                accessibilityRole="button"
                disabled={saving || removePending}
                hitSlop={4}
                onPress={onRemove}
                style={s.destructiveAction}
              >
                <Text style={[s.destructiveText, (saving || removePending) && s.disabledText]}>
                  {removePending ? 'Removing…' : 'Remove from library'}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </DrawerContent>
    </Drawer>
  );
}

const s = createAppStyles(
  {
    controls: { gap: 22 },
    hint: { color: colors.muted, fontSize: 12, lineHeight: 17 },
    watchedGroup: {
      marginTop: -12,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    },
    watchedDivider: { height: 1, marginLeft: 64, backgroundColor: colors.border },
    // Same right inset as the switch row above, so the controls end on one line.
    stepperRow: { paddingHorizontal: 16, paddingVertical: 6 },
    footer: { gap: 8, marginTop: 4 },
    destructiveAction: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    destructiveText: { color: colors.danger, fontSize: 14, fontWeight: '600' },
    disabledText: { opacity: 0.4 },
  },
  ['hint', 'destructiveText'] as const,
);
