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
import { Pressable, Text, View } from 'react-native';
import { colors } from '@/constants/colors';
import { createStyles } from '@/lib/typography';

type ToastValue = { show: (message: string) => void };
const ToastContext = createContext<ToastValue>({ show: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = undefined;
    setMessage('');
  }, []);
  const show = useCallback(
    (nextMessage: string) => {
      if (timer.current) clearTimeout(timer.current);
      setMessage(nextMessage);
      timer.current = setTimeout(dismiss, 4000);
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
        <View accessibilityRole="alert" style={styles.toast}>
          <Text style={styles.toastText}>{message}</Text>
          <Pressable
            accessibilityLabel="Dismiss notification"
            accessibilityRole="button"
            onPress={dismiss}
            hitSlop={2}
            style={styles.toastClose}
          >
            <Text style={styles.toastCloseText}>×</Text>
          </Pressable>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

const styles = createStyles({
  toast: {
    position: 'absolute',
    bottom: 90,
    left: 24,
    right: 24,
    backgroundColor: colors.text,
    borderRadius: 12,
    padding: 14,
    paddingRight: 44,
    zIndex: 99,
  },
  toastText: { color: colors.bg, textAlign: 'center', fontWeight: '600' },
  toastClose: {
    position: 'absolute',
    right: 4,
    top: 3,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastCloseText: { color: colors.bg, fontSize: 24 },
});
