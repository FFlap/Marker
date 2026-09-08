import { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useClerk } from '@clerk/expo';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { Button, Segmented } from '@/components/ui/primitives';
import { NativePressable } from '@/components/ui/NativePressable';
import { useToast } from '@/components/ui/Toast';
import { colors } from '@/constants/colors';
import { SecondaryHeader } from '@/components/BackButton';
import { createAppStyles } from '@/lib/typography';
import {
  DEFAULT_DISPLAY_PREFERENCES,
  type GridColumns,
  type ListColumns,
  type ListTextSize,
} from '@/lib/displayPreferences';

const views = [
  { label: 'List', value: 'list' },
  { label: 'Posters', value: 'posters' },
] as const;
const textSizes = [
  { label: 'Small', value: 'small' },
  { label: 'Standard', value: 'medium' },
  { label: 'Large', value: 'large' },
] as const;
const listColumns = [
  { label: 'One column', value: '1' },
  { label: 'Two columns', value: '2' },
] as const;

export default function Settings() {
  const settings = useQuery(api.settings.getSettings);
  const setSettings = useMutation(api.settings.setSettings);
  const { signOut } = useClerk();
  const toast = useToast();
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [optimistic, setOptimistic] = useState<Record<string, unknown>>({});
  const current = { ...DEFAULT_DISPLAY_PREFERENCES, ...settings, ...optimistic };

  const update = async (key: string, value: unknown) => {
    setPending((current) => new Set(current).add(key));
    setOptimistic((existing) => ({ ...existing, [key]: value }));
    try {
      await setSettings({ [key]: value });
    } catch {
      toast.show('Couldn’t update settings');
    } finally {
      setOptimistic((existing) => {
        const next = { ...existing };
        delete next[key];
        return next;
      });
      setPending((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  };
  const handleSignOut = async () => {
    setPending((current) => new Set(current).add('signout'));
    try {
      await signOut();
    } catch {
      toast.show('Couldn’t sign out');
    } finally {
      setPending((current) => {
        const next = new Set(current);
        next.delete('signout');
        return next;
      });
    }
  };

  return (
    <View style={s.root}>
      <SecondaryHeader title="Settings" maxWidth={680} />
      <ScrollView contentContainerStyle={s.content}>
        <View style={[s.group, s.firstGroup]}>
          <View style={s.groupHead}>
            <Text style={s.groupTitle}>Default view</Text>
            <Text style={s.groupHint}>Used across Library and Tags</Text>
          </View>
          {settings === undefined ? (
            <ActivityIndicator accessibilityLabel="Loading view preference" color={colors.muted} />
          ) : (
            <Segmented
              options={views}
              value={current.defaultView as 'list' | 'posters'}
              disabled={pending.has('defaultView')}
              onChange={(defaultView) => void update('defaultView', defaultView)}
            />
          )}
        </View>

        {current.defaultView === 'posters' ? (
          <View style={s.group}>
            <View style={s.groupHead}>
              <Text style={s.groupTitle}>Grid scale</Text>
              <Text style={s.groupHint}>Pinch in or out to change this anywhere</Text>
            </View>
            <View accessibilityRole="radiogroup" style={s.densityOptions}>
              {([3, 4, 5] as GridColumns[]).map((columns) => {
                const selected = current.gridColumns === columns;
                return (
                  <NativePressable
                    key={columns}
                    accessibilityRole="radio"
                    accessibilityLabel={`${columns} columns`}
                    accessibilityState={{ checked: selected, disabled: pending.has('gridColumns') }}
                    disabled={pending.has('gridColumns')}
                    onPress={() => void update('gridColumns', columns)}
                    style={[s.densityOption, selected && s.densityOptionSelected]}
                    pressedStyle={s.pressed}
                  >
                    <View style={s.posterPreview}>
                      {Array.from({ length: columns }).map((_, index) => (
                        <View
                          key={index}
                          style={[s.previewPoster, selected && s.previewPosterSelected]}
                        />
                      ))}
                    </View>
                    <Text style={[s.densityLabel, selected && s.densityLabelSelected]}>
                      {columns}
                    </Text>
                  </NativePressable>
                );
              })}
            </View>
          </View>
        ) : (
          <>
            <View style={s.group}>
              <View style={s.groupHead}>
                <Text style={s.groupTitle}>Text size</Text>
                <Text style={s.groupHint}>Adjust title and rating readability</Text>
              </View>
              <Segmented
                options={textSizes}
                value={current.listTextSize as ListTextSize}
                disabled={pending.has('listTextSize')}
                onChange={(listTextSize) => void update('listTextSize', listTextSize)}
              />
            </View>
            <View style={s.group}>
              <View style={s.groupHead}>
                <Text style={s.groupTitle}>List layout</Text>
                <Text style={s.groupHint}>Fit more titles without switching to posters</Text>
              </View>
              <Segmented
                options={listColumns}
                value={String(current.listColumns) as '1' | '2'}
                disabled={pending.has('listColumns')}
                onChange={(value) => void update('listColumns', Number(value) as ListColumns)}
              />
            </View>
          </>
        )}

        <View style={s.divider} />
        <Text style={s.section}>NOTIFICATIONS</Text>
        <Text style={s.help}>
          Choose which updates appear in the activity feed from people you follow.
        </Text>
        <View style={s.toggleGroup}>
          <NotificationToggle
            label="Ratings"
            detail="Ratings shared by people you follow"
            value={current.activityRatings !== false}
            disabled={pending.has('activityRatings')}
            onChange={(value) => void update('activityRatings', value)}
          />
          <NotificationToggle
            label="Watching"
            detail="When someone starts watching a title"
            value={current.activityWatching !== false}
            disabled={pending.has('activityWatching')}
            onChange={(value) => void update('activityWatching', value)}
          />
          <NotificationToggle
            label="Watched"
            detail="Finished titles and watched episodes"
            value={current.activityWatched !== false}
            disabled={pending.has('activityWatched')}
            onChange={(value) => void update('activityWatched', value)}
          />
        </View>

        <View style={s.divider} />
        <Text style={s.section}>EXTENSION SYNC</Text>
        <Text style={s.help}>
          Install the Marker Chrome extension and sign in with this same account to sync watch
          history automatically.
        </Text>
        <View style={s.signout}>
          <Button
            title={pending.has('signout') ? 'Signing out…' : 'Sign out'}
            variant="danger"
            disabled={pending.size > 0}
            onPress={handleSignOut}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function NotificationToggle({
  label,
  detail,
  value,
  disabled,
  onChange,
}: {
  label: string;
  detail: string;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <NativePressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={s.toggleRow}
      pressedStyle={s.pressed}
    >
      <View style={s.toggleCopy}>
        <Text style={s.groupTitle}>{label}</Text>
        <Text style={s.groupHint}>{detail}</Text>
      </View>
      <View style={[s.switchTrack, value && s.switchTrackOn]}>
        <View style={[s.switchThumb, value && s.switchThumbOn]} />
      </View>
    </NativePressable>
  );
}

const s = createAppStyles(
  {
    root: { flex: 1, backgroundColor: colors.bg },
    content: {
      width: '100%',
      maxWidth: 680,
      alignSelf: 'center',
      padding: 20,
      paddingTop: 88,
      paddingBottom: 72,
    },
    group: { marginTop: 34, gap: 14 },
    firstGroup: { marginTop: 0 },
    groupHead: { gap: 3 },
    groupTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
    groupHint: { color: colors.muted, fontSize: 11, lineHeight: 16 },
    densityOptions: { flexDirection: 'row', gap: 10 },
    densityOption: {
      flex: 1,
      minHeight: 82,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 9,
      paddingHorizontal: 8,
    },
    densityOptionSelected: { backgroundColor: colors.text, borderColor: colors.text },
    posterPreview: { height: 24, flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
    previewPoster: { width: 9, height: 20, borderRadius: 2, backgroundColor: colors.muted },
    previewPosterSelected: { backgroundColor: colors.bg },
    densityLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
    densityLabelSelected: { color: colors.bg },
    pressed: { opacity: 0.74 },
    divider: { height: 1, backgroundColor: colors.border, marginTop: 42 },
    section: {
      color: colors.muted,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 1.1,
      marginTop: 30,
      marginBottom: 14,
    },
    help: { color: colors.muted, fontSize: 13, lineHeight: 20 },
    toggleGroup: { gap: 2, marginTop: 14 },
    toggleRow: {
      minHeight: 62,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
      borderBottomWidth: 1,
      borderColor: colors.border,
    },
    toggleCopy: { flex: 1, minWidth: 0 },
    switchTrack: {
      width: 42,
      height: 24,
      borderRadius: 12,
      padding: 3,
      backgroundColor: colors.elevated,
    },
    switchTrackOn: { backgroundColor: colors.text },
    switchThumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.muted },
    switchThumbOn: { marginLeft: 18, backgroundColor: colors.bg },
    signout: { marginTop: 44 },
  },
  ['groupTitle', 'groupHint', 'densityLabel', 'densityLabelSelected', 'section', 'help'] as const,
);
