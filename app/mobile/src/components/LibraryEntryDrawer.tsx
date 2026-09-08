import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { RatingControl, Stepper, TagEditor } from '@/components/ui/library-controls';
import { Button, Segmented } from '@/components/ui/primitives';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';
import type { Status } from '@/types';

export type LibraryEntryDraft = {
  status: Status;
  rating?: number;
  timesWatched: number;
  tags: string[];
};

const statusOptions = [
  { label: 'Watched', value: 'watched' },
  { label: 'Watching', value: 'watching' },
  { label: 'Watchlist', value: 'watchlist' },
  { label: 'Dropped', value: 'dropped' },
] as const;

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
  const { width: windowWidth } = useWindowDimensions();
  const hintWidth = Math.max(0, Math.min(360, windowWidth - 64));

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
      <DrawerContent className="max-w-lg gap-6 rounded-2xl border-border bg-background p-6">
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
        </DrawerHeader>
        <View style={s.controls}>
          <View style={s.group}>
            <Text style={s.label}>Status</Text>
            <Segmented options={statusOptions} value={draft.status} onChange={setStatus} />
            {draft.status === 'watched' && watchedHint && (
              <Text numberOfLines={2} style={[s.hint, { width: hintWidth }]}>
                {watchedHint}
              </Text>
            )}
          </View>
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
              label="Times Watched"
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
          {mode === 'add' && (
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
          )}
          {mode === 'update' && onRemove && (
            <Pressable
              accessibilityRole="button"
              disabled={saving || removePending}
              onPress={onRemove}
              style={s.destructiveAction}
            >
              <Text style={[s.destructiveText, (saving || removePending) && s.disabledText]}>
                {removePending ? 'Removing…' : 'Remove from library'}
              </Text>
            </Pressable>
          )}
        </View>
      </DrawerContent>
    </Drawer>
  );
}

const s = createAppStyles(
  {
    controls: { gap: 24 },
    group: { gap: 10 },
    label: { color: colors.muted, fontSize: 11, fontWeight: '600', letterSpacing: 0.2 },
    hint: {
      width: '100%',
      minWidth: 0,
      color: colors.muted,
      fontSize: 11,
      lineHeight: 15,
      textAlign: 'center',
    },
    destructiveAction: {
      minHeight: 44,
      alignSelf: 'flex-start',
      justifyContent: 'center',
    },
    destructiveText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    disabledText: { opacity: 0.4 },
  },
  ['label', 'hint', 'destructiveText'] as const,
);
