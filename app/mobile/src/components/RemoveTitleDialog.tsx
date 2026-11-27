import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { ReduceMotion, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/primitives';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';

/** A centred confirmation card for actions that change a lot at once. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  pendingLabel,
  destructive = false,
  pending,
  error,
  onCancel,
  onConfirm,
  cancelLabel = 'Cancel',
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  destructive?: boolean;
  pending: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
  cancelLabel?: string;
}) {
  const insets = useSafeAreaInsets();
  const dismiss = () => {
    if (!pending) onCancel();
  };
  return (
    <Modal
      visible={open}
      transparent
      // The scrim covers the system bars too, like the account drawer.
      statusBarTranslucent
      navigationBarTranslucent
      animationType="fade"
      onRequestClose={dismiss}
    >
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
        <Animated.View
          entering={ZoomIn.duration(220)
            .withInitialValues({ transform: [{ scale: 0.94 }] })
            .reduceMotion(ReduceMotion.System)}
          style={s.card}
        >
          <ScrollView bounces={false} contentContainerStyle={s.content}>
            <Text accessibilityRole="header" style={s.title}>
              {title}
            </Text>
            <Text style={s.message}>{message}</Text>
            {error && (
              <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={s.error}>
                {error}
              </Text>
            )}
            <View style={s.actions}>
              <Button
                title={cancelLabel}
                variant="secondary"
                size="lg"
                disabled={pending}
                onPress={dismiss}
                style={s.action}
              />
              <Button
                title={pending ? pendingLabel : confirmLabel}
                variant={destructive ? 'danger' : 'primary'}
                size="lg"
                disabled={pending}
                onPress={onConfirm}
                style={s.action}
              />
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

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
  return (
    <ConfirmDialog
      open={open}
      title="Remove title?"
      message={
        <>
          Remove <Text style={s.name}>{title}</Text> and its episode history from your library? This
          can’t be undone.
        </>
      }
      confirmLabel="Remove"
      pendingLabel="Removing…"
      destructive
      pending={pending}
      error={error}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
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
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.sheet,
      overflow: 'hidden',
    },
    content: { padding: 24, gap: 12 },
    title: { color: colors.text, fontSize: 20, fontWeight: '700' },
    message: { color: colors.secondary, fontSize: 14, lineHeight: 21 },
    error: { color: colors.danger, fontSize: 14, lineHeight: 21 },
    name: { color: colors.text, fontWeight: '600' },
    actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
    action: { flex: 1 },
  },
  ['title', 'message', 'name', 'error'] as const,
);
