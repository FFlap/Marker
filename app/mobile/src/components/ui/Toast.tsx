import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable, Text } from 'react-native';
import Animated, { FadeOutDown, ReduceMotion, SlideInDown } from 'react-native-reanimated';
import X from 'lucide-react-native/icons/x';
import { colors } from '@/constants/colors';
import { radius } from '@/constants/theme';
import { createAppStyles } from '@/lib/typography';

type ToastAction = { label: string; onPress: () => void };
type ToastOptions = {
  action?: ToastAction;
  /** Called once this toast leaves the screen: dismissed, timed out, or replaced. */
  onHide?: () => void;
  /** A toast replaced by one with the same key is updated, not hidden (no onHide). */
  key?: string;
};
type ToastValue = { show: (message: string, options?: ToastOptions) => void };
const ToastContext = createContext<ToastValue>({ show: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<
    { state: 'hidden' } | { state: 'visible'; message: string; id: number; action?: ToastAction }
  >({
    state: 'hidden',
  });
  const nextId = useRef(0);
  const message = toast.state === 'visible' ? toast.message : '';
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const current = useRef<Pick<ToastOptions, 'onHide' | 'key'>>(undefined);
  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    const hidden = current.current;
    current.current = undefined;
    setToast({ state: 'hidden' });
    hidden?.onHide?.();
  }, []);
  const show = useCallback(
    (nextMessage: string, options?: ToastOptions) => {
      if (timer.current) clearTimeout(timer.current);
      const replaced = current.current;
      current.current = { onHide: options?.onHide, key: options?.key };
      // The same key updates the message in place instead of sliding a new toast in.
      const sameKey = !!replaced && !!options?.key && replaced.key === options.key;
      if (replaced && !sameKey) replaced.onHide?.();
      setToast(
        nextMessage
          ? {
              state: 'visible',
              message: nextMessage,
              id: sameKey ? nextId.current : ++nextId.current,
              action: options?.action,
            }
          : { state: 'hidden' },
      );
      // An action such as Undo stays reachable a little longer.
      timer.current = setTimeout(dismiss, options?.action ? 6000 : 4000);
      (timer.current as unknown as { unref?: () => void }).unref?.();
    },
    [dismiss],
  );
  const value = useMemo(() => ({ show }), [show]);
  useEffect(() => dismiss, [dismiss]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {message ? (
        <Animated.View
          key={toast.state === 'visible' ? toast.id : 0}
          accessibilityRole="alert"
          entering={SlideInDown.duration(260).reduceMotion(ReduceMotion.System)}
          exiting={FadeOutDown.duration(180).reduceMotion(ReduceMotion.System)}
          style={styles.toast}
        >
          <Text style={styles.toastText}>{message}</Text>
          {toast.state === 'visible' && toast.action && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={toast.action.label}
              hitSlop={6}
              onPress={() => {
                const action = toast.state === 'visible' ? toast.action : undefined;
                dismiss();
                action?.onPress();
              }}
              style={styles.toastAction}
            >
              <Text style={styles.toastActionText}>{toast.action.label}</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityLabel="Dismiss notification"
            accessibilityRole="button"
            onPress={dismiss}
            hitSlop={6}
            style={styles.toastClose}
          >
            <X size={16} color={colors.secondary} strokeWidth={2} />
          </Pressable>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

const styles = createAppStyles(
  {
    toast: {
      position: 'absolute',
      bottom: 92,
      left: 20,
      right: 20,
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.elevated,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      // The sheet radius: pill-shaped on one line, still neatly rounded when a message wraps.
      borderRadius: radius.sheet,
      paddingLeft: 20,
      paddingRight: 8,
      paddingVertical: 8,
      zIndex: 99,
      shadowColor: '#000',
      shadowOpacity: 0.4,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 12,
    },
    toastText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
    toastAction: { minHeight: 36, paddingHorizontal: 10, justifyContent: 'center' },
    toastActionText: { color: colors.text, fontSize: 14, fontWeight: '700' },
    toastClose: {
      width: 36,
      height: 36,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
  },
  ['toastText', 'toastActionText'] as const,
);
