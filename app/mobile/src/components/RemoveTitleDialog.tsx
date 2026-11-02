import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/primitives';
import { colors } from '@/constants/colors';
import { createAppStyles } from '@/lib/typography';

export function RemoveTitleDialog({
  open,
  title,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  pending: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const insets = useSafeAreaInsets();
  const dismiss = () => {
    if (!pending) onCancel();
  };
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={dismiss}>
      <View
        style={[s.overlay, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
        accessibilityViewIsModal
      >
        <Pressable
          style={s.backdrop}
          onPress={dismiss}
          accessible={false}
          importantForAccessibility="no"
        />
        <View style={s.card}>
          <ScrollView bounces={false} contentContainerStyle={s.content}>
            <Text accessibilityRole="header" style={s.title}>
              Remove title?
            </Text>
            <Text style={s.message}>
              Remove <Text style={s.name}>{title}</Text> and its episode history from your library?
              This can’t be undone.
            </Text>
            {error && (
              <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>
                {error}
              </Text>
            )}
            <View style={s.actions}>
              <Button
                title={pending ? 'Removing…' : 'Remove'}
                variant="primary"
                disabled={pending}
                onPress={onConfirm}
              />
              <Button title="Cancel" variant="ghost" disabled={pending} onPress={dismiss} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const s = createAppStyles(
  {
    overlay: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 24,
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
    },
    backdrop: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
    card: {
      width: '100%',
      maxWidth: 400,
      maxHeight: '100%',
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 24,
      overflow: 'hidden',
    },
    content: { padding: 24, gap: 16 },
    title: { color: colors.text, fontSize: 22, fontWeight: '600' },
    message: { color: colors.muted, fontSize: 14, lineHeight: 21 },
    error: { color: colors.danger, fontSize: 14, lineHeight: 21 },
    name: { color: colors.text, fontWeight: '600' },
    actions: { gap: 8, marginTop: 8 },
  },
  ['title', 'message', 'name', 'error'] as const,
);
