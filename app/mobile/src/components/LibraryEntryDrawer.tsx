import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  ControlSection,
  RatingControl,
  Stepper,
  TagEditor,
} from '@/components/ui/library-controls';
import { Button, Segmented } from '@/components/ui/primitives';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';
import { ENTRY_STATUS_OPTIONS } from '@/components/ui/entryStatusOptions';
import type { Status } from '@/types';

export type LibraryEntryDraft = {
  status: Status;
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
};

export function LibraryEntryDrawer({
  mode,
  initial,
  suggestions,
  saving,
  onSubmit,
  watchedHint,
  onRemove,
  removePending = false,
  onTagPrefixChange,
  open,
  onOpenChange,
}: EntryContentProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [editor, setEditor] = useState<{
    draft: LibraryEntryDraft;
    dirty: boolean;
    wasOpen: boolean;
  }>(() => ({
    draft: { ...initial, tags: [...initial.tags] },
    dirty: false,
    wasOpen: open,
  }));
  const submitted = useRef(false);
  useEffect(() => {
    if (open) submitted.current = false;
  }, [open]);
  if (open !== editor.wasOpen) {
    setEditor(
      open
        ? {
            draft: { ...initial, tags: [...initial.tags] },
            dirty: false,
            wasOpen: true,
          }
        : { ...editor, wasOpen: false },
    );
  }
  const { draft } = editor;

  const title = mode === 'add' ? 'Add to library' : 'Edit entry';
  const updateDraft = (update: (current: LibraryEntryDraft) => LibraryEntryDraft) => {
    setEditor((current) => ({
      ...current,
      draft: update(current.draft),
      dirty: true,
    }));
  };
  const setStatus = (status: Status) => {
    updateDraft((current) => ({
      ...current,
      status,
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
        if (mode === 'update' && editor.dirty && !submitted.current) {
          submitted.current = true;
          void onSubmit(draft);
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
            {draft.status === 'watched' && watchedHint && <Text style={s.hint}>{watchedHint}</Text>}
          </ControlSection>
          <RatingControl
            value={draft.rating}
            onChange={(rating) =>
              updateDraft((current) => ({
                ...current,
                rating,
              }))
            }
          />
          {draft.status === 'watched' && (
            <Stepper
              label="Times watched"
              value={draft.timesWatched}
              min={1}
              onChange={setTimesWatched}
            />
          )}
          <TagEditor
            tags={draft.tags}
            suggestions={suggestions}
            onInputChange={onTagPrefixChange}
            onChange={(tags) => updateDraft((current) => ({ ...current, tags }))}
          />
          <View style={s.footer}>
            {mode === 'add' ? (
              <Button
                title={saving ? 'Adding…' : 'Add to library'}
                disabled={saving}
                onPress={() => {
                  if (submitted.current) return;
                  submitted.current = true;
                  onOpenChange(false);
                  void onSubmit(draft);
                }}
              />
            ) : (
              // Closing the sheet saves pending edits, so Done simply dismisses it.
              <DrawerClose asChild>
                <Button title="Done" onPress={() => undefined} />
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
    controls: { gap: 28 },
    hint: { color: colors.muted, fontSize: 12, lineHeight: 17 },
    footer: { gap: 8, marginTop: 4 },
    destructiveAction: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    destructiveText: { color: colors.danger, fontSize: 14, fontWeight: '600' },
    disabledText: { opacity: 0.4 },
  },
  ['hint', 'destructiveText'] as const,
);
