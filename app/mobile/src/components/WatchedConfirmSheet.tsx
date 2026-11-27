import { useEffect, useState } from 'react';
import { Text, useWindowDimensions, View } from 'react-native';
import { Drawer, DrawerContent } from '@/components/ui/drawer';
import { PosterImage } from '@/components/ui/PosterImage';
import { Button, SwitchRow } from '@/components/ui/primitives';
import { colors } from '@/constants/colors';
import { radius, typeRamp } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';

const EXIT_MS = 240;

type ConfirmableItem = {
  title: string;
  posterPath?: string;
  mediaType: 'movie' | 'tv';
};

/**
 * Confirms moving a title to Watched by dragging. Choosing "Don't ask again" stores the
 * preference; it can be turned back on from Settings.
 */
export function WatchedConfirmSheet<T extends ConfirmableItem>({
  item,
  pending,
  onClose,
  onConfirm,
}: {
  item: T | undefined;
  pending: boolean;
  onClose: () => void;
  onConfirm: (item: T, options: { dontAskAgain: boolean }) => void;
}) {
  // Keep showing the last title while the sheet animates closed, then let it go.
  const [shown, setShown] = useState(item);
  if (item && item !== shown) setShown(item);
  useEffect(() => {
    if (item) return;
    const timer = setTimeout(() => setShown(undefined), EXIT_MS);
    return () => clearTimeout(timer);
  }, [item]);
  return (
    <Drawer open={!!item} dismissible={!pending} onOpenChange={(open) => !open && onClose()}>
      {!!shown && (
        <WatchedConfirmContent
          key={shown.title}
          item={shown}
          pending={pending}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      )}
    </Drawer>
  );
}

function WatchedConfirmContent<T extends ConfirmableItem>({
  item,
  pending,
  onClose,
  onConfirm,
}: {
  item: T;
  pending: boolean;
  onClose: () => void;
  onConfirm: (item: T, options: { dontAskAgain: boolean }) => void;
}) {
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 360 || fontScale > 1.15;
  return (
    <DrawerContent className="max-w-md">
      <View style={s.hero}>
        <PosterImage path={item.posterPath} title={item.title} style={s.poster} />
        <View style={s.heroCopy}>
          <Text accessibilityRole="header" style={s.title}>
            Mark as watched?
          </Text>
          <Text numberOfLines={2} style={s.itemTitle}>
            {item.title}
          </Text>
        </View>
      </View>
      {/* Only shows need explaining: every released episode gets marked too. */}
      {item.mediaType === 'tv' && (
        <Text style={s.body}>All released episodes will be marked watched.</Text>
      )}
      <View style={s.preference}>
        <SwitchRow
          label="Don’t ask again"
          detail="You can turn this back on in Settings"
          value={dontAskAgain}
          onChange={setDontAskAgain}
        />
      </View>
      {/* Side by side when both labels fit; stacked (primary on top) on narrow screens or
          with large system text, so "Mark watched" is never clipped. */}
      <View style={[s.actions, stacked && s.actionsStacked]}>
        <Button
          title="Cancel"
          variant="secondary"
          size="lg"
          disabled={pending}
          onPress={onClose}
          style={stacked ? undefined : s.action}
        />
        <Button
          title={pending ? 'Marking…' : 'Mark watched'}
          size="lg"
          disabled={pending}
          onPress={() => {
            if (!pending) onConfirm(item, { dontAskAgain });
          }}
          style={stacked ? undefined : s.action}
        />
      </View>
    </DrawerContent>
  );
}

const s = createAppStyles(
  {
    hero: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    poster: { width: 64, height: 96, borderRadius: radius.sm },
    heroCopy: { flex: 1, minWidth: 0, gap: 6 },
    title: { ...typeRamp.screenTitle, fontSize: 22, lineHeight: 28 },
    itemTitle: { ...typeRamp.body, color: colors.secondary },
    body: { ...typeRamp.body },
    preference: { marginHorizontal: -16, borderRadius: radius.lg, overflow: 'hidden' },
    actions: { flexDirection: 'row', gap: 10 },
    actionsStacked: { flexDirection: 'column-reverse' },
    action: { flex: 1 },
  },
  ['title', 'itemTitle', 'body'] as const,
);
