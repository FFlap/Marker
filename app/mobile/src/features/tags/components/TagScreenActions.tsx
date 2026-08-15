import { router, type Href } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { Text } from 'react-native';
import { NativePressable } from '@/components/ui/NativePressable';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Button } from '@/components/ui/primitives';
import { colors } from '@/constants/colors';
import { tagDetailStyles as s } from '../screens/TagDetailScreen.styles';
import type { RankedItem } from './TagScreenParts';

export function ConfirmWatchedMove({
  item,
  pending,
  onClose,
  onConfirm,
}: {
  item: RankedItem | undefined;
  pending: boolean;
  onClose: () => void;
  onConfirm: (item: RankedItem) => Promise<void>;
}) {
  return (
    <Drawer open={!!item} onOpenChange={(open) => !open && !pending && onClose()}>
      {!!item && (
        <DrawerContent className="max-w-md gap-6 rounded-2xl border-border bg-background p-6">
          <DrawerHeader>
            <DrawerTitle>Mark as watched?</DrawerTitle>
          </DrawerHeader>
          <Text style={s.confirmMessage}>
            {item.mediaType === 'tv'
              ? `${item.title} will move to Watched and every episode will be marked watched. Times Watched will be set to at least 1.`
              : `${item.title} will move to Watched. Times Watched will be set to at least 1.`}
          </Text>
          <Button
            title={pending ? 'Marking watched…' : 'Mark watched'}
            disabled={pending}
            onPress={() => {
              if (pending) return;
              void onConfirm(item)
                .catch(() => undefined)
                .finally(onClose);
            }}
          />
        </DrawerContent>
      )}
    </Drawer>
  );
}

export function AddTagTitlesButton({ tag }: { tag: string }) {
  return (
    <NativePressable
      accessibilityRole="button"
      accessibilityLabel={`Add titles to ${tag}`}
      accessibilityHint="Opens your library for multi-select"
      onPress={() => router.push({ pathname: '/tags/add/[tag]', params: { tag } } as Href)}
      style={s.addButton}
      pressedStyle={s.addButtonPressed}
    >
      <Plus size={23} color={colors.bg} strokeWidth={1.9} />
    </NativePressable>
  );
}
