import { createContext, useContext, useEffect, useState, type Ref } from 'react';
import {
  KeyboardAwareScrollView,
  type KeyboardAwareScrollViewProps,
  type KeyboardAwareScrollViewRef,
} from 'react-native-keyboard-controller';

export const KEYBOARD_FIELD_GAP = 24;

const FieldSpaceContext = createContext<((space: number) => void) | undefined>(undefined);

export function useKeyboardFieldSpace(space: number) {
  const setSpace = useContext(FieldSpaceContext);
  useEffect(() => {
    setSpace?.(space);
    return () => setSpace?.(0);
  }, [setSpace, space]);
}

export function KeyboardScrollView({
  ref,
  ...props
}: KeyboardAwareScrollViewProps & { ref?: Ref<KeyboardAwareScrollViewRef> }) {
  const [fieldSpace, setFieldSpace] = useState(0);
  return (
    <FieldSpaceContext value={setFieldSpace}>
      <KeyboardAwareScrollView
        ref={ref}
        bottomOffset={KEYBOARD_FIELD_GAP + fieldSpace}
        keyboardShouldPersistTaps="handled"
        {...props}
      />
    </FieldSpaceContext>
  );
}
