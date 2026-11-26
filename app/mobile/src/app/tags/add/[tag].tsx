import { useTaskState } from '@/hooks/use-task-state';
import { ScreenView } from '@/components/ScreenLayout';
import * as Effect from 'effect/Effect';
import { saveLibrary } from '@marker/shared/clientEffects';
import { useOperation } from '@/hooks/use-operation';
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { ReduceMotion, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { KeyboardScrollView } from '@/components/ui/KeyboardScrollView';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { ConfirmDialog } from '@/components/RemoveTitleDialog';
import { useMutation, useQuery } from 'convex/react';
import Check from 'lucide-react-native/icons/check';
import { api } from '@marker/shared/api';
import type { Id } from '@marker/shared/dataModel';
import { SecondaryHeader } from '@/components/BackButton';
import { LibraryPickerSkeleton } from '@/components/PageSkeletons';
import { NativePressable } from '@/components/ui/NativePressable';
import { Button, EmptyState, SearchField } from '@/components/ui/primitives';
import { PosterImage } from '@/components/ui/PosterImage';
import { useToast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { radius, typeRamp } from '@/constants/theme';
import { LIBRARY_STATUSES } from '@/lib/libraryFilters';
import { createAppStyles } from '@/lib/typography';
import type { LibraryItem } from '@/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { compareTitles } from '@/lib/text';

const BATCH_SIZE = 100;
const STATUS_LABEL = Object.fromEntries(LIBRARY_STATUSES);
const sheetIn = SlideInDown.duration(240).reduceMotion(ReduceMotion.System);
const sheetOut = SlideOutDown.duration(180).reduceMotion(ReduceMotion.System);

const plural = (count: number) => `${count} ${count === 1 ? 'title' : 'titles'}`;

/** The server's per-title tag limit. */
const MAX_TAGS = 20;

export default function AddTitlesToTagScreen() {
  const runOperation = useOperation();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ tag?: string | string[] }>();
  const tag = Array.isArray(params.tag) ? params.tag[0] : (params.tag ?? '');
  const items = useQuery(api.library.items.listItems);
  const addTagToItems = useMutation(api.library.items.addTagToItems);
  const removeTagFromItems = useMutation(api.library.items.removeTagFromItems);
  const toast = useToast();
  const navigation = useNavigation();
  const [search, setSearch] = useState('');
  // The membership the person wants for each title they touched. Adds and removes are
  // derived from it against the live library, so a title can't be in both.
  const [desired, setDesired] = useState<Map<string, boolean>>(new Map());
  const { pending: saving, setPending: setSaving } = useTaskState();
  const tagKey = tag.trim().toLocaleLowerCase();

  const isMember = (item: LibraryItem) =>
    item.tags.some((itemTag) => itemTag.trim().toLocaleLowerCase() === tagKey);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return [...(items ?? [])]
      .filter((item) => !query || item.title.toLocaleLowerCase().includes(query))
      .sort((left, right) => compareTitles(left.title, right.title));
  }, [items, search]);
  const memberCount = (items ?? []).filter(isMember).length;

  const isChecked = (item: LibraryItem) => desired.get(String(item._id)) ?? isMember(item);
  const toggle = (item: LibraryItem) => {
    const checked = isChecked(item);
    setDesired((current) => new Map(current).set(String(item._id), !checked));
  };
  const added = new Set<string>();
  const removed = new Set<string>();
  for (const item of items ?? []) {
    const want = desired.get(String(item._id));
    if (want === undefined || want === isMember(item)) continue;
    (want ? added : removed).add(String(item._id));
  }

  const changes = added.size + removed.size;
  // Picks stay local until Save changes, so leaving with some asks first.
  const [leaveAction, setLeaveAction] = useState<Parameters<typeof navigation.dispatch>[0]>();
  const [discarding, setDiscarding] = useState(false);
  usePreventRemove(changes > 0 && !saving && !discarding, ({ data }) =>
    setLeaveAction(data.action),
  );
  useEffect(() => {
    if (discarding && leaveAction) navigation.dispatch(leaveAction);
  }, [discarding, leaveAction, navigation]);
  const joined = [
    added.size ? `add ${plural(added.size)}` : undefined,
    removed.size ? `remove ${plural(removed.size)}` : undefined,
  ]
    .filter(Boolean)
    .join(', ');
  const summary = joined.charAt(0).toUpperCase() + joined.slice(1);

  const confirm = async () => {
    if (!changes || saving) return;
    setSaving(true);
    const addIds = [...added] as Id<'items'>[];
    const removeIds = [...removed] as Id<'items'>[];
    // Titles that reached the tag limit meanwhile; the server skips them and saves the rest.
    const full: string[] = [];
    // Batches commit separately; drop the ones that landed so a retry only sends the rest.
    const landed = (ids: Id<'items'>[]) =>
      setDesired((current) => {
        const next = new Map(current);
        ids.forEach((id) => next.delete(String(id)));
        return next;
      });
    await runOperation.write(
      Effect.gen(function* () {
        for (let start = 0; start < addIds.length; start += BATCH_SIZE) {
          const batch = addIds.slice(start, start + BATCH_SIZE);
          const result = yield* saveLibrary(() => addTagToItems({ tag, itemIds: batch }));
          full.push(...result.full);
          landed(batch);
        }
        for (let start = 0; start < removeIds.length; start += BATCH_SIZE) {
          const batch = removeIds.slice(start, start + BATCH_SIZE);
          yield* saveLibrary(() => removeTagFromItems({ tag, itemIds: batch }));
          landed(batch);
        }
      }),
      {
        success: () => {
          const addedCount = addIds.length - full.length;
          // One plain sentence per outcome: what saved, then what was skipped and why.
          const saved = [
            addedCount ? `Added ${plural(addedCount)} to ${tag}` : undefined,
            removeIds.length
              ? `removed ${plural(removeIds.length)}${addedCount ? '' : ` from ${tag}`}`
              : undefined,
          ]
            .filter(Boolean)
            .join(', ');
          const names =
            full.length > 2
              ? `${full.slice(0, 2).join(', ')} and ${full.length - 2} more`
              : full.join(' and ');
          const skipped = full.length
            ? `${names} already ${full.length === 1 ? 'has' : 'have'} ${MAX_TAGS} tags`
            : undefined;
          toast.show(
            [saved && saved[0]!.toUpperCase() + saved.slice(1), skipped]
              .filter(Boolean)
              .map((sentence) => `${sentence}.`)
              .join(' '),
          );
          if (router.canGoBack()) router.back();
          else router.replace({ pathname: '/tags/[tag]', params: { tag } });
        },
        failure: () => {
          toast.show(`Some changes to ${tag} didn’t save. Try again.`);
          setSaving(false);
        },
      },
    );
  };

  return (
    <ScreenView style={s.root}>
      <SecondaryHeader
        title={`Edit ${tag} titles`}
        backLabel={`Back to ${tag}`}
        fallback={{ pathname: '/tags/[tag]', params: { tag } }}
        maxWidth={760}
      />
      <View style={s.searchBar}>
        <SearchField
          accessibilityLabel="Search your library"
          testID="tag-library-search"
          value={search}
          onChangeText={setSearch}
          placeholder="Search your library"
          containerStyle={s.searchField}
        />
        {items !== undefined && (
          <Text style={s.count}>
            {memberCount + added.size - removed.size} of {plural(items.length)} in {tag}
          </Text>
        )}
      </View>

      {items === undefined ? (
        <LibraryPickerSkeleton />
      ) : (
        <KeyboardScrollView
          contentContainerStyle={[
            s.content,
            // Clear the gesture bar, and the save footer when it is showing.
            { paddingBottom: (changes > 0 ? 120 : 40) + insets.bottom },
          ]}
        >
          {!filtered.length ? (
            <EmptyState
              title={items.length ? 'No matching titles' : 'Your library is empty'}
              detail={items.length ? 'Try another search.' : 'Add titles to your library first.'}
            />
          ) : (
            <View style={s.list}>
              {filtered.map((item) => {
                const checked = isChecked(item);
                // A title at the tag limit can't take this tag until one is removed.
                // Already picked stays uncheckable even if it filled up meanwhile.
                const full = !checked && !isMember(item) && item.tags.length >= MAX_TAGS;
                return (
                  <NativePressable
                    key={item._id}
                    accessibilityRole="checkbox"
                    accessibilityLabel={item.title}
                    accessibilityHint={
                      full
                        ? 'Remove a tag from this title first'
                        : checked
                          ? `Removes it from ${tag}`
                          : `Adds it to ${tag}`
                    }
                    accessibilityState={{ checked, disabled: saving || full }}
                    disabled={saving}
                    // A full title says why it can't be picked instead of ignoring the tap.
                    onPress={() =>
                      full ? toast.show(`${item.title} already has ${MAX_TAGS} tags`) : toggle(item)
                    }
                    style={s.row}
                    pressedStyle={s.rowPressed}
                  >
                    <PosterImage path={item.posterPath} title={item.title} style={s.poster} />
                    <View style={s.copy}>
                      <Text numberOfLines={2} style={s.itemTitle}>
                        {item.title}
                      </Text>
                      <Text style={s.meta}>
                        {full
                          ? `${MAX_TAGS} tags · Remove a tag first`
                          : item.isAnime
                            ? item.mediaType === 'movie'
                              ? 'Anime movie'
                              : 'Anime'
                            : item.mediaType === 'movie'
                              ? 'Movie'
                              : 'TV show'}
                        {!full && ` · ${STATUS_LABEL[item.status]}`}
                      </Text>
                    </View>
                    {!full && (
                      <View style={[s.check, checked && s.checkSelected]}>
                        {checked && <Check size={15} color={colors.bg} strokeWidth={2.6} />}
                      </View>
                    )}
                  </NativePressable>
                );
              })}
            </View>
          )}
        </KeyboardScrollView>
      )}

      {changes > 0 && (
        <Animated.View entering={sheetIn} exiting={sheetOut} style={s.footer}>
          <View style={s.footerInner}>
            <Text numberOfLines={2} style={s.selection}>
              {summary}
            </Text>
            <Button
              title={saving ? 'Saving…' : 'Save changes'}
              size="lg"
              disabled={saving}
              onPress={() => void confirm()}
              testID="confirm-add-tag-titles"
              style={s.confirm}
            />
          </View>
        </Animated.View>
      )}
      <ConfirmDialog
        open={!!leaveAction && !discarding}
        title="Discard changes?"
        message={`Your changes to ${tag} haven’t been saved.`}
        confirmLabel="Discard"
        pendingLabel="Discarding…"
        cancelLabel="Keep editing"
        destructive
        pending={false}
        onCancel={() => setLeaveAction(undefined)}
        onConfirm={() => setDiscarding(true)}
      />
    </ScreenView>
  );
}

const s = createAppStyles(
  {
    root: { flex: 1, backgroundColor: colors.bg },
    searchBar: {
      position: 'absolute',
      top: 72,
      left: 0,
      right: 0,
      zIndex: 9,
      width: '100%',
      maxWidth: 760,
      alignSelf: 'center',
      paddingHorizontal: 20,
      paddingTop: 4,
      paddingBottom: 10,
      gap: 10,
      backgroundColor: colors.bg,
    },
    searchField: { flex: 0 },
    count: { ...typeRamp.meta },
    content: {
      width: '100%',
      maxWidth: 760,
      alignSelf: 'center',
      paddingHorizontal: 12,
      paddingTop: 168,
      paddingBottom: 40,
    },
    list: { width: '100%' },
    row: {
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 8,
      paddingHorizontal: 8,
      borderRadius: radius.md,
    },
    rowPressed: { backgroundColor: colors.surface },
    poster: { width: 38, height: 57, borderRadius: radius.xs },
    copy: { flex: 1, minWidth: 0, gap: 3 },
    itemTitle: { ...typeRamp.rowTitle },
    meta: { ...typeRamp.meta },
    check: {
      width: 26,
      height: 26,
      borderRadius: radius.pill,
      borderWidth: 1.5,
      borderColor: colors.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkSelected: { backgroundColor: colors.text, borderColor: colors.text },
    footer: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.bg,
      borderTopWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 16,
    },
    footerInner: {
      width: '100%',
      maxWidth: 720,
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
    },
    selection: { ...typeRamp.label, color: colors.text, flex: 1 },
    confirm: { minWidth: 148 },
  },
  ['count', 'itemTitle', 'meta', 'selection'] as const,
);
