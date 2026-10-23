import { createContext, useCallback, useContext, type ComponentPropsWithRef } from 'react';
import { View, type LayoutChangeEvent, type ViewProps } from 'react-native';
import { KeyboardScrollView } from '@/components/ui/KeyboardScrollView';

// Reports native content readiness; only the app root owns the splash lifecycle.
export const ScreenReadinessContext = createContext<(() => void) | undefined>(undefined);

function useScreenLayout(onLayout: ViewProps['onLayout']) {
  const reportReady = useContext(ScreenReadinessContext);
  return useCallback(
    (event: LayoutChangeEvent) => {
      onLayout?.(event);
      const { width, height } = event.nativeEvent.layout;
      if (width > 0 && height > 0) reportReady?.();
    },
    [onLayout, reportReady],
  );
}

/** Use as the screen's existing native root, including loading and error states. */
export function ScreenView({ onLayout, ...props }: ComponentPropsWithRef<typeof View>) {
  return <View {...props} onLayout={useScreenLayout(onLayout)} />;
}

/** Keeps keyboard scrolling and form context without adding a native container. */
export function ScreenKeyboardScrollView({
  onLayout,
  ...props
}: ComponentPropsWithRef<typeof KeyboardScrollView>) {
  return <KeyboardScrollView {...props} onLayout={useScreenLayout(onLayout)} />;
}
