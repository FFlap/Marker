import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery } from 'convex/react';
import { Check } from 'lucide-react-native';
import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { SecondaryHeader } from '@/components/BackButton';
import { LibraryPickerSkeleton } from '@/components/PageSkeletons';
import { NativePressable } from '@/components/ui/NativePressable';
import { Button, EmptyState, Input } from '@/components/ui/primitives';
import { PosterImage } from '@/components/ui/PosterImage';
import { useToast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';
import type { LibraryItem } from '@/types';

const BATCH_SIZE = 100;

export default function AddTitlesToTagScreen() {
  const params = useLocalSearchParams<{ tag?: string | string[] }>();
  const tag = Array.isArray(params.tag) ? params.tag[0] : (params.tag ?? '');
  const items = useQuery(api.library.listItems);
  const addTagToItems = useMutation(api.library.addTagToItems);
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const tagKey = tag.trim().toLocaleLowerCase();

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return [...(items ?? [])]
      .filter((item) => !query || item.title.toLocaleLowerCase().includes(query))
      .sort((left, right) => left.title.localeCompare(right.title));
  }, [items, search]);

  const isMember = (item: LibraryItem) =>
    item.tags.some((itemTag) => itemTag.trim().toLocaleLowerCase() === tagKey);

  const toggle = (itemId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const confirm = async () => {
    if (!selected.size || saving) return;
    setSaving(true);
    const ids = [...selected] as Id<'items'>[];
    let added = 0;
    try {
      for (let start = 0; start < ids.length; start += BATCH_SIZE) {
        const batch = ids.slice(start, start + BATCH_SIZE);
        await addTagToItems({ tag, itemIds: batch });
        added += batch.length;
      }
      toast.show(`${ids.length} ${ids.length === 1 ? 'title' : 'titles'} added to ${tag}`);
      if (router.canGoBack()) router.back();
      else
        router.replace({
          pathname: '/tags/[tag]',
          params: { tag },
        });
    } catch {
      toast.show(
        added
          ? `Only ${added} of ${ids.length} ${ids.length === 1 ? 'title was' : 'titles were'} added to ${tag}`
          : `Couldn’t add titles to ${tag}`,
      );
      setSaving(false);
    }
  };

  const selectedCount = selected.size;
  return (
    <View style={s.root}>
      <SecondaryHeader
        title={`Add to ${tag}`}
        backLabel={`Back to ${tag}`}
        fallback={{ pathname: '/tags/[tag]', params: { tag } }}
        maxWidth={760}
      />
      <View style={s.searchBar}>
        <Input
          accessibilityLabel="Search your library"
          testID="tag-library-search"
          value={search}
          onChangeText={setSearch}
          placeholder="Search your library"
          returnKeyType="search"
          compact
          style={s.search}
        />
      </View>

      {items === undefined ? (
        <LibraryPickerSkeleton />
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
          <View style={s.intro}>
            <Text style={s.eyebrow}>YOUR LIBRARY</Text>
            <Text style={s.summary}>
              Select every title you want to include. Existing members stay checked.
            </Text>
          </View>
          {!filtered.length ? (
            <EmptyState
              title={items.length ? 'No matching titles' : 'Your library is empty'}
              detail={
                items.length
                  ? 'Try another search.'
                  : 'Add titles to your library before building this tag.'
              }
            />
          ) : (
            <View style={s.list}>
              {filtered.map((item) => {
                const member = isMember(item);
                const checked = member || selected.has(String(item._id));
                return (
                  <NativePressable
                    key={item._id}
                    accessibilityRole="checkbox"
                    accessibilityLabel={
                      member
                        ? `${item.title}, already in ${tag}`
                        : `${checked ? 'Remove' : 'Add'} ${item.title}`
                    }
                    accessibilityState={{ checked, disabled: member || saving }}
                    disabled={member || saving}
                    onPress={() => toggle(String(item._id))}
                    style={[s.row, checked && s.rowSelected, member && s.rowMember]}
                    pressedStyle={s.rowPressed}
                  >
                    <PosterImage path={item.posterPath} title={item.title} style={s.poster} />
                    <View style={s.copy}>
                      <Text numberOfLines={2} style={s.itemTitle}>
                        {item.title}
                      </Text>
                      <Text style={s.meta}>
                        {member
                          ? `IN ${tag.toLocaleUpperCase()}`
                          : item.mediaType === 'movie'
                            ? 'MOVIE'
                            : 'SERIES'}
                      </Text>
                    </View>
                    <View style={[s.check, checked && s.checkSelected]}>
                      {checked && (
                        <Check
                          size={15}
                          color={member ? colors.muted : colors.bg}
                          strokeWidth={2.4}
                        />
                      )}
                    </View>
                  </NativePressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      )}

      <View style={s.footer}>
        <View style={s.footerInner}>
          <View style={s.selectionCopy}>
            <Text style={s.selectionCount}>{selectedCount}</Text>
            <Text style={s.selectionLabel}>
              {selectedCount === 1 ? 'title selected' : 'titles selected'}
            </Text>
          </View>
          <View style={s.confirm}>
            <Button
              title={saving ? 'Adding…' : selectedCount ? `Add ${selectedCount}` : 'Select titles'}
              disabled={!selectedCount || saving}
              onPress={() => void confirm()}
              testID="confirm-add-tag-titles"
            />
          </View>
        </View>
      </View>
    </View>
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
      paddingVertical: 10,
      backgroundColor: colors.bg,
    },
    search: {
      height: 40,
      borderWidth: 0,
      backgroundColor: colors.surface,
      fontSize: 14,
    },
    content: {
      width: '100%',
      maxWidth: 760,
      alignSelf: 'center',
      paddingHorizontal: 20,
      paddingTop: 138,
      paddingBottom: 122,
    },
    intro: { paddingBottom: 18, borderBottomWidth: 1, borderColor: colors.border },
    eyebrow: { color: colors.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.1 },
    summary: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: 7, maxWidth: 480 },
    list: { width: '100%' },
    row: {
      minHeight: 82,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingVertical: 10,
      paddingHorizontal: 8,
      borderBottomWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
    },
    rowSelected: { backgroundColor: colors.surface },
    rowMember: { opacity: 0.62 },
    rowPressed: { opacity: 0.72 },
    poster: { width: 40, height: 60, borderRadius: 6 },
    copy: { flex: 1, minWidth: 0 },
    itemTitle: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '700' },
    meta: { color: colors.muted, fontSize: 9, fontWeight: '700', letterSpacing: 0.9, marginTop: 6 },
    check: {
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: colors.border,
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
      paddingBottom: 20,
    },
    footerInner: {
      width: '100%',
      maxWidth: 720,
      alignSelf: 'center',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
    },
    selectionCopy: { flex: 1, minWidth: 0 },
    selectionCount: { color: colors.text, fontSize: 21, lineHeight: 24, fontWeight: '700' },
    selectionLabel: { color: colors.muted, fontSize: 10, marginTop: 2 },
    confirm: { minWidth: 148 },
  },
  [
    'search',
    'eyebrow',
    'summary',
    'itemTitle',
    'meta',
    'selectionCount',
    'selectionLabel',
  ] as const,
);
